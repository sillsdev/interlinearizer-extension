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
import { killProcessTree, removeDirWithRetry, waitForProcessExit } from '../process-utils';

const DEFAULT_WEBSOCKET_PORT = 8876;
const RPC_DISCOVER_POLL_INTERVAL_MS = 250;
export const PROCESS_READY_TIMEOUT = process.env.CI ? 600_000 : 120_000;

/**
 * Fail-fast readiness budget (ms) for a CDP feature test's per-test wait (the `{ cdp: true }`
 * profile). The shared instance is already settled by global setup, so a long per-test wait means
 * it died mid-run — a short cap fails fast instead of burning the full cold-start budget.
 */
const CDP_FEATURE_READY_TIMEOUT = 30_000;

/**
 * File the smoke launcher streams the app's main-process stdout/stderr to. Kept in `e2e-tests/`
 * (which Playwright doesn't clear and CI uploads as an artifact) so a failed run's log survives.
 * Appended to (not truncated) across launches, each attempt preceded by a delimiter, so a
 * Playwright retry doesn't overwrite the previous failed attempt's output — every attempt's log is
 * uploaded.
 */
const SMOKE_APP_LOG_FILE = path.join(__dirname, '..', '.smoke-app-startup.log');

/**
 * Same serialized request type as `registerCommand('platform.about', ...)` in command.service
 * (`command` + `:` + `platform.about`).
 */
const PLATFORM_ABOUT_COMMAND = 'command:platform.about';

/**
 * Serialized PAPI request for `ProjectLookupService.getMetadataForAllProjects` (see
 * `network-object.service.ts` `getNetworkObjectRequestType`). Mirrors paranext-core's helpers.
 * Unlike {@link SERVICE_HOST_OBJECT_METHODS}, this is coupled to both the object id and the method
 * name; if paranext-core renames either, this stops matching and times out.
 */
const PROJECT_LOOKUP_GET_ALL_PROJECTS_METHOD =
  'object:ProjectLookupService.getMetadataForAllProjects';

/**
 * `rpc.discover` method names that appear once paranext-core's settings, menu-data, and theme
 * service hosts register their provider network objects — the signal that gates a resolved dock
 * (see {@link waitForServiceHostsRegistered}).
 *
 * These are each object's bare EXISTENCE handler (`object:{id}`, no method suffix), which registers
 * first when a network object comes up, so it can't be invalidated by a provider method being
 * renamed. Mirrors upstream's serialization; update if paranext-core renames its provider objects.
 */
const SERVICE_HOST_OBJECT_METHODS = [
  'object:platform.settingsServiceDataProvider-data',
  'object:platform.menuDataServiceDataProvider-data',
  'object:platform.themeServiceDataProvider-data',
];

/**
 * Renderer page error that means this cold start is doomed, not merely slow: the theme host's
 * initial theme data never settled, so the dock's webview tabs stay stuck at "Unknown" for the rest
 * of the run. Only a fresh launch (a smoke retry, or a re-run of CDP setup) recovers it.
 *
 * This fires AFTER the theme provider's network object has registered, so
 * {@link waitForServiceHostsRegistered} can pass while the renderer is still headed for this timeout
 * — hence the tab-title wait fast-fails on it. Matches an upstream paranext-core message; if that
 * message changes, this stops catching the doomed start.
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
 * Path to paranext-core's shared dev-appdata settings file. In development mode Platform.Bible
 * reads this file at startup to restore settings, so writing it before launching Electron is how
 * E2E tests pre-configure settings (e.g. suppressing the first-run wizard). Resolved relative to
 * the sibling `paranext-core` checkout the app is launched from.
 */
export const DEV_APPDATA_SETTINGS_PATH = path.resolve(
  __dirname,
  '../../../paranext-core/dev-appdata/data/settings.json',
);

/**
 * Settings overrides seeded before every e2e launch, both tiers (see {@link backupAndSeedSettings}
 * callers in fixtures/app.fixture.ts and global-setup-cdp.ts). Suppresses the first-run wizard
 * overlay and forces Power interface mode.
 *
 * Forcing Power mode is a stopgap, not the end goal: paranext-core's Simple mode (the default)
 * hides the dock tab bars this suite's `.dock-tab` locators and cold-start readiness gate depend
 * on. The suite should eventually cover both modes rather than forcing Power mode for every test.
 */
export const E2E_SETTINGS_OVERRIDES: Record<string, unknown> = {
  'platform.firstRunComplete': true,
  'platform.interfaceMode': 'power',
};

/**
 * File the pre-launch dev-appdata settings backup is written to (kept in `e2e-tests/`, alongside
 * the `.cdp-*` run-marker files). Shared by BOTH the smoke and CDP tiers, not one file per tier:
 * there is only one `settings.json` to protect, so a stale backup left by either tier's crashed run
 * can be recovered by the other tier's own self-heal (see {@link backupAndSeedSettings}).
 */
const SETTINGS_BACKUP_FILE = path.join(__dirname, '..', '.e2e-settings-backup');

/** Marker stored in {@link SETTINGS_BACKUP_FILE} when no settings file existed before seeding. */
const SETTINGS_ABSENT_SENTINEL = '__SETTINGS_ABSENT__';

