// Adapted from paranext-core/e2e-tests/fixtures/helpers.ts
import {
  _electron as electron,
  ElectronApplication,
  expect,
  FrameLocator,
  Locator,
  Page,
} from '@playwright/test';
import escapeStringRegexp from 'escape-string-regexp';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';
import { killProcessTree } from '../process-utils';

const DEFAULT_WEBSOCKET_PORT = 8876;
const RPC_DISCOVER_POLL_INTERVAL_MS = 250;
export const PROCESS_READY_TIMEOUT = process.env.CI ? 600_000 : 120_000;

/**
 * Fail-fast readiness budget (ms) for a CDP feature test's per-test
 * `waitForAppAndInterlinearizerReady`. The shared instance is proven-settled by global setup before
 * any feature test runs, so a per-test readiness wait that runs long means the instance died
 * mid-run — which no per-test retry can revive. A short cap (vs. the 120 s cold-start default)
 * fails a dead shared instance fast instead of burning the full cold-start budget on every retry.
 */
export const CDP_FEATURE_READY_TIMEOUT = 30_000;

/**
 * File the smoke launcher streams the app's main-process stdout/stderr to. Kept in `e2e-tests/` (a
 * directory Playwright does not clear, and one the CI artifact upload includes) so a cold-start
 * stall's main-process log survives a failed run. Overwritten on each launch.
 */
const SMOKE_APP_LOG_FILE = path.join(__dirname, '..', '.smoke-app-startup.log');

/**
 * Same serialized request type as `registerCommand('platform.about', ...)` in command.service
 * (`command` + `:` + `platform.about`).
 */
const PLATFORM_ABOUT_COMMAND = 'command:platform.about';

/**
 * `rpc.discover` method names that flip present when paranext-core's settings, menu-data, and theme
 * service hosts finish registering their provider network objects — the upstream signal that gates
 * a resolved dock (see {@link waitForServiceHostsRegistered}).
 *
 * These are each object's bare EXISTENCE handler (`object:{id}`, no method suffix), not a named
 * method like `.set`/`.getCurrentTheme`: the existence handler registers first when any network
 * object comes up, so it is the "this object is on the network" signal and can't be invalidated by
 * a provider method being renamed. These strings mirror upstream's serialization; if paranext-core
 * changes how it names provider objects, update them to match.
 */
const SERVICE_HOST_OBJECT_METHODS = [
  'object:platform.settingsServiceDataProvider-data',
  'object:platform.menuDataServiceDataProvider-data',
  'object:platform.themeServiceDataProvider-data',
];

/**
 * Renderer page error that means this cold start is doomed, not merely slow: the theme host's
 * initial theme data never settled, so the dock's webview tabs stay stuck at "Unknown" for the rest
 * of the run. Once it fires no amount of further waiting recovers the launch — only a fresh launch
 * (a smoke retry, or a re-run of CDP setup) does.
 *
 * This fires AFTER the theme provider's network object has registered (the host registers the
 * provider, then separately awaits its data), so the positive {@link waitForServiceHostsRegistered}
 * gate can pass while the renderer is still headed for this timeout — which is why the tab-title
 * wait fast-fails on this error instead of waiting out its budget. The pattern matches an upstream
 * paranext-core message; if that message changes, this stops catching the doomed start.
 */
const FATAL_STARTUP_PAGE_ERROR =
  /Timeout reached when waiting for .*allThemeFamiliesById to settle/i;

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
    // With NODE_ENV=development, paranext-core auto-opens DevTools on every window; on CI Linux
    // DevTools docks inside the window and squeezes the app viewport enough that dock panels
    // collapse and modals get clipped, so clicks land on neighboring iframes. ELECTRON_IS_DEV=0
    // disables the auto-open without changing other NODE_ENV-driven behavior (dev-server URL, etc.).
    ELECTRON_IS_DEV: '0',
    ...opts.envOverrides,
  };

  // Use an isolated user-data directory so the singleton instance lock does not
  // conflict with any already-running Platform.Bible instance.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paranext-e2e-'));

  let electronApp: ElectronApplication;
  try {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [
        `--user-data-dir=${userDataDir}`,
        coreDir,
        '--extensions',
        extensionDist,
        // Deterministic window size (paranext-core supports this arg for automation) matching the
        // CI xvfb screen (1280x960), so dock panels have room and modals are not clipped.
        '--window-size',
        '1280x960',
        // Force the X11 backend on Linux: in a Wayland session with DISPLAY redirected to xvfb
        // (local headless runs), Electron otherwise picks the Wayland backend from the session
        // environment and segfaults when the compositor socket is unreachable. On CI runners
        // (X11-only) this is a no-op.
        ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
      ],
      cwd: coreDir,
      env,
      timeout: PROCESS_READY_TIMEOUT,
    });
  } catch (error) {
    console.error('Failed to launch Electron:', error);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }

  // Stream the launched app's main-process stdout/stderr to a log file, so a cold-start stall (dock
  // tabs stuck at "Unknown" and never resolving — a platform-side race we can only tolerate, not
  // fix) leaves main-process evidence to diagnose from; the renderer console is empty in that case.
  // Best-effort: any write error is swallowed so logging never fails a launch.
  const appLog = fs.createWriteStream(SMOKE_APP_LOG_FILE, { flags: 'w' });
  appLog.on('error', () => {
    /* Logging is best-effort; never let a log write failure break the launch. */
  });
  const appProcess = electronApp.process();
  // { end: false } on BOTH pipes: two sources share one destination, so the default end-on-source-end
  // would have whichever stream (stdout/stderr) closes first call appLog.end(), dropping the other
  // stream's later output and throwing "write after end". We own appLog's lifecycle instead — closing
  // it when the app exits (below) or when we flush it before dumping on a failed launch.
  appProcess.stdout?.pipe(appLog, { end: false });
  appProcess.stderr?.pipe(appLog, { end: false });
  // Close the log once the app process is gone: with { end: false } the pipes never close it, so tie
  // its lifetime to the app to avoid leaking the descriptor on a healthy launch.
  electronApp.once('close', () => {
    appLog.end();
  });

  console.log('Waiting for WebSocket server on port 8876...');
  try {
    await waitForWebSocketReady(DEFAULT_WEBSOCKET_PORT, PROCESS_READY_TIMEOUT);
  } catch (error) {
    console.error('WebSocket readiness check failed after Electron launch:', error);
    // Flush buffered pipe output to disk before the synchronous read in dumpSmokeAppLog: the app is
    // still alive here (killed just below), so we cannot wait for the source streams to end — ending
    // appLog ourselves flushes what has been written so the dump captures the failure's evidence
    // instead of an empty file.
    await flushAppLog(appLog);
    dumpSmokeAppLog();
    const proc = electronApp.process();
    if (proc?.pid) killProcessTree(proc.pid, 'SIGKILL');
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
 * Flush and close the smoke app-log write stream, resolving once its buffered data has reached
 * disk. The launcher pipes the app's stdout/stderr into this stream with `{ end: false }` (so
 * neither source closes it), which means those writes may still be buffered when a failed launch
 * wants to read the file back; ending the stream here forces the flush and this awaits the
 * resulting `finish` (or `error`) so a following synchronous read sees the captured output rather
 * than an empty file. Best-effort: a stream error resolves rather than rejects, so a logging
 * failure never breaks launch.
 *
 * @param appLog The write stream created for {@link SMOKE_APP_LOG_FILE}.
 * @returns Resolves once the stream has flushed and closed (or errored).
 */
