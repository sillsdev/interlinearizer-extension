// Adapted from paranext-core/e2e-tests/fixtures/helpers.ts
import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

const DEFAULT_WEBSOCKET_PORT = 8876;
const RPC_DISCOVER_POLL_INTERVAL_MS = 250;
export const PROCESS_READY_TIMEOUT = process.env.CI ? 600_000 : 120_000;

/**
 * Same serialized request type as `registerCommand('platform.about', ...)` in command.service
 * (`command` + `:` + `platform.about`).
 */
const PLATFORM_ABOUT_COMMAND = 'command:platform.about';

/**
 * Keep in sync with GET_METHODS from @shared/data/rpc.model. Required to be 'rpc.discover' by the
 * OpenRPC specification.
 */
const GET_METHODS = 'rpc.discover';

/** Subset of the `rpc.discover` response we actually inspect. */
type RpcDiscoverResult = {
  methods?: Array<{ name: string }>;
};

/** Return value from {@link launchElectronWithExtension}. */
export interface ElectronAppContext {
  electronApp: ElectronApplication;
  userDataDir: string;
  /** Resolves when the Electron process closes (registered before yielding to tests). */
  appClosed: Promise<void>;
}

/** Options accepted by {@link launchElectronWithExtension}. */
export interface LaunchElectronAppOptions {
  /**
   * Additional environment variables to merge into the child process environment, applied after the
   * defaults. Keys present here override the defaults (e.g. `{ DEV_NOISY: 'false' }`).
   */
  envOverrides?: Record<string, string>;
}

/**
 * Wait for the WebSocket server to be ready on the specified port.
 *
 * @param port Port number to connect to.
 * @param timeout Maximum time in milliseconds to wait before throwing.
 * @returns Resolves when a WebSocket connection to the port succeeds.
 * @throws {Error} If the WebSocket server is not ready within `timeout` milliseconds.
 */
async function waitForWebSocketReady(port: number, timeout: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('Connection timeout'));
        }, 2000);

        ws.on('open', () => {
          clearTimeout(timer);
          ws.close();
          resolve();
        });
        ws.on('error', (err) => {
          clearTimeout(timer);
          ws.close();
          reject(err);
        });
      });
      return;
    } catch {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });
    }
  }
  throw new Error(`WebSocket server not ready on port ${port} after ${timeout}ms`);
}

/**
 * Launch a fresh Electron instance (paranext-core) with the interlinearizer extension loaded via
 * `--extensions`.
 *
 * @param opts Optional launch options (e.g. environment variable overrides).
 * @returns The app handle, the isolated user-data directory path, and a promise that resolves when
 *   the app closes.
 * @throws If Electron fails to launch or the WebSocket server does not become ready.
 */