/**
 * Back up paranext-core's dev-appdata settings file to {@link SETTINGS_BACKUP_FILE} (recording
 * {@link SETTINGS_ABSENT_SENTINEL} if no file exists yet) and merge `overrides` into it. Must be
 * called BEFORE launching Electron so the app reads the overrides at startup.
 *
 * Self-heals a stale backup left by a prior hard-killed run of EITHER tier (restoring it first), so
 * the backup always captures the true original settings, never an already-seeded file.
 *
 * @param overrides Setting keys to merge into the file (e.g. `{ 'platform.firstRunComplete': true
 *   }`).
 * @returns Nothing.
 */
export function backupAndSeedSettings(overrides: Record<string, unknown>): void {
  restoreBackedUpSettings();

  const settingsDir = path.dirname(DEV_APPDATA_SETTINGS_PATH);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(DEV_APPDATA_SETTINGS_PATH)) {
    const original = fs.readFileSync(DEV_APPDATA_SETTINGS_PATH, 'utf-8');
    fs.writeFileSync(SETTINGS_BACKUP_FILE, original);
    try {
      const parsed: unknown = JSON.parse(original);
      // Preserve existing settings only when the file holds a JSON object; a corrupt or non-object
      // file falls back to just the overrides.
      if (parsed && typeof parsed === 'object') existing = { ...parsed };
    } catch {
      // Corrupt file — overwrite with just the overrides.
    }
  } else {
    // Record absence so restoreBackedUpSettings deletes the file this seed creates rather than
    // leaving it behind.
    fs.writeFileSync(SETTINGS_BACKUP_FILE, SETTINGS_ABSENT_SENTINEL);
  }
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(DEV_APPDATA_SETTINGS_PATH, JSON.stringify({ ...existing, ...overrides }));
}

/**
 * Undo {@link backupAndSeedSettings}: restore the dev-appdata settings file from
 * {@link SETTINGS_BACKUP_FILE} (or delete it if the backup marks that no settings file existed
 * before seeding), then remove the backup marker. A no-op when no backup exists. Best-effort:
 * guarded so a settings-restore failure never throws.
 *
 * @returns Nothing.
 */
export function restoreBackedUpSettings(): void {
  if (!fs.existsSync(SETTINGS_BACKUP_FILE)) return;
  try {
    const backup = fs.readFileSync(SETTINGS_BACKUP_FILE, 'utf-8');
    if (backup === SETTINGS_ABSENT_SENTINEL) fs.rmSync(DEV_APPDATA_SETTINGS_PATH, { force: true });
    else fs.writeFileSync(DEV_APPDATA_SETTINGS_PATH, backup);
    fs.rmSync(SETTINGS_BACKUP_FILE, { force: true });
  } catch (error) {
    console.warn(`Could not restore dev-appdata settings from ${SETTINGS_BACKUP_FILE}: ${error}`);
  }
}

/**
 * Pre-configure paranext-core's dev-appdata settings before launching the smoke tier's per-worker
 * Electron instance (e.g. suppressing the first-run wizard), backing up the original to disk (see
 * {@link backupAndSeedSettings}) rather than only in memory — so a hard-killed worker process (CI
 * timeout SIGKILL, Ctrl+C) leaves a recoverable backup instead of losing the developer's original
 * settings with the process.
 *
 * @param overrides Setting keys to merge into the file (e.g. `{ 'platform.firstRunComplete': true
 *   }`).
 * @returns A restore function that puts the file back to its exact pre-call contents (or deletes it
 *   if it did not exist). Call it AFTER the app has closed so the developer's saved settings are
 *   not permanently replaced by test values.
 */