function flushAppLog(appLog: fs.WriteStream): Promise<void> {
  return new Promise<void>((resolve) => {
    // Already-closed stream: end() would never emit 'finish', so resolve immediately.
    if (appLog.writableEnded) {
      resolve();
      return;
    }
    appLog.once('error', () => resolve());
    appLog.end(() => resolve());
  });
}

/**
 * Echo the smoke launcher's captured main-process output ({@link SMOKE_APP_LOG_FILE}) to the
 * console. Called when the app fails to open its WebSocket port so the startup failure's cause
 * appears inline in the CI log, not only in the uploaded artifact. Best-effort: a missing or
 * unreadable log is reported, never thrown.
 *
 * @returns Nothing; logging-only.
 */
function dumpSmokeAppLog(): void {
  try {
    const log = fs.readFileSync(SMOKE_APP_LOG_FILE, 'utf-8');
    console.error(
      `--- Launched Platform.Bible (smoke) output (${SMOKE_APP_LOG_FILE}) ---\n${log || '(empty)'}\n--- end app output ---`,
    );
  } catch {
    console.error(`Could not read smoke app log at ${SMOKE_APP_LOG_FILE}.`);
  }
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

  // Node.js ChildProcess.exitCode/signalCode are null until the process exits
  // eslint-disable-next-line no-null/no-null
  if (electronProcess && electronProcess.exitCode === null && electronProcess.signalCode === null) {
    console.log('[teardown] Sending SIGKILL to process group...');
    if (electronProcess.pid) killProcessTree(electronProcess.pid, 'SIGKILL');
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
 * Wait for paranext-core's settings, menu-data, and theme service hosts to finish registering, by
 * polling `rpc.discover` for each host's data-provider existence handler
 * ({@link SERVICE_HOST_OBJECT_METHODS}).
 *
 * This is the upstream readiness signal for a resolved dock. On a cold start the renderer paints
 * its webview tabs titled "Unknown" (and its panels blank) until the metadata these hosts serve
 * arrives. Gating here — before {@link waitForDockTabTitlesResolved} — absorbs that cold-start race
 * into the readiness wait instead of letting it surface downstream as an opaque tab-title timeout:
 * waiting on the hosts directly means the tab-title wait only ever runs once the data behind those
 * titles actually exists. On a healthy startup the hosts are already up, so this resolves
 * immediately and costs nothing; the poll uses the same `rpc.discover` mechanism as every other
 * readiness check here.
 *
 * The three waits run concurrently and share the one `timeout` budget (the hosts register in
 * parallel — settings and menu-data in the extension host, theme in the renderer — so serializing
 * would triple the worst-case wait for no benefit).
 *
 * @param timeout Maximum time in milliseconds to wait for all three hosts. Floored to a small
 *   positive value so an already-thin remaining budget still gets one real poll.
 * @returns Resolves once all three service-host providers are listed in `rpc.discover`.
 * @throws {Error} If any of the three hosts is not registered within `timeout` milliseconds.
 */
export async function waitForServiceHostsRegistered(timeout: number): Promise<void> {
  const budget = Math.max(1_000, timeout);
  await Promise.all(
    SERVICE_HOST_OBJECT_METHODS.map((method) =>
      waitForPapiMethodRegistered(method, DEFAULT_WEBSOCKET_PORT, budget),
    ),
  );
}

/** Options for {@link waitForDockTabTitlesResolved}. */
interface DockTabTitlesOptions {
  /**
   * How to judge the dock is ready:
   *
   * - `true` (cold-start): EVERY dock tab must have a resolved (non-"Unknown") title. Correct for a
   *   fresh per-worker instance (smoke tests, CDP global setup): a cold instance whose tabs are all
   *   still "Unknown" is genuinely broken, and there are no unrelated tabs to interfere.
   * - `false` (shared/warm): the dock is mounted and AT LEAST ONE tab has a resolved title. Correct
   *   for the shared CDP feature instance, which global setup already settled before any test ran.
   *   Re-asserting the strict "no tab anywhere is Unknown" invariant per test is both redundant and
   *   fragile there: a single stray/leftover panel (e.g. one briefly re-titled by a close/reopen
   *   cycle) would fail the gate for EVERY subsequent test against that one shared instance, and no
   *   per-test retry can recover it (a cascade the Windows CDP tier is prone to).
   */
  strict: boolean;
}

/**
 * Run `fn` with a fatal-startup-error tripwire armed on `page`: if the renderer emits a
 * {@link FATAL_STARTUP_PAGE_ERROR} while `fn` is in flight, the returned promise rejects immediately
 * with a fast, correctly-labeled failure instead of `fn` running out its full readiness budget.
 *
 * This wraps the WHOLE readiness sequence (service-host wait AND dock-tab wait), not just one
 * stage: the fatal theme-settle error can surface during either, and it never self-recovers, so a
 * doomed cold start must abort the moment the error fires no matter which stage is running. Keeping
 * the listener armed across both stages is why this is a wrapper rather than logic inside a single
 * wait.
 *
 * The listener is registered only when `enabled` (a warm shared instance leaves it off — a stale
 * error from a long-past cold start must not abort an otherwise-healthy wait), and always removed
 * in `finally` so it can't leak across tests on the shared CDP page. A sentinel distinguishes
 * "tripwire fired" from an ordinary `fn` rejection, so only a genuine fatal error is remapped to
 * the fast failure; any other rejection from `fn` propagates unchanged.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param enabled Whether to arm the tripwire. When `false`, `fn` runs with no listener attached.
 * @param fn The readiness work to run under the tripwire.
 * @returns Resolves with `fn`'s result once it completes without the tripwire firing.
 * @throws If the renderer emitted a fatal startup error while `fn` was in flight (with `enabled`),
 *   or whatever `fn` itself throws.
 */
export async function withFatalStartupTripwire<T>(
  page: Page,
  enabled: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  // A sentinel value distinguishes "tripwire fired" from an ordinary reject of `fn`.
  const fatalError: { message?: string } = {};
  let onFatalPageError: ((err: Error) => void) | undefined;
  const fatalErrorTripped = new Promise<never>((_resolve, reject) => {
    if (!enabled) return;
    onFatalPageError = (err: Error) => {
      if (!FATAL_STARTUP_PAGE_ERROR.test(err.message)) return;
      fatalError.message = err.message;
      reject(new Error(err.message));
    };
    page.on('pageerror', onFatalPageError);
  });
  // Without an opted-in tripwire nothing ever rejects this promise; swallow the unused rejection
  // path so a stray rejection (there is none) could never surface as an unhandled rejection.
  fatalErrorTripped.catch(() => {});

  try {
    return await Promise.race([fn(), fatalErrorTripped]);
  } catch (error) {
    // The tripwire won the race: this cold start is doomed (theme data never settled), so report it
    // as its own fast failure. A smoke retry or a re-run of CDP setup relaunches the app, which is
    // the only thing that recovers this.
    if (fatalError.message !== undefined) {
      throw new Error(
        `Platform.Bible startup failed: the renderer reported a fatal startup error, so its dock ` +
          `tabs will never resolve on this launch (a fresh launch is required). Error: ${fatalError.message}`,
      );
    }
    throw error;
  } finally {
    if (onFatalPageError) page.off('pageerror', onFatalPageError);
  }
}

/**
 * Wait until the dock layout is mounted with resolved tab titles (none stuck at "Unknown"). On a
 * cold start the dock mounts with webview tabs titled "Unknown" (and blank panels) until project
 * metadata resolves; every tab-title-based locator in this suite silently times out against that
 * state. Waiting it out here turns those opaque per-test locator timeouts into either a pass (slow
 * healthy startup) or one clear early failure.
 *
 * The strictness of "resolved" depends on {@link DockTabTitlesOptions.strict} — see that field for
 * why the shared CDP instance must not use the strict all-tabs check.
 *
 * A torn-down renderer (page/context/browser closed out from under us, where `waitForFunction`
 * reports "Target page … has been closed") is surfaced as its own error rather than mislabeled
 * "tabs still Unknown", so the real cause is not buried.
 *
 * A doomed cold start (the renderer's theme data never settling — see
 * {@link FATAL_STARTUP_PAGE_ERROR}) is aborted early by {@link withFatalStartupTripwire}, which
 * callers wrap around the whole readiness sequence; this wait does not arm that tripwire itself.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param timeout Maximum time in milliseconds to wait before throwing. Must be positive: a
 *   non-positive value means the caller's readiness budget is already exhausted, and is failed fast
 *   rather than forwarded — Playwright treats `waitForFunction({ timeout: 0 })` as "no timeout" (an
 *   unbounded wait), so a `0` here would silently turn an exhausted budget into a hang on the exact
 *   "Unknown"-tab stall this helper exists to bound.
 * @param options Readiness options; see {@link DockTabTitlesOptions}.
 * @returns Resolves once the dock is ready per the chosen `strict` mode.
 * @throws If `timeout` is non-positive (budget exhausted before this wait began), if tab titles
 *   have not resolved within `timeout` milliseconds, or if the renderer page was closed while
 *   waiting.
 */
export async function waitForDockTabTitlesResolved(
  page: Page,
  timeout: number,
  options: DockTabTitlesOptions,
): Promise<void> {
  const { strict } = options;
  // A non-positive budget must not reach page.waitForFunction: { timeout: 0 } disables Playwright's
  // timeout entirely (an unbounded wait), so an already-exhausted budget would hang instead of
  // failing. Fail fast with a clear message instead.
  if (timeout <= 0) {
    throw new Error(
      `Dock tab titles could not be waited for: the readiness budget was exhausted before this ` +
        `wait began (timeout=${timeout}ms). An earlier startup stage consumed the whole timeout.`,
    );
  }

  try {
    await page.waitForFunction(
      (isStrict) => {
        const tabs = Array.from(document.querySelectorAll('.dock-tab'));
        if (tabs.length === 0) return false;
        const isResolved = (tab: Element) => !(tab.textContent ?? '').includes('Unknown');
        // Strict: no tab anywhere may be "Unknown". Lenient: at least one tab has resolved, which
        // is enough to know the app is up and rendering real tabs on an already-settled instance.
        return isStrict ? tabs.every(isResolved) : tabs.some(isResolved);
      },
      strict,
      { timeout, polling: 500 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A closed page is a torn-down renderer, not a project-metadata stall — report it as such so it
    // isn't chased as the "Unknown tabs" startup race (which it superficially resembles because the
    // waitForFunction times out either way).
    if (/target (page|context|browser) .*closed/i.test(message)) {
      throw new Error(
        `The renderer page was closed while waiting for the dock to become ready (after up to ` +
          `${timeout}ms) — the app or its window went away mid-test, not a slow startup. ` +
          `Original error: ${message}`,
      );
    }
    throw new Error(
      `Dock tab titles did not resolve within ${timeout}ms — the app came up but its webview tabs ` +
        `are still titled "Unknown" (project metadata never loaded). Original error: ${message}`,
    );
  }
}

/** Options for {@link waitForAppReady} and {@link waitForAppAndInterlinearizerReady}. */
interface AppReadyOptions {
  /**
   * Timeout in milliseconds for the whole readiness wait. The default is generous because a cold CI
   * instance has been observed taking over 45 s just to resolve tab titles; this is a wait-until,
   * so healthy startups pay nothing for the headroom.
   */
  timeout?: number;
  /**
   * Whether the dock-tab-title gate uses the strict cold-start check (every tab resolved) or the
   * lenient shared-instance check (dock mounted, at least one tab resolved). Defaults to `true`
   * (cold-start), correct for the fresh per-worker smoke instance. The CDP feature tests, which run
   * against one shared, already-settled instance, pass `false` so one stray panel can't cascade
   * across the whole tier — see {@link DockTabTitlesOptions.strict}.
   */
  strict?: boolean;
}

/**
 * Wait for the Platform.Bible UI to be fully ready: dock layout attaches, the settings/menu-data/
 * theme service hosts register, the dock tab titles resolve, and `platform.about` is registered
 * (dialog service has finished initializing).
 *
 * The service-host wait is what makes the tab-title wait meaningful rather than a downstream guess:
 * the tabs stay titled "Unknown" precisely until those hosts serve their metadata, so waiting on
 * the hosts first (see {@link waitForServiceHostsRegistered}) means the tab-title poll only runs
 * once the data behind the titles exists — turning the cold-start "Unknown for the full timeout"
 * stall from an opaque per-test tab-title timeout into an early, correctly-attributed wait on the
 * actual cause. On a healthy startup the hosts are already up, so this stage resolves immediately.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param options Readiness options; see {@link AppReadyOptions}.
 * @returns Resolves when the dock layout is visible with resolved tab titles, the service hosts are
 *   registered, and `platform.about` is registered.
 * @throws If the dock layout, service hosts, resolved tab titles, or the `platform.about` command
 *   do not appear within `timeout` milliseconds.
 */
export async function waitForAppReady(page: Page, options: AppReadyOptions = {}): Promise<void> {
  const { timeout = 120_000, strict = true } = options;
  const start = Date.now();
  await page.waitForSelector('div[class*="dock-layout"]', {
    state: 'attached',
    timeout,
  });
  // Floor each leftover budget to 1000ms, never 0 or a hair above it: a preceding stage can resolve
  // at the very last millisecond (or wall-clock drift can push elapsed past `timeout`), leaving a
  // non-positive remainder. Passing 0 to waitForDockTabTitlesResolved would trip its budget-
  // exhausted guard on that benign near-miss; a single-digit remainder would clear that guard but
  // then expire during the CDP round-trip its forwarded page.waitForFunction needs to evaluate the
  // predicate even once, failing "tabs still Unknown" on a healthy app. 1000ms lets each stage still
  // run one real poll. The CDP global setup applies the same Math.max(1_000, …) floor for this call.
  const budgetLeft = () => Math.max(1_000, timeout - (Date.now() - start));
  // Arm the fatal-startup tripwire around BOTH the service-host wait and the tab-title wait: the
  // fatal theme-settle error can surface during either stage (the hosts and the theme settle
  // concurrently), so a doomed cold start must abort the moment it fires no matter which stage is
  // running. The tripwire mirrors `strict`: a strict wait is a fresh cold-start instance (smoke),
  // where a fatal error means THIS launch is doomed and a retry's fresh launch is the fix. The
  // lenient shared-instance path (CDP features) leaves it off — there a stale error from a long-past
  // cold start must not abort an otherwise-healthy per-test wait.
  await withFatalStartupTripwire(page, strict, async () => {
    // Gate on the upstream service hosts BEFORE the tab-title wait: the tabs can only resolve once
    // these hosts serve their metadata, so waiting on them first means a slow cold start is spent on
    // the real cause rather than surfacing as an opaque "tabs still Unknown" timeout downstream.
    await waitForServiceHostsRegistered(budgetLeft());
    await waitForDockTabTitlesResolved(page, budgetLeft(), { strict });
  });
  await waitForPapiMethodRegistered(PLATFORM_ABOUT_COMMAND, DEFAULT_WEBSOCKET_PORT, budgetLeft());
}

/**
 * Wait for the interlinearizer extension to finish activating by polling `rpc.discover` until
 * `interlinearizer.openForWebView` is listed.
 *
 * @param timeoutMs Maximum time in milliseconds to poll before throwing. `undefined` selects the
 *   generous default (a cold instance can be slow to register the command); callers threading a
 *   shared budget pass the remaining time, clamped to a small floor so an already-exhausted budget
 *   still gets one real poll rather than throwing instantly.
 * @returns Resolves when `interlinearizer.openForWebView` is listed in `rpc.discover`.
 * @throws {Error} If the extension does not register within `timeoutMs` milliseconds.
 */
export async function waitForInterlinearizerReady(
  timeoutMs: number | undefined = 90_000,
): Promise<void> {
  await waitForPapiMethodRegistered(
    'command:interlinearizer.openForWebView',
    DEFAULT_WEBSOCKET_PORT,
    Math.max(1_000, timeoutMs ?? 90_000),
  );
}

/**
 * Open the Interlinearizer WebView from the Scripture Editor's top (≡) menu. Prerequisite stage
 * shared by all e2e tests that require the Interlinearizer to be open.
 *
 * The startup dock layout varies, so the editor is located resiliently rather than assumed:
 *
 * - A truly-fresh core profile opens the default multi-tab layout, which already includes a
 *   "Scripture Editor" tab (no project loaded).
 * - A profile whose layout collapsed to a single tab opens only the "Home" tab (no editor).
 * - A warm CDP instance already has the editor open on a project (tab titled e.g. "WEB (Editable)").
 *
 * Steps:
 *
 * 1. Wait for the layout to settle to a known state: either a Scripture Editor tab or the Home tab is
 *    present. (A bare `count()` races the async dock render — a fresh profile reports zero tabs for
 *    a beat before the layout mounts.)
 * 2. If no editor tab is present, open `projectName` from Home (Home tab → project row → "Open"),
 *    mirroring paranext-core's own `openFromEditorHamburger` helper.
 * 3. Focus the Scripture Editor tab. Its title (and its iframe's title) is the project short name with
 *    an editability suffix once a project is loaded (e.g. "WEB (Editable)"), and "Scripture Editor"
 *    only when no project is loaded — both are accepted.
 * 4. Enter the Scripture Editor iframe and click the ≡ ("Project") menu button.
 * 5. Click "Open Interlinearizer for this Project".
 * 6. If the "Open Interlinearizer" project-picker dialog appears (it only does when the editor has no
 *    project loaded), click the named project. When the editor already has a project, the command
 *    opens the Interlinearizer for it directly with no dialog.
 * 7. Wait for the "Interlinearizer" dock tab and click it to focus it.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param projectName Name of the project to open and select in the project-picker (default:
 *   `"WEB"`).
 * @returns Resolves when the Interlinearizer tab is focused and visible.
 * @throws If any step does not complete within its timeout.
 */
export async function openInterlinearizerFromScriptureEditor(
  page: Page,
  projectName = 'WEB',
): Promise<void> {
  // A Scripture Editor tab is titled by the project short name once a project is loaded (e.g.
  // "WEB (Editable)"), and "Scripture Editor" only when no project is loaded. Escape projectName so
  // a short name with regex metacharacters can't corrupt the pattern.
  const escapedProjectName = escapeStringRegexp(projectName);
  const editorTab = page
    .locator('.dock-tab', { hasText: new RegExp(`^(Scripture Editor|${escapedProjectName})\\b`) })
    .first();
  const homeTab = page.locator('.dock-tab', { hasText: 'Home' }).first();

  // Wait for the dock layout to actually mount before deciding which path to take — a fresh profile
  // briefly reports zero tabs, and a non-waiting `count()` would misread that as "no editor".
  // `.first()` on the whole `.or()`: when both the editor and Home tabs are present the union
  // resolves to two elements, which would trip strict mode on this visibility assertion.
  await expect(editorTab.or(homeTab).first()).toBeVisible({ timeout: 45_000 });

  // If the layout came up without a Scripture Editor (single-tab Home layout), open the project
  // from Home so the editor (and its ≡ menu) exists before we try to focus it.
  if ((await editorTab.count()) === 0) {
    await homeTab.click();
    const homeFrame = page.frameLocator('iframe[title="Home"]');
    await homeFrame.locator(`tr:has-text("${projectName}") button:has-text("Open")`).click();
  }

  await expect(editorTab).toBeVisible({ timeout: 15_000 });
  await editorTab.click();

  // The Scripture Editor renders its own toolbar inside its iframe. Click the ≡ ("Project") button.
  const editorFrame = page
    .locator(`iframe[title*="Scripture Editor" i], iframe[title^="${projectName}"]`)
    .first()
    .contentFrame();
  await editorFrame.locator("button[aria-label='Project']").first().click();

  // Click the "Open Interlinearizer for this Project" item contributed by this extension.
  await editorFrame
    .getByRole('menuitem', { name: /Open Interlinearizer for this Project/i })
    .first()
    .click();

  // When the editor has no project selected, the command calls papi.dialogs.selectProject, which
  // opens a floating "Open Interlinearizer" dock tab with the project list. When the editor
  // already has a project (a warm instance), the Interlinearizer tab opens directly instead.
  //
  // `.first()` throughout: on the shared CDP instance a prior test (or a prior call in this one)
  // can leave the picker's floating dock tab mounted, so `.select-project-dialog` may match more
  // than one element. Scoping to `.first()` keeps every read here — the union visibility wait AND
  // the isVisible() branch — out of strict-mode violation, so a leaked picker can't crash this
  // test before closeSelectProjectPickers has a chance to clean it up. See closeSelectProjectPickers.
  const selectProjectDialog = page.locator('.select-project-dialog').first();
  const interlinearizerTab = interlinearizerTabLocator(page);
  await expect(selectProjectDialog.or(interlinearizerTab).first()).toBeVisible({ timeout: 15_000 });
  if (await selectProjectDialog.isVisible()) {
    const projectNameRegex = new RegExp(`^${escapedProjectName}$`, 'i');
    await selectProjectDialog.getByRole('button', { name: projectNameRegex }).click();
  }

  // Wait for the Interlinearizer tab to appear and focus it.
  await expect(interlinearizerTab).toBeVisible({ timeout: 15_000 });
  await interlinearizerTab.click();

  // Close the "Open Interlinearizer" picker tab we just opened. Selecting a project opens the
  // Interlinearizer but leaves the picker's floating dock tab mounted; on the shared CDP instance,
  // where the DOM is never reset between tests, one leaks per open and they accumulate until a bare
  // `.select-project-dialog` read trips strict mode across the whole suite. Closing it here stops
  // the leak at its source. Bounded and best-effort: the picker only appears on the cold path, and
  // a failure to close it is self-healed by closeSelectProjectPickers before the next test runs.
  await closeSelectProjectPickers(page);
}

/**
 * Close every "Open Interlinearizer" project-picker dock tab currently mounted. The picker is the
 * floating dock tab that `papi.dialogs.selectProject` opens (title "Open Interlinearizer",
 * containing a `.select-project-dialog` panel); selecting a project from it opens the
 * Interlinearizer but does not dispose the picker itself.
 *
 * On the shared CDP instance the renderer DOM is never reset between tests, so each leaked picker
 * persists and a bare `.select-project-dialog` locator resolves to N elements — which trips
 * Playwright strict mode on the very next `isVisible()`/`click()` and reddens every downstream
 * test. This closes them via each tab's `.dock-tab-close-btn` (dispatched, mirroring
 * {@link closeInterlinearizerTab}, so an off-viewport tab on small CI viewports still closes).
 *
 * Best-effort and non-throwing: a picker that refuses to close must not fail the caller, because
 * the picker is incidental cleanup, not the behavior under test. It is bounded so a tab that won't
 * close can't spin forever.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves once no picker tab remains, or after the bounded attempts are exhausted (a
 *   no-op on the common warm path where no picker was ever opened).
 */
export async function closeSelectProjectPickers(page: Page): Promise<void> {
  const pickerTab = page.locator('.dock-tab', { hasText: 'Open Interlinearizer' });

  // Bounded so a picker that refuses to close can't spin forever. The realistic worst case is a
  // handful of leaked pickers from earlier crashed tests plus the one this call opened.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const remaining = await pickerTab.count();
    if (remaining === 0) return;
    // eslint-disable-next-line no-await-in-loop
    await pickerTab
      .first()
      .locator('.dock-tab-close-btn')
      .dispatchEvent('click')
      .catch(() => {
        /* The tab may have closed between the count() and the dispatch; the next loop re-checks. */
      });
    // Wait for this close to land (count drops) before the next iteration, so we don't race the
    // dock's async tab removal and re-dispatch against the same, still-present tab.
    // eslint-disable-next-line no-await-in-loop
    await expect(pickerTab)
      .toHaveCount(remaining - 1, { timeout: 5_000 })
      .catch(() => {
        /* Slow removal or another picker took its place; the next iteration re-reads and retries. */
      });
  }
}

/**
 * Frame locator for the Interlinearizer WebView's iframe, where all of the extension's own UI
 * (toolbar, token strips, modals) renders.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns A `FrameLocator` scoped to the Interlinearizer WebView iframe.
 */
export function getInterlinearizerFrame(page: Page): FrameLocator {
  // Anchor on titles that START with "Interlinearizer" so this never matches the project-picker
  // dialog ("Open Interlinearizer"), whose title also contains the word. The real WebView title is
  // "Interlinearizer" (optionally suffixed with the unsaved-changes marker), so a prefix match keeps
  // the dirty-state title while excluding the "Open …" picker.
  return page.frameLocator('iframe[title^="Interlinearizer" i]');
}

/**
 * Locator for the Interlinearizer WebView's dock tab. Matches the tab whose title contains
 * "Interlinearizer" while excluding the project-picker dialog's own dock tab ("Open
 * Interlinearizer"), whose title also contains the word. Centralizes the exclusion so callers can't
 * forget it (the `getInterlinearizerFrame` iframe uses a prefix match for the same purpose).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns A `Locator` for the Interlinearizer WebView dock tab.
 */
function interlinearizerTabLocator(page: Page): Locator {
  return page
    .locator('.dock-tab', { hasText: 'Interlinearizer', hasNotText: 'Open Interlinearizer' })
    .first();
}

/**
 * Wait for Platform.Bible and the interlinearizer extension to finish starting up. Combines
 * {@link waitForAppReady} and {@link waitForInterlinearizerReady}, splitting the `timeout` budget
 * across both so an explicit (shorter) budget caps the WHOLE wait, not just the first half.
 *
 * The CDP feature tier passes a short budget (`{ strict: false, timeout: ~30s }`): its shared
 * instance is already proven-settled by global setup, so a per-test readiness wait that runs long
 * means the instance died mid-run, not that startup is slow — and no per-test retry can revive a
 * dead shared instance, so failing fast beats burning the full cold-start budget on every retry.
 * Smoke tests (fresh per-worker instance, genuine cold start) omit `timeout` and keep the generous
 * default.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param options Readiness options forwarded to {@link waitForAppReady}. Feature tests on the shared
 *   CDP instance pass `{ strict: false }` so one stray "Unknown" panel can't cascade across the
 *   tier; smoke tests (fresh per-worker instance) use the default strict cold-start gate.
 * @returns Resolves when `interlinearizer.openForWebView` is listed in `rpc.discover`.
 * @throws If the app or extension do not finish starting up within the `timeout` budget.
 */
export async function waitForAppAndInterlinearizerReady(
  page: Page,
  options: AppReadyOptions = {},
): Promise<void> {
  const start = Date.now();
  await waitForAppReady(page, options);
  // Cap the extension-registration wait by whatever budget remains, so an explicit short `timeout`
  // bounds the combined wait. With no explicit budget (smoke), fall back to this helper's own
  // generous default rather than starving it.
  const remaining =
    options.timeout === undefined ? undefined : options.timeout - (Date.now() - start);
  await waitForInterlinearizerReady(remaining);
}

/**
 * Dismiss any modal left mounted inside the Interlinearizer iframe by a prior failed test, so its
 * full-viewport `tw:modal-overlay` (fixed inset-0 z-50, see src/components/modals/ModalShell.tsx)
 * can't intercept every click in the run that follows.
 *
 * This is the shared-instance recovery step. The CDP fixture connects to one long-lived
 * Platform.Bible instance and never resets its DOM between tests, so a test that dies with a modal
 * open (e.g. a `wipeDraft` whose click timed out) leaves that overlay covering the iframe — which
 * then blocks the NEXT test before it can even open a menu. Running this at the start of the
 * open-Interlinearizer precondition converts that cascade (one real failure reddening every
 * downstream test) into a single self-healed hiccup, and is what makes a CDP retry actually land on
 * a clean instance instead of re-running against the poisoned overlay.
 *
 * Each project modal's only reliable dismiss affordance is its Cancel/secondary button — the
 * dialogs are rendered as a plain `<dialog open>` (not via `showModal()`), so native Escape does
 * not fire their onCancel. Modals can chain (a discard-draft confirm can sit behind another), so
 * cancel in a bounded loop until no overlay remains.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves once no modal overlay remains in the iframe (a no-op on the common clean path).
 */
export async function dismissLeftoverModals(page: Page): Promise<void> {
  const frame = getInterlinearizerFrame(page);
  // Every project modal is a `<dialog>` rendered by ModalShell inside a `tw:modal-overlay`, and
  // that `<dialog>` element is the only one in the iframe — so `frame.locator('dialog')` (the same
  // handle every other modal helper uses) both detects an open modal and scopes the Cancel lookup,
  // with no separate overlay selector needed. The overlay is the invisible click-blocker, but the
  // dialog it wraps is visible exactly when the overlay is.
  const dialog = frame.locator('dialog').first();

  // Bounded so a modal that refuses to close can't spin forever; a couple of chained confirmations
  // is the realistic worst case.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Non-retrying visibility read: on the clean path (no leftover modal) this must fall through
    // immediately rather than wait out a timeout on every single test.
    // eslint-disable-next-line no-await-in-loop
    if (!(await dialog.isVisible())) return;

    // Prefer an explicit Cancel; fall back to any secondary button (e.g. a confirm dialog whose
    // back-out button is labeled differently) so an unexpected modal still gets dismissed.
    const cancelButton = dialog.getByRole('button', { name: /Cancel|Keep|Close|No\b/i }).first();
    // eslint-disable-next-line no-await-in-loop
    if (await cancelButton.isVisible()) {
      // eslint-disable-next-line no-await-in-loop
      await cancelButton.click();
    } else {
      // No recognizable back-out control — press Escape as a last resort and stop retrying, since a
      // further loop would just re-click the same unknown modal.
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Escape');
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await expect(dialog)
      .not.toBeVisible({ timeout: 5_000 })
      .catch(() => {
        /* Another modal may have taken its place; the next loop iteration handles it. */
      });
  }
}

/**
 * Ensure the Interlinearizer is open and focused, reusing an existing tab when one is present.
 * Standard precondition for feature tests running against the shared CDP instance: an existing
 * Interlinearizer tab is trusted to be on the WEB project (the shared instance is only ever used
 * with WEB — see e2e-tests/README.md); otherwise the tab is opened fresh via the Scripture Editor
 * menu flow. Resolves only once the extension's toolbar has rendered inside the iframe.
 *
 * As the first shared precondition every feature test runs, this also self-heals two kinds of
 * leftover state a prior failed test can leave on the shared CDP instance: any modal left mounted
 * in the iframe (via {@link dismissLeftoverModals}, whose overlay would otherwise intercept this
 * test's clicks) and any "Open Interlinearizer" project-picker dock tab left open (via
 * {@link closeSelectProjectPickers}, whose accumulation would otherwise trip strict mode on the
 * `.select-project-dialog` locator). A test that dies mid-open — e.g. the renderer is torn down
 * before it can close its picker — is exactly how one picker leaks and then reddens every
 * downstream test, so clearing it here is what keeps that single crash from cascading.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the Interlinearizer tab is focused and its toolbar is interactive.
 * @throws If the Interlinearizer cannot be opened or its toolbar does not render within the
 *   timeouts.
 */
export async function ensureInterlinearizerOpenOnWeb(page: Page): Promise<void> {
  const interlinearizerTab = interlinearizerTabLocator(page);

  // Settle the dock layout before the non-retrying isVisible() branch below. The readiness helpers
  // only poll rpc.discover, not the DOM, so without this a not-yet-painted Interlinearizer tab (or
  // one just closed by a prior test) would read as "absent" and send us needlessly down the full
  // open-from-editor flow. Wait until either the Interlinearizer tab or some editor/Home anchor tab
  // is mounted, so isVisible() reflects a settled layout. When BOTH are present (the common case:
  // an Interlinearizer tab alongside the WEB/editor tab), the union resolves to two elements, so
  // `.first()` on the whole `.or()` keeps the visibility assertion out of strict-mode violation —
  // per-operand `.first()` does not collapse the union to a single match.
  const anchorTab = page.locator('.dock-tab', { hasText: /Scripture Editor|Home|WEB/ }).first();
  await expect(interlinearizerTab.or(anchorTab).first()).toBeVisible({ timeout: 30_000 });

  if (await interlinearizerTab.isVisible()) {
    await interlinearizerTab.click();
  } else {
    await openInterlinearizerFromScriptureEditor(page);
  }
  const frame = getInterlinearizerFrame(page);
  await expect(frame.locator("button[aria-label='Project']").first()).toBeVisible({
    timeout: 30_000,
  });

  // Self-heal the shared instance before this test starts driving the UI: clear any modal a prior
  // failed test left mounted (its overlay would intercept the clicks below) and any project-picker
  // dock tab a prior test left open (its accumulation would trip strict mode on the
  // `.select-project-dialog` locator). The picker cleanup covers the warm path too, where
  // openInterlinearizerFromScriptureEditor never runs and so never gets a chance to close a picker
  // leaked by an earlier crash.
  await dismissLeftoverModals(page);
  await closeSelectProjectPickers(page);
}

/**
 * Navigate the platform's book-chapter-verse control to the given scripture reference so tests can
 * assert against known text. Opens the toolbar's reference combobox, types the reference, and
 * submits it. Requires a fully-qualified reference (book, chapter, and verse — e.g. `"GEN 1:1"`);
 * partial references are ambiguous and are not auto-submitted by the control.
 *
 * The platform toolbar's book-chapter control only drives navigation when there is a resolved
 * navigation-target web view — in simple (non-power) interface mode that is always the MAIN
 * Scripture editor, never a focused secondary tab like the Interlinearizer (this is paranext-core's
 * navigation-target logic). The self-launched CDP instance comes up in simple mode with no project
 * loaded into the main editor, so the control stays `disabled` and can navigate nothing. A plain
 * `trigger.click()` there never fails — Playwright retries the click for the whole test timeout
 * waiting for the button to become enabled, which is what hung every feature test for 6 minutes. So
 * this waits a BOUNDED time for the control to become actionable and, if it never does, skips
 * navigation instead of hanging: the Interlinearizer opens at its default reference (GEN 1:1) and
 * the callers assert against specific verse tokens with their own visibility waits, so a skipped
 * no-op navigation to a reference already on screen still lets the test proceed (and a
 * genuinely-needed navigation that could not happen surfaces as a fast, clear assertion failure
 * downstream rather than an opaque timeout here).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param reference Fully-qualified scripture reference to navigate to (e.g. `"GEN 1:1"`).
 * @returns Resolves once the reference has been submitted, or once navigation has been skipped
 *   because the toolbar control is not drivable in the current interface mode.
 * @throws If the control is enabled but its popover does not open or close within the timeouts.
 */
export async function navigateToScriptureRef(page: Page, reference: string): Promise<void> {
  const trigger = page.locator('button[aria-label="book-chapter-trigger"]').first();

  // Bounded wait for the control to become enabled. In simple mode with no main-editor project it
  // never enables, so cap the wait and skip rather than let the later click() burn the test timeout.
  // `expect(...).toBeEnabled` polls with a real timeout (unlike `Locator.isEnabled`, which reads
  // once); swallow its rejection into a boolean so the disabled case is a skip, not a throw.
  const enabled = await expect(trigger)
    .toBeEnabled({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!enabled) {
    console.log(
      `navigateToScriptureRef: skipping navigation to "${reference}" — the platform book-chapter ` +
        'control is disabled (simple interface mode with no navigable target). The view stays at ' +
        'its current/default reference.',
    );
    return;
  }

  await trigger.click();
  const input = page.locator('input[cmdk-input]').first();
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(reference);
  await input.press('Enter');
  // The popover closes when the reference is accepted.
  await expect(input).not.toBeVisible({ timeout: 5_000 });
}

/**
 * Open the Interlinearizer's ≡ ("Project") top menu inside its iframe and wait for the dropdown to
 * appear.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns The frame locator for the Interlinearizer iframe, for chaining menu-item clicks.
 * @throws If the menu button or the opened menu does not become visible within the timeouts.
 */
export async function openInterlinearizerProjectMenu(page: Page): Promise<FrameLocator> {
  const frame = getInterlinearizerFrame(page);
  const projectMenuButton = frame.locator("button[aria-label='Project']").first();
  await expect(projectMenuButton).toBeVisible({ timeout: 15_000 });
  await projectMenuButton.click();
  await expect(frame.locator('[role="menu"]')).toBeVisible({ timeout: 5_000 });
  return frame;
}

/** Name of the dedicated interlinear project the mutating feature tests operate on. */
export const E2E_PROJECT_NAME = 'E2E Test Project';

/** Name prefix for projects created to rescue a developer's unsaved draft work. */
const RESCUE_PROJECT_PREFIX = 'e2e-rescued-work';

/**
 * Glyph the Interlinearizer appends to its dock tab title while the draft has unsaved changes. Only
 * the glyph must match production's UNSAVED_TAB_MARKER in src/components/InterlinearizerLoader.tsx
 * (which prefixes it with a space); this constant is used exclusively in substring checks, so the
 * surrounding whitespace is deliberately not replicated.
 */
const UNSAVED_TAB_MARKER = '●';

/**
 * Read whether the draft has unsaved changes from the Interlinearizer dock tab's title marker (the
 * only place the dirty state is observable outside the WebView).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns `true` when the tab title carries the unsaved-changes glyph.
 */
async function isDraftDirty(page: Page): Promise<boolean> {
  const tabText = await interlinearizerTabLocator(page).textContent();
  return (tabText ?? '').includes(UNSAVED_TAB_MARKER);
}

/**
 * Open the "Select Interlinear Project" modal from the Project menu and wait for its project list
 * to finish loading (the modal's buttons are disabled while the fetch is in flight).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns The frame locator for the Interlinearizer iframe, for chaining clicks in the modal.
 * @throws If the modal does not open or its list does not finish loading within the timeouts.
 */
async function openSelectProjectModal(page: Page): Promise<FrameLocator> {
  const frame = await openInterlinearizerProjectMenu(page);
  await frame
    .getByRole('menuitem', { name: /Select Interlinear Project/i })
    .first()
    .click();
  await expect(frame.locator('#select-project-modal-title')).toBeVisible({ timeout: 10_000 });
  await expect(frame.locator('dialog').getByRole('button', { name: 'Cancel' })).toBeEnabled({
    timeout: 10_000,
  });
  return frame;
}

/**
 * Preserve the current draft by saving it as a brand-new, timestamped rescue project (Project menu
 * → Save As… → "Save as New Project"). Used before the e2e project replaces a dirty draft that may
 * hold a developer's unsaved work, so nothing is silently discarded. Clears the draft's
 * unsaved-changes state as a side effect (the rescue project becomes the active Save target).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the Save As modal has closed and the unsaved marker has cleared.
 * @throws If the Save As modal does not open, close, or clear the unsaved marker within the
 *   timeouts.
 */
async function rescueDraftToNewProject(page: Page): Promise<void> {
  const frame = await openInterlinearizerProjectMenu(page);
  await frame
    .getByRole('menuitem', { name: /^Save As/i })
    .first()
    .click();

  const saveAsTitle = frame.locator('#save-as-modal-title');
  await expect(saveAsTitle).toBeVisible({ timeout: 10_000 });
  await frame.locator('#save-as-name').fill(`${RESCUE_PROJECT_PREFIX}-${Date.now()}`);
  await frame.getByTestId('save-as-new').click();
  await expect(saveAsTitle).not.toBeVisible({ timeout: 10_000 });

  // The save clears the unsaved marker; wait for it so later dirty checks read the new state.
  await expect(interlinearizerTabLocator(page)).not.toContainText(UNSAVED_TAB_MARKER, {
    timeout: 10_000,
  });
}

/**
 * Make the dedicated e2e project ({@link E2E_PROJECT_NAME}) the active project, creating it if it
 * does not exist yet, so mutating tests never touch a developer's own projects. Opening a project
 * replaces the draft (the single per-source working buffer), so when the draft is dirty and the
 * active project is NOT the e2e project — i.e. the unsaved work may be a developer's, not leftover
 * test data — it is first rescued into a new `e2e-rescued-work-*` project instead of being
 * discarded. Dirty state left while the e2e project is active is treated as leftover test data and
 * discarded via the confirm dialog.
 *
 * Mutating tests call this at the START (with rescue on) to establish their precondition, and again
 * at the END (with rescue off) to discard their own leftovers so the next run starts clean.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param opts Options object.
 * @param opts.rescueDirtyDraft Whether a dirty draft not owned by the e2e project is rescued before
 *   being replaced (default `true`). Pass `false` only at the end of a test, where the dirty state
 *   is known to be the test's own leftovers.
 * @returns Resolves when the e2e project is active and all modals have closed.
 * @throws If the modals do not open/close or the project cannot be selected or created within the
 *   timeouts.
 */
export async function ensureE2eProjectActive(
  page: Page,
  opts: { rescueDirtyDraft?: boolean } = {},
): Promise<void> {
  const { rescueDirtyDraft = true } = opts;

  let dirty = await isDraftDirty(page);
  let frame = await openSelectProjectModal(page);
  let dialog = frame.locator('dialog');

  // Locate the E2E entry by its project-name element with an EXACT text match, then walk up to the
  // enclosing entry button. Matching the whole button's accessible name doesn't work: the modal
  // renders the name, an optional "Active" badge, and the analysis languages as adjacent inline
  // <span>s with no separating whitespace, so the accessible name reads "E2E Test Projecten" —
  // there is no space after the name to anchor on. An exact-text match on the name element also
  // avoids matching a different project whose name merely starts with E2E_PROJECT_NAME (e.g. "E2E
  // Test Project 2"). Keep in sync with SelectInterlinearProjectModal's entry markup.
  const activeEntry = dialog.locator('button[aria-current="true"]');
  const activeIsE2e =
    (await activeEntry.count()) > 0 &&
    (await activeEntry.first().getByText(E2E_PROJECT_NAME, { exact: true }).count()) > 0;

  if (dirty && !activeIsE2e && rescueDirtyDraft) {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(frame.locator('#select-project-modal-title')).not.toBeVisible({ timeout: 5_000 });
    await rescueDraftToNewProject(page);
    dirty = false;
    frame = await openSelectProjectModal(page);
    dialog = frame.locator('dialog');
  }

  const selectTitle = frame.locator('#select-project-modal-title');
  // Rebuilt against the (possibly re-opened) dialog so it targets the current modal instance.
  const e2eEntry = dialog
    .locator('button', { has: frame.getByText(E2E_PROJECT_NAME, { exact: true }) })
    .first();
  if ((await e2eEntry.count()) > 0) {
    await e2eEntry.click();
    if (dirty) {
      // Replacing a dirty draft asks for confirmation; anything worth keeping was rescued above.
      const discardConfirm = frame.getByTestId('discard-draft-confirm');
      await expect(discardConfirm).toBeVisible({ timeout: 5_000 });
      await discardConfirm.click();
    }
  } else {
    await dialog.getByRole('button', { name: 'Create New' }).click();
    const createTitle = frame.locator('#create-project-modal-title');
    await expect(createTitle).toBeVisible({ timeout: 5_000 });
    await frame.locator('#project-name').fill(E2E_PROJECT_NAME);
    await frame.locator('dialog').getByRole('button', { name: 'Create' }).click();
    // Creating a draft over a dirty one defers behind the discard confirmation instead of closing
    // the create modal (handleCreateDraft in ProjectModals.tsx), so dismiss it when dirty.
    if (dirty) {
      const discardConfirm = frame.getByTestId('discard-draft-confirm');
      await expect(discardConfirm).toBeVisible({ timeout: 5_000 });
      await discardConfirm.click();
    }
    await expect(createTitle).not.toBeVisible({ timeout: 10_000 });
  }
  await expect(selectTitle).not.toBeVisible({ timeout: 10_000 });
}

/**
 * Wipe the entire draft's analysis via the visible UI (Project menu → Wipe… → "Entire draft" →
 * Wipe). Standard reset step for mutating feature tests on the shared CDP instance: run it at the
 * START of a test (never at the end) so a previously failed run self-heals instead of poisoning the
 * next one.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the wipe dialog has closed after confirming.
 * @throws If the wipe dialog does not open or does not close after confirming.
 */
export async function wipeDraft(page: Page): Promise<void> {
  const frame = await openInterlinearizerProjectMenu(page);
  await frame.getByRole('menuitem', { name: /Wipe/i }).first().click();

  const wipeDialogTitle = frame.locator('#wipe-modal-title');
  await expect(wipeDialogTitle).toBeVisible({ timeout: 5_000 });
  const scopeAll = frame.getByTestId('wipe-scope-all');
  // `force`: the radio reads visible+enabled+stable, but on a slow/software-rendered CI display the
  // just-opened modal overlay hasn't won the hit-test yet, so a normal click is intercepted by the
  // iframe's own `#root` for a few frames and then times out (the original gloss-roundtrip CI
  // failure). We've already asserted this modal is open and are targeting an element inside it by a
  // unique test id, so skipping the (spuriously-failing) hit-test check is safe here.
  await expect(scopeAll).toBeEnabled({ timeout: 5_000 });
  await scopeAll.check({ force: true });
  await frame.getByTestId('wipe-confirm').click({ force: true });
  await expect(wipeDialogTitle).not.toBeVisible({ timeout: 10_000 });
}

/**
 * Close the Interlinearizer dock tab via its close button and wait for it to disappear. Used by
 * tests that verify draft persistence across a close/reopen cycle.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the Interlinearizer tab is gone.
 * @throws If the tab is not visible, or the tab does not close within the timeout.
 */
export async function closeInterlinearizerTab(page: Page): Promise<void> {
  const interlinearizerTab = interlinearizerTabLocator(page);
  await expect(interlinearizerTab).toBeVisible({ timeout: 15_000 });
  // Dispatch the click rather than hover()+click(): the close button is only laid out on hover, and
  // on small CI viewports the tab can overflow the tab strip and sit outside the viewport, where a
  // real click (even with force) fails. dispatchEvent doesn't require the element to be in-viewport.
  // Mirrors paranext-core's own dock-tab close helpers.
  await interlinearizerTab.locator('.dock-tab-close-btn').dispatchEvent('click');
  await expect(interlinearizerTab).not.toBeVisible({ timeout: 10_000 });
}