export async function launchElectronWithExtension(
  opts: LaunchElectronAppOptions = {},
): Promise<ElectronAppContext> {
  const coreDir = path.resolve(__dirname, '../../../paranext-core');
  const extensionDist = path.resolve(__dirname, '../../dist');

  // Resolve the Electron binary from paranext-core's node_modules — the electron package exports
  // the path to the platform binary as its default export.
  const coreRequire = createRequire(path.resolve(coreDir, 'package.json'));
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const electronExecutable = coreRequire('electron') as string;

  console.log(`Launching Platform.Bible from: ${coreDir}`);
  console.log(`Loading extension from: ${extensionDist}`);

  // VSCode/Claude Code set ELECTRON_RUN_AS_NODE=1 which forces the Electron binary to run as plain
  // Node.js. Omit it so the Electron child does not inherit it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ELECTRON_RUN_AS_NODE, ...restEnv } = process.env;
  const env = {
    ...restEnv,
    NODE_ENV: 'development',
    DEV_NOISY: process.env.DEV_NOISY ?? 'false',
    ...opts.envOverrides,
  };

  // Use an isolated user-data directory so the singleton instance lock does not
  // conflict with any already-running Platform.Bible instance.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paranext-e2e-'));

  let electronApp: ElectronApplication;
  try {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [`--user-data-dir=${userDataDir}`, coreDir, '--extensions', extensionDist],
      cwd: coreDir,
      env,
      timeout: PROCESS_READY_TIMEOUT,
    });
  } catch (error) {
    console.error('Failed to launch Electron:', error);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }

  console.log('Waiting for WebSocket server on port 8876...');
  try {
    await waitForWebSocketReady(DEFAULT_WEBSOCKET_PORT, PROCESS_READY_TIMEOUT);
  } catch (error) {
    console.error('WebSocket readiness check failed after Electron launch:', error);
    const proc = electronApp.process();
    if (proc?.pid) {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
  console.log('WebSocket server is ready');

  const appClosed = new Promise<void>((resolve) => {
    electronApp.once('close', () => {
      resolve();
    });
  });

  return { electronApp, userDataDir, appClosed };
}

/**
 * Tear down an Electron instance: kill the process group, wait for close, and clean up the isolated
 * user-data directory.
 *
 * @param ctx The app context returned by {@link launchElectronWithExtension}.
 * @returns Resolves when the Electron process has been killed and user-data cleaned up.
 */
export async function teardownElectronApp(ctx: ElectronAppContext): Promise<void> {
  const { electronApp, userDataDir, appClosed } = ctx;

  const electronProcess = electronApp.process();
  console.log(
    `[teardown] Closing Electron app... pid=${electronProcess?.pid} exitCode=${electronProcess?.exitCode} signalCode=${electronProcess?.signalCode}`,
  );

  /**
   * Send `sig` to the Electron process group, falling back to the process itself if group kill
   * fails.
   *
   * @param sig Signal to send (e.g. `'SIGKILL'`).
   */
  const killGroup = (sig: NodeJS.Signals) => {
    if (!electronProcess?.pid) return;
    try {
      process.kill(-electronProcess.pid, sig);
    } catch {
      try {
        electronProcess.kill(sig);
      } catch {
        /* already dead */
      }
    }
  };

  // Node.js ChildProcess.exitCode/signalCode are null until the process exits
  // eslint-disable-next-line no-null/no-null
  if (electronProcess && electronProcess.exitCode === null && electronProcess.signalCode === null) {
    console.log('[teardown] Sending SIGKILL to process group...');
    killGroup('SIGKILL');
    console.log('[teardown] Waiting for appClosed after SIGKILL (up to 3s)...');
    await Promise.race([
      appClosed,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 3_000);
      }),
    ]);
    console.log('[teardown] Done waiting after SIGKILL');
  }

  console.log('[teardown] Cleaning up user data dir...');
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    console.warn('[teardown] First rmSync attempt failed — retrying in 3s...');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 3_000);
    });
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[teardown] Could not remove ${userDataDir}: ${e}`);
    }
  }
  console.log('[teardown] Complete');
}

/**
 * One JSON-RPC 2.0 request over WebSocket: open, send, wait for response id `1`, close. Ignores
 * unrelated messages until the matching response arrives.
 *
 * @param method JSON-RPC method name to invoke.
 * @param timeoutErrorMessage Custom error message on timeout; defaults to a standard timeout
 *   message.
 * @param params Positional parameters to send with the request.
 * @param port WebSocket port to connect to.
 * @param perRequestTimeoutMs Milliseconds before the request times out.
 * @returns The `result` field of the JSON-RPC response, typed as `T`.
 * @throws {Error} If the request times out or the server returns a JSON-RPC error.
 */
async function sendPapiJsonRpcOnce<T>(
  method: string,
  timeoutErrorMessage?: string,
  params: unknown[] = [],
  port: number = DEFAULT_WEBSOCKET_PORT,
  perRequestTimeoutMs = 10_000,
): Promise<T> {
  const timeoutMessage =
    timeoutErrorMessage ?? `PAPI request "${method}" timed out after ${perRequestTimeoutMs}ms`;

  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(timeoutMessage));
    }, perRequestTimeoutMs);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
      );
    });

    ws.on('message', (data) => {
      let parsed: { id?: number; error?: unknown; result?: unknown };
      try {
        parsed = JSON.parse(data.toString());
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err);
        return;
      }
      if (parsed.id !== 1) return;
      clearTimeout(timeout);
      ws.close();
      if (parsed.error) {
        reject(new Error(`PAPI error: ${JSON.stringify(parsed.error)}`));
      } else {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        resolve(parsed.result as T);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Send a single JSON-RPC request where `method` is a PAPI request type (e.g. `rpc.discover`). Opens
 * a connection, sends one request, waits for the matching response id, then closes.
 *
 * @param method PAPI request type to invoke (e.g. `rpc.discover`).
 * @param params Positional parameters to send with the request.
 * @param port WebSocket port to connect to.
 * @param perRequestTimeoutMs Milliseconds before the request times out.
 * @returns The `result` field of the JSON-RPC response, typed as `T`.
 * @throws {Error} If the request times out or the server returns a JSON-RPC error.
 */
export async function sendPapiRequestOnce<T>(
  method: string,
  params: unknown[] = [],
  port: number = DEFAULT_WEBSOCKET_PORT,
  perRequestTimeoutMs = 10_000,
): Promise<T> {
  return sendPapiJsonRpcOnce<T>(method, undefined, params, port, perRequestTimeoutMs);
}

/**
 * Poll `rpc.discover` until `methodName` appears in `result.methods` or `timeoutMs` elapses.
 *
 * @param methodName The fully-qualified PAPI method name to wait for (e.g. `command:foo.bar`).
 * @param port WebSocket port to connect to.
 * @param timeoutMs Maximum time in milliseconds to poll before throwing.
 * @returns Resolves when the method appears in `rpc.discover`.
 * @throws {Error} If the method is not registered within `timeoutMs` milliseconds.
 */
export async function waitForPapiMethodRegistered(
  methodName: string,
  port: number = DEFAULT_WEBSOCKET_PORT,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - start);
    try {
      const result = await sendPapiRequestOnce<RpcDiscoverResult>(
        GET_METHODS,
        [],
        port,
        Math.min(10_000, Math.max(1000, remaining)),
      );
      if (result.methods?.some((m) => m.name === methodName)) return;
    } catch {
      /* next poll */
    }
    const sleepMs = Math.min(RPC_DISCOVER_POLL_INTERVAL_MS, timeoutMs - (Date.now() - start));
    if (sleepMs <= 0) break;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, sleepMs);
    });
  }
  throw new Error(`PAPI method "${methodName}" not listed in rpc.discover within ${timeoutMs}ms`);
}

/**
 * Wait for the Platform.Bible UI to be fully ready: dock layout appears and `platform.about`
 * command is registered (dialog service has finished initializing).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param timeout Maximum time in milliseconds to wait before throwing.
 * @returns Resolves when the dock layout is visible and `platform.about` is registered.
 * @throws If the dock layout or `platform.about` command does not appear within `timeout`
 *   milliseconds.
 */
export async function waitForAppReady(page: Page, timeout = 60_000): Promise<void> {
  const start = Date.now();
  await page.waitForSelector('div[class*="dock-layout"]', {
    state: 'attached',
    timeout,
  });
  const remaining = Math.max(0, timeout - (Date.now() - start));
  await waitForPapiMethodRegistered(PLATFORM_ABOUT_COMMAND, DEFAULT_WEBSOCKET_PORT, remaining);
}

/**
 * Wait for the interlinearizer extension to finish activating by polling `rpc.discover` until
 * `interlinearizer.openForWebView` is listed.
 *
 * @param timeoutMs Maximum time in milliseconds to poll before throwing.
 * @returns Resolves when `interlinearizer.openForWebView` is listed in `rpc.discover`.
 * @throws {Error} If the extension does not register within `timeoutMs` milliseconds.
 */
export async function waitForInterlinearizerReady(timeoutMs = 90_000): Promise<void> {
  await waitForPapiMethodRegistered(
    'command:interlinearizer.openForWebView',
    DEFAULT_WEBSOCKET_PORT,
    timeoutMs,
  );
}