export function preConfigureSettings(overrides: Record<string, unknown>): () => void {
  backupAndSeedSettings(overrides);
  return restoreBackedUpSettings;
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
    // With NODE_ENV=development, paranext-core auto-opens DevTools on every window; on CI Linux that
    // docks inside the window and squeezes the viewport so dock panels collapse and clicks land on
    // neighboring iframes. ELECTRON_IS_DEV=0 disables the auto-open without changing other
    // NODE_ENV-driven behavior (dev-server URL, etc.).
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
        // (local headless runs), Electron otherwise picks Wayland and segfaults when the compositor
        // socket is unreachable. No-op on CI runners (X11-only).
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

  // Stream the app's main-process stdout/stderr to a log file so a cold-start stall (dock tabs stuck
  // at "Unknown") leaves evidence to diagnose from; the renderer console is empty in that case.
  // Append rather than truncate so a Playwright retry preserves the previous attempt's log instead
  // of overwriting it; a delimiter separates attempts within the single uploaded artifact.
  const appLog = fs.createWriteStream(SMOKE_APP_LOG_FILE, { flags: 'a' });
  appLog.on('error', () => {
    /* Logging is best-effort; never let a log write failure break the launch. */
  });
  appLog.write(`\n===== launch attempt @ ${new Date().toISOString()} =====\n`);
  const appProcess = electronApp.process();
  // { end: false } on BOTH pipes: two sources share one destination, so the default end-on-source-end
  // would have whichever stream closes first call appLog.end(), dropping the other's later output and
  // throwing "write after end". We own appLog's lifecycle instead (closed on app exit, below).
  appProcess.stdout?.pipe(appLog, { end: false });
  appProcess.stderr?.pipe(appLog, { end: false });
  electronApp.once('close', () => {
    appLog.end();
  });

  console.log('Waiting for WebSocket server on port 8876...');
  try {
    await waitForWebSocketReady(DEFAULT_WEBSOCKET_PORT, PROCESS_READY_TIMEOUT);
  } catch (error) {
    console.error('WebSocket readiness check failed after Electron launch:', error);
    // Flush buffered pipe output to disk before dumpSmokeAppLog reads it back: the app is still
    // alive (killed below), so ending appLog ourselves is what forces the flush.
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
 * Flush and close the smoke app-log write stream, resolving once its buffered data has reached disk
 * so a following read of the file sees the captured output rather than an empty buffer.
 * Best-effort: a stream error resolves rather than rejects.
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
    await waitForProcessExit(appClosed, 3_000);
    console.log('[teardown] Done waiting after SIGKILL');
  }

  console.log('[teardown] Cleaning up user data dir...');
  await removeDirWithRetry(userDataDir, 'user data dir');
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
 * This is the upstream readiness signal for a resolved dock: on a cold start the renderer paints
 * its webview tabs "Unknown" (and panels blank) until these hosts serve their metadata. Gating here
 * — before {@link waitForDockTabTitlesResolved} — means the tab-title wait only runs once the data
 * behind those titles exists, rather than surfacing the race as an opaque downstream timeout. On a
 * healthy startup the hosts are already up, so this resolves immediately.
 *
 * The three waits run concurrently and share the one `timeout` budget (the hosts register in
 * parallel, so serializing would triple the worst-case wait for no benefit).
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
   *   fresh per-worker instance (smoke tests, CDP global setup), where all-"Unknown" tabs mean a
   *   genuinely broken instance and there are no unrelated tabs to interfere.
   * - `false` (shared/warm): the dock is mounted and AT LEAST ONE tab has a resolved title. Correct
   *   for the shared CDP feature instance, already settled by global setup. The strict check is
   *   fragile there: one stray/leftover "Unknown" panel would fail the gate for every subsequent
   *   test against the shared instance, and no per-test retry can recover it.
   */
  strict: boolean;
}

/**
 * Run `fn` with a fatal-startup-error tripwire armed on `page`: if the renderer emits a
 * {@link FATAL_STARTUP_PAGE_ERROR} while `fn` is in flight, the returned promise rejects immediately
 * with a fast, correctly-labeled failure instead of `fn` running out its full readiness budget.
 *
 * It wraps the WHOLE readiness sequence (service-host wait AND dock-tab wait) because the fatal
 * theme-settle error can surface during either and never self-recovers.
 *
 * The listener is registered only when `enabled` (a warm shared instance leaves it off, so a stale
 * error from a long-past cold start can't abort an otherwise-healthy wait), and always removed in
 * `finally` so it can't leak across tests on the shared CDP page. A sentinel distinguishes
 * "tripwire fired" from an ordinary `fn` rejection, so only a genuine fatal error is remapped to
 * the fast failure.
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
  // Swallow the never-taken rejection path so it can't surface as an unhandled rejection.
  fatalErrorTripped.catch(() => {});

  try {
    return await Promise.race([fn(), fatalErrorTripped]);
  } catch (error) {
    // The tripwire won the race: this cold start is doomed (theme data never settled), so report it
    // as its own fast failure. Only a fresh launch recovers it.
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
 * cold start the dock mounts with tabs titled "Unknown" (and blank panels) until project metadata
 * resolves, and every tab-title-based locator in this suite silently times out against that state;
 * waiting it out here turns those opaque per-test timeouts into a pass or one clear early failure.
 *
 * The strictness of "resolved" depends on {@link DockTabTitlesOptions.strict}. A torn-down renderer
 * (page/context/browser closed) is surfaced as its own error rather than mislabeled "tabs still
 * Unknown". A doomed cold start (see {@link FATAL_STARTUP_PAGE_ERROR}) is aborted early by
 * {@link withFatalStartupTripwire}, which callers wrap around the whole readiness sequence; this
 * wait does not arm that tripwire itself.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param timeout Maximum time in milliseconds to wait before throwing. Must be positive: Playwright
 *   treats `waitForFunction({ timeout: 0 })` as an unbounded wait, so a non-positive value (an
 *   already-exhausted budget) is failed fast rather than forwarded, to avoid hanging on the exact
 *   "Unknown"-tab stall this helper bounds.
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
  // { timeout: 0 } disables Playwright's timeout (unbounded wait), so an already-exhausted budget
  // would hang instead of failing. Fail fast instead.
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
        // Strict: no tab may be "Unknown". Lenient: at least one has resolved.
        return isStrict ? tabs.every(isResolved) : tabs.some(isResolved);
      },
      strict,
      { timeout, polling: 500 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A closed page is a torn-down renderer, not a project-metadata stall — report it as such so
    // it isn't chased as the "Unknown tabs" startup race it superficially resembles.
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
 * Gating on the service hosts first (see {@link waitForServiceHostsRegistered}) is what makes the
 * tab-title wait meaningful: the tabs stay "Unknown" until those hosts serve their metadata, so the
 * tab-title poll only runs once the data behind the titles exists. On a healthy startup the hosts
 * are already up.
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
  // Floor each leftover budget to 1000ms: a preceding stage can resolve at the last millisecond,
  // leaving a non-positive or single-digit remainder that would trip waitForDockTabTitlesResolved's
  // exhausted-budget guard, or expire during its forwarded page.waitForFunction round-trip and fail
  // "tabs still Unknown" on a healthy app. 1000ms lets each stage run one real poll.
  const budgetLeft = () => Math.max(1_000, timeout - (Date.now() - start));
  // Arm the fatal-startup tripwire around both waits (the fatal theme-settle error can surface in
  // either). It mirrors `strict`: a strict cold start (smoke) arms it, since a fatal error dooms
  // THIS launch; the lenient shared-instance path leaves it off so a stale error can't abort a
  // healthy per-test wait.
  await withFatalStartupTripwire(page, strict, async () => {
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
 * Poll until `ProjectLookupService.getMetadataForAllProjects` returns at least one project.
 *
 * The bundled sample WEB project installs into the project root asynchronously, independently of
 * dock/extension readiness — this closes that race explicitly instead of relying on a locator's own
 * actionability timeout.
 *
 * The default is sized from CI, not guessed. Core logs `No projects found. Setting up sample WEB
 * project` and then installs; a cold Windows runner has been seen still going past 60s, which
 * failed the attempt even though nothing was wrong. The install persists in the project root (only
 * the user-data dir is per-launch), so it is a one-time cost per machine that the next attempt
 * inherits — which is exactly why those runs went red then green on retry. Waiting it out on the
 * first attempt costs nothing on a warm machine and saves a retry on a cold one.
 *
 * @param timeoutMs Maximum time in milliseconds to poll before throwing.
 * @returns Resolves once at least one project is registered.
 * @throws {Error} If no project is registered within `timeoutMs` milliseconds.
 */
export async function waitForAtLeastOneProjectMetadata(timeoutMs = 150_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - start);
    try {
      const result = await sendPapiRequestOnce<unknown[]>(
        PROJECT_LOOKUP_GET_ALL_PROJECTS_METHOD,
        [],
        DEFAULT_WEBSOCKET_PORT,
        Math.min(10_000, Math.max(1_000, remaining)),
      );
      if (Array.isArray(result) && result.length > 0) return;
    } catch {
      /* Project lookup network object not registered yet; next poll. */
    }
    const sleepMs = Math.min(RPC_DISCOVER_POLL_INTERVAL_MS, timeoutMs - (Date.now() - start));
    if (sleepMs <= 0) break;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, sleepMs);
    });
  }
  throw new Error(`No project metadata registered within ${timeoutMs}ms`);
}

/**
 * How long to wait for the Home WebView to render a project row before treating the tab as one that
 * lost paranext-core's startup race. Deliberately short: callers confirm project metadata is
 * registered first, so a healthy Home has its table up within about a second and this only absorbs
 * render latency. Kept tight because it is spent on EVERY run, including healthy ones, inside a
 * test budget that {@link waitForAtLeastOneProjectMetadata} may already have half-consumed.
 */
const HOME_CONTENT_PROBE_MS = 5_000;

/**
 * How long to wait for project rows after reopening Home. Must exceed the 20s that core's
 * `getWebViewProvider` itself waits for the provider network object, since the reopen's retrieval
 * starts that wait over. Spent only on the recovery path, never on a healthy run.
 */
const HOME_REOPEN_TIMEOUT_MS = 30_000;

/**
 * How long to wait for the closed Home tab to leave the DOM before reopening. Short because the
 * only thing being awaited is rc-dock removing a node; core's auto-reopen may also beat it, which
 * the caller treats as success rather than failure.
 */
const HOME_CLOSE_TIMEOUT_MS = 5_000;

/**
 * Ensure the Home WebView actually rendered its project table, reopening it if it did not.
 *
 * Paranext-core's default dock layout restores a Home WebView eagerly. That restore path waits a
 * fixed 20s for `platformGetResources.home-webViewProvider`, fires the content retrieval exactly
 * once, and only logs on failure — so when extension-host activation overruns that window the tab
 * stays mounted around an empty iframe for the rest of the run. Focusing it does not re-fire the
 * retrieval, and the toolbar's Home command passes `existingId: '?'`, which resolves by looking up
 * any live tab of that webViewType — so it just refocuses the dead tab too.
 *
 * Closing the tab is what forces a fresh `openWebView`, and there are two separate openers that
 * must not both fire. Core reopens Home itself when the closed tab was the last DOCKED one,
 * deciding this synchronously at close time and calling `openWebView` with no `existingId` (so it
 * always mints a new tab, and cannot be deduplicated after the fact). Otherwise nothing reopens
 * Home and the toolbar button has to. Because core's decision is made from the pre-close layout,
 * this reads the tab count BEFORE closing and picks one opener deterministically rather than racing
 * them.
 *
 * Callers must confirm at least one project is registered (see
 * {@link waitForAtLeastOneProjectMetadata}) before calling, so an empty table means a dead WebView
 * rather than projects that have not finished installing.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param homeTab Locator for the Home dock tab.
 * @param homeButton Locator for the toolbar's Home button.
 * @returns Resolves once the Home WebView shows at least one project row.
 * @throws {Error} If Home still shows no project row after being reopened.
 */
async function ensureHomeWebViewLoaded(
  page: Page,
  homeTab: Locator,
  homeButton: Locator,
): Promise<void> {
  // Any row carrying a button proves the table rendered; the caller matches its own project by name.
  const anyProjectRow = () =>
    page.locator('iframe[title="Home"]').first().contentFrame().locator('tr:has(button)').first();

  const rendered = await anyProjectRow()
    .waitFor({ state: 'visible', timeout: HOME_CONTENT_PROBE_MS })
    .then(() => true)
    .catch(() => false);
  if (rendered) return;

  console.warn('Home WebView rendered no project rows — reopening it to rerun content retrieval.');
  // Read the tab count BEFORE closing: it decides which of two mutually exclusive reopen paths
  // applies, and racing them would leave two Home tabs (see the branch comments below).
  const homeWasOnlyTab = (await page.locator('.dock-tab').count()) === 1;
  await homeTab
    .locator('.dock-tab-close-btn')
    .dispatchEvent('click')
    .catch(() => {
      /* Not closable in this layout; the content assertion below is the real gate. */
    });
  // Core's auto-reopen can land before this observes zero tabs, which is a success, not a failure —
  // hence the catch. Only drive the toolbar button when Home genuinely went away.
  const closed = await expect(page.locator('.dock-tab', { hasText: 'Home' }))
    .toHaveCount(0, { timeout: HOME_CLOSE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (closed) {
    if (homeWasOnlyTab) {
      // Core reopens Home itself when the closed tab was the last one, via an `openWebView` that
      // passes NO `existingId`. Clicking the toolbar button into that window would create a second
      // Home — `openHome`'s `existingId` de-dup has nothing to focus yet — and the caller closes
      // only the first Home tab, so its `toHaveCount(0)` gate would then hang. Wait for core's
      // reopen instead, falling back to the button only if it never lands.
      const reopened = await homeTab
        .waitFor({ state: 'visible', timeout: HOME_CLOSE_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!reopened) await homeButton.click();
    } else {
      // Other tabs remain, so core's last-tab auto-reopen does not fire — nothing to race.
      await homeButton.click();
    }
  }

  // Load-bearing beyond just gating the caller: `anyProjectRow` resolves `.first()` on the same
  // `iframe[title="Home"]` selector the caller then clicks "Open" in, so asserting here is what
  // guarantees the FIRST Home iframe is the populated one. Should a duplicate Home ever survive the
  // branch above with the blank one first in the DOM, this fails loudly rather than letting the
  // caller click into an empty frame. Keep the two locators in sync.
  await expect(anyProjectRow()).toBeVisible({ timeout: HOME_REOPEN_TIMEOUT_MS });
}

/**
 * Open the Interlinearizer WebView from the Scripture Editor's top (≡) menu, ensuring the project
 * is loaded into the editor first. Prerequisite stage shared by all e2e tests that require the
 * Interlinearizer to be open.
 *
 * Loading the project into a Scripture Editor is the load-bearing step: it resolves a BCV
 * navigation target (so `navigateToScriptureRef`'s toolbar control is enabled) and lets the ≡ menu
 * open the Interlinearizer directly instead of popping a project-picker dialog. The startup dock
 * layout varies, so this reaches that loaded state resiliently rather than assuming it:
 *
 * - A fresh core profile has been seen opening either with an empty "Scripture Editor" tab and no
 *   Home dock tab (older paranext-core), or directly to an already-open Home tab (current default)
 *   — in both cases the project is opened via Home (the toolbar Home button, always present,
 *   focuses the existing Home tab if one is already open rather than duplicating it).
 * - A warm CDP instance already has the editor open on a project (tab titled e.g. "WEB (Editable)").
 *
 * Steps:
 *
 * 1. Wait for an editor tab to be present (the dock renders async).
 * 2. If no editor tab is titled by the project, open `projectName` from Home (Home button → project
 *    row → "Open"), wait for the editor tab to retitle, then close the Home tab (it opens focused,
 *    overlaying the editor).
 * 3. Focus the project's Scripture Editor tab.
 * 4. Enter the editor iframe and click the ≡ ("Project") menu button.
 * 5. Click "Open Interlinearizer for this Project".
 * 6. Wait for the "Interlinearizer" dock tab and click it.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param projectName Name of the project to load into the editor and open the Interlinearizer for
 *   (default: `"WEB"`).
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
  // An editor tab already showing this project — the only editor state that resolves a navigation
  // target AND lets the ≡ menu open the Interlinearizer directly. A bare "Scripture Editor" tab with
  // no project loaded does neither.
  const loadedEditorTab = page
    .locator('.dock-tab', { hasText: new RegExp(`^${escapedProjectName}\\b`) })
    .first();
  const anyEditorTab = page
    .locator('.dock-tab', { hasText: new RegExp(`^(Scripture Editor|${escapedProjectName})\\b`) })
    .first();
  // The Home dock tab, when one is already open (current default: a fresh profile opens directly to
  // Home rather than an empty "Scripture Editor" tab — see the wait below).
  const homeTab = page.locator('.dock-tab', { hasText: 'Home' }).first();
  // The toolbar's "Home..." button (a ghost icon button wrapping lucide's HomeIcon). Opens Home when
  // it is not already open as its own tab (see the branch below). The svg is `aria-hidden`, so target
  // the enclosing button by the icon class rather than by role/name.
  const homeButton = page.locator('button:has(svg.lucide-house)').first();

  // Wait for the dock layout to mount before branching — a fresh profile briefly reports zero tabs,
  // which a non-waiting `count()` would misread as "no editor". Accept either an editor tab OR an
  // already-open Home tab as evidence of a mounted dock: which one a fresh profile starts with has
  // changed between paranext-core versions, and this helper works against either starting layout.
  await expect(anyEditorTab.or(homeTab).first()).toBeVisible({ timeout: 45_000 });

  // Ensure the project is loaded into a Scripture Editor, not merely that some editor tab exists:
  // without a project-bearing editor, BCV navigation has no target (nav control stays disabled) and
  // the ≡ menu's "Open Interlinearizer" pops a project-picker dialog. Opening the project from Home
  // loads it into the editor. Skipped when a project-titled editor tab is already present (warm CDP
  // instance).
  if ((await loadedEditorTab.count()) === 0) {
    // Home may already be open as its own dock tab (current default) rather than needing the toolbar
    // button to open it (older default, still true for CDP's warm-but-project-less instance) — only
    // click the button when Home isn't already open, rather than relying on a redundant click being a
    // harmless no-op.
    if ((await homeTab.count()) === 0) {
      await homeButton.click();
      await expect(homeTab).toBeVisible({ timeout: 10_000 });
    } else {
      // Home is already open as a tab. Dispatch a click (not a real click, so an off-viewport tab on
      // small CI viewports still closes) to guarantee focus before driving its iframe.
      await homeTab.dispatchEvent('click');
    }
    // `.first().contentFrame()` rather than `frameLocator`, matching the editor lookup below: a
    // duplicate Home (core's last-tab auto-reopen and the toolbar command are separate openers) would
    // make the strict `frameLocator` form fail with a strict-mode violation naming neither Home nor
    // duplication, instead of the real problem.
    const homeFrame = page.locator('iframe[title="Home"]').first().contentFrame();
    // The project row can still be installing even though the dock is ready; wait for it
    // explicitly so a lost race fails clearly here, not as an opaque timeout on the click below.
    await waitForAtLeastOneProjectMetadata();
    // Projects exist now, so an empty Home table means the restored WebView never got its content.
    await ensureHomeWebViewLoaded(page, homeTab, homeButton);
    // Match the project's own row by its EXACT name (`:text-is()`), not a substring (`:has-text()`),
    // so a shorter project name can't select a row for a differently-named project that merely
    // contains it. The name is JSON-encoded before interpolation so a `"` in it can't break out of
    // the selector string.
    await homeFrame
      .locator(`tr:has(:text-is(${JSON.stringify(projectName)})) button:has-text("Open")`)
      .click();
    // Wait for the project to load (tab retitles to the project short name) before continuing.
    await expect(loadedEditorTab).toBeVisible({ timeout: 30_000 });

    // Close the Home tab. It opens as a floating dock tab focused on top of the editor column, and
    // its iframe intercepts pointer events, so the ≡-menu click below would land on Home. Dispatch
    // the close (not a real click, so an off-viewport tab on small CI viewports still closes), then
    // wait for the tab to leave the DOM.
    // Close EVERY Home tab, not just the first: core's last-tab auto-reopen and the toolbar Home
    // command are independent openers, so a recovery can leave two. Closing one and asserting zero
    // would then hang for the full timeout and report a count mismatch rather than the duplication.
    // Bounded, mirroring closeSelectProjectPickers.
    const allHomeTabs = page.locator('.dock-tab', { hasText: 'Home' });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const remaining = await allHomeTabs.count();
      if (remaining === 0) break;
      // eslint-disable-next-line no-await-in-loop
      await allHomeTabs
        .first()
        .locator('.dock-tab-close-btn')
        .dispatchEvent('click')
        .catch(() => {
          /* Home may not have opened as a closable tab in some layouts; the gate below is real. */
        });
      // eslint-disable-next-line no-await-in-loop
      await expect(allHomeTabs)
        .toHaveCount(remaining - 1, { timeout: 10_000 })
        .catch(() => {
          /* Slow removal; the next iteration re-reads the count. */
        });
    }
    await expect(allHomeTabs).toHaveCount(0, { timeout: 10_000 });
  }

  await loadedEditorTab.click();

  // Click the ≡ ("Project") button in the editor's own toolbar. The project is loaded, so the iframe
  // title starts with the project short name (e.g. "WEB (Editable)"), hence a `^=` prefix rather than
  // an exact match. JSON-encode the name so a `"` in it can't break out of the attribute selector.
  const editorFrame = page
    .locator(`iframe[title^=${JSON.stringify(projectName)}]`)
    .first()
    .contentFrame();
  await editorFrame.locator("button[aria-label='Project']").first().click();

  // Click "Open Interlinearizer for this Project". With a project loaded, this opens the
  // Interlinearizer directly (no papi.dialogs.selectProject, so no picker dialog).
  await editorFrame
    .getByRole('menuitem', { name: /Open Interlinearizer for this Project/i })
    .first()
    .click();

  // Wait for the Interlinearizer tab to appear and focus it.
  const interlinearizerTab = interlinearizerTabLocator(page);
  await expect(interlinearizerTab).toBeVisible({ timeout: 15_000 });
  await interlinearizerTab.click();

  // Close any leftover project-picker dock tab. This flow no longer opens one, but on the shared CDP
  // instance a prior test that hit the picker path can leave one mounted, and leaked pickers
  // accumulate (the DOM is never reset) until a `.select-project-dialog` read trips strict mode.
  await closeSelectProjectPickers(page);
}

/**
 * Close every "Open Interlinearizer" project-picker dock tab currently mounted. The picker is the
 * floating dock tab that `papi.dialogs.selectProject` opens (title "Open Interlinearizer",
 * containing a `.select-project-dialog` panel); selecting a project from it opens the
 * Interlinearizer but does not dispose the picker itself.
 *
 * On the shared CDP instance the DOM is never reset between tests, so leaked pickers persist and a
 * `.select-project-dialog` locator resolves to N elements — tripping strict mode on the next
 * `isVisible()`/`click()`. This closes them via each tab's `.dock-tab-close-btn` (dispatched,
 * mirroring {@link closeInterlinearizerTab}, so an off-viewport tab still closes).
 *
 * Best-effort, non-throwing, and bounded: a picker that refuses to close must not fail the caller.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves once no picker tab remains, or after the bounded attempts are exhausted (a
 *   no-op on the common warm path where no picker was ever opened).
 */
export async function closeSelectProjectPickers(page: Page): Promise<void> {
  const pickerTab = page.locator('.dock-tab', { hasText: 'Open Interlinearizer' });

  // Bounded; the realistic worst case is a handful of leaked pickers from earlier crashed tests.
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
    // Wait for the count to drop before the next iteration, so we don't re-dispatch against the
    // same still-present tab while the dock removes it async.
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
  // Prefix match so this excludes the project-picker dialog ("Open Interlinearizer") while still
  // matching the WebView's own title with its optional unsaved-changes suffix.
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

/** Options for {@link waitForAppAndInterlinearizerReady}. */
interface AppAndInterlinearizerReadyOptions {
  /**
   * Select the readiness profile for the shared CDP feature instance instead of a fresh cold start.
   * Defaults to `false` (cold start), correct for the fresh per-worker smoke instance.
   *
   * Pass `true` for a feature test running against the shared, already-settled CDP instance. It
   * couples two behaviors:
   *
   * - The lenient dock-tab gate (see {@link DockTabTitlesOptions.strict}), so one stray "Unknown"
   *   panel can't fail this and every downstream test on the never-reset shared instance.
   * - A short {@link CDP_FEATURE_READY_TIMEOUT} budget. The instance is already settled, so a long
   *   wait means it died mid-run — fail fast rather than burn the full cold-start budget.
   */
  cdp?: boolean;
}

/**
 * Wait for Platform.Bible and the interlinearizer extension to finish starting up. Combines
 * {@link waitForAppReady} and {@link waitForInterlinearizerReady}, splitting the timeout budget
 * across both so an explicit (shorter) budget caps the WHOLE wait, not just the first half.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param options Readiness options; see {@link AppAndInterlinearizerReadyOptions.cdp} for the
 *   shared-CDP-instance profile feature tests pass.
 * @returns Resolves when `interlinearizer.openForWebView` is listed in `rpc.discover`.
 * @throws If the app or extension do not finish starting up within the timeout budget.
 */
export async function waitForAppAndInterlinearizerReady(
  page: Page,
  options: AppAndInterlinearizerReadyOptions = {},
): Promise<void> {
  const { strict, timeout } = options.cdp
    ? { strict: false, timeout: CDP_FEATURE_READY_TIMEOUT }
    : { strict: true, timeout: undefined };
  const start = Date.now();
  await waitForAppReady(page, { strict, timeout });
  // Cap the extension wait by whatever budget remains so an explicit short `timeout` bounds the
  // combined wait; with no explicit budget (smoke), fall back to waitForInterlinearizerReady's own
  // default.
  const remaining = timeout === undefined ? undefined : timeout - (Date.now() - start);
  await waitForInterlinearizerReady(remaining);
}

/**
 * Dismiss any modal left mounted inside the Interlinearizer iframe by a prior failed test, so its
 * full-viewport `tw:modal-overlay` (fixed inset-0 z-50, see src/components/modals/ModalShell.tsx)
 * can't intercept every click in the run that follows.
 *
 * This is the shared-instance recovery step: the CDP fixture never resets its DOM between tests, so
 * a test that dies with a modal open leaves that overlay blocking the next test. Running this at
 * the start of the open-Interlinearizer precondition self-heals it, which is also what lets a CDP
 * retry land on a clean instance.
 *
 * Each project modal's only reliable dismiss affordance is its Cancel/secondary button — the
 * dialogs are a plain `<dialog open>` (not `showModal()`), so native Escape doesn't fire their
 * onCancel. Modals can chain, so cancel in a bounded loop until no overlay remains.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves once no modal overlay remains in the iframe (a no-op on the common clean path).
 */
export async function dismissLeftoverModals(page: Page): Promise<void> {
  const frame = getInterlinearizerFrame(page);
  // The `<dialog>` ModalShell renders is the only one in the iframe, so this both detects an open
  // modal and scopes the Cancel lookup — no separate overlay selector needed.
  const dialog = frame.locator('dialog').first();

  // Bounded; a couple of chained confirmations is the realistic worst case.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Non-retrying read so the clean path (no leftover modal) falls through immediately.
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
 * As the first shared precondition every feature test runs, this also self-heals leftover state a
 * prior failed test can leave on the shared CDP instance: any modal left mounted in the iframe (via
 * {@link dismissLeftoverModals}, whose overlay would intercept clicks) and any project-picker dock
 * tab left open (via {@link closeSelectProjectPickers}, whose accumulation would trip strict mode on
 * the `.select-project-dialog` locator).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the Interlinearizer tab is focused and its toolbar is interactive.
 * @throws If the Interlinearizer cannot be opened or its toolbar does not render within the
 *   timeouts.
 */
export async function ensureInterlinearizerOpenOnWeb(page: Page): Promise<void> {
  const interlinearizerTab = interlinearizerTabLocator(page);

  // Settle the dock layout before the non-retrying isVisible() branch below: the readiness helpers
  // only poll rpc.discover, not the DOM, so a not-yet-painted Interlinearizer tab would read as
  // "absent" and send us needlessly down the full open-from-editor flow. `.first()` on the whole
  // `.or()` keeps the assertion out of strict mode when multiple tabs are present (per-operand
  // `.first()` does not collapse the union). A fresh/shared instance may land on an already-open Home
  // tab rather than a Scripture Editor/WEB tab — accept that too, since the fallback branch below
  // (openInterlinearizerFromScriptureEditor) already knows how to open the project from Home.
  const anchorTab = page
    .locator('.dock-tab', { hasText: /^(Scripture Editor|WEB|Home)\b/ })
    .first();
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

  // Self-heal the shared instance before driving the UI: clear any leftover modal (its overlay would
  // intercept the clicks below) and any leftover project-picker tab. The picker cleanup covers the
  // warm path too, where openInterlinearizerFromScriptureEditor never runs.
  await dismissLeftoverModals(page);
  await closeSelectProjectPickers(page);
}

/**
 * Navigate the platform's book-chapter-verse control to the given scripture reference so tests can
 * assert against known text. Opens the toolbar's reference combobox, types the reference, and
 * submits it. Requires a fully-qualified reference (book, chapter, and verse — e.g. `"GEN 1:1"`);
 * partial references are ambiguous and are not auto-submitted by the control.
 *
 * The toolbar's book-chapter control is only ENABLED when BCV navigation has a resolved target web
 * view. In the default simple mode that target is the first open Scripture editor with a project,
 * NOT the focused Interlinearizer tab — so the control needs an open, project-bearing Scripture
 * editor to be drivable at all. That precondition holds because callers run this after
 * `ensureInterlinearizerOpenOnWeb`, which loads the WEB project into a Scripture Editor.
 *
 * The control can be momentarily disabled right after startup, before the target resolves, so this
 * waits a BOUNDED time for it to enable before clicking; a plain click on a still-disabled button
 * would let Playwright retry for the whole test timeout instead. If it never enables, the target
 * was never resolved (editor closed, or its project failed to load), so this THROWS rather than
 * silently navigating against the wrong verse.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param reference Fully-qualified scripture reference to navigate to (e.g. `"GEN 1:1"`).
 * @returns Resolves once the reference has been submitted.
 * @throws If the control never becomes enabled within the wait (no navigation target resolved), or
 *   if it is enabled but its popover does not open or close within the timeouts.
 */
export async function navigateToScriptureRef(page: Page, reference: string): Promise<void> {
  const trigger = page.locator('button[aria-label="book-chapter-trigger"]').first();

  // Bounded wait for the control to become enabled, covering the brief post-launch window before the
  // navigation target resolves. `toBeEnabled` polls (unlike `isEnabled`, which reads once); swallow
  // its rejection into a boolean so a persistently-disabled control becomes the clear throw below
  // rather than an opaque click-retry timeout.
  const enabled = await expect(trigger)
    .toBeEnabled({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!enabled) {
    throw new Error(
      `navigateToScriptureRef: the platform book-chapter control never became enabled, so ` +
        `"${reference}" could not be navigated to. This means BCV navigation has no resolved ` +
        'target: in the default simple interface mode the target is the first open Scripture editor ' +
        'with a project, so the WEB Scripture Editor is likely closed or its project failed to load. ' +
        'Ensure it is open (openInterlinearizerFromScriptureEditor) before navigating.',
    );
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

  // Match the E2E entry by its project-name element with EXACT text, not the button's accessible
  // name: the modal renders name, an optional "Active" badge, and the languages as adjacent <span>s
  // with no separating whitespace (reading e.g. "E2E Test Projecten"). Exact text also avoids
  // matching a project whose name merely starts with E2E_PROJECT_NAME (e.g. "E2E Test Project 2").
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
  // `force`: on a slow/software-rendered CI display the just-opened modal overlay hasn't won the
  // hit-test yet, so a normal click is intercepted by the iframe's `#root` for a few frames and
  // times out. We've asserted the modal is open and target an element inside it by a unique test id,
  // so skipping the hit-test check is safe.
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
  // Dispatch rather than hover()+click(): the close button is only laid out on hover, and on small
  // CI viewports the tab can overflow the strip and sit off-viewport, where a real click fails.
  // dispatchEvent doesn't require the element to be in-viewport. Mirrors paranext-core's own helpers.
  await interlinearizerTab.locator('.dock-tab-close-btn').dispatchEvent('click');
  await expect(interlinearizerTab).not.toBeVisible({ timeout: 10_000 });
}
