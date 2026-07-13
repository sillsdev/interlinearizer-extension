// Self-launching global setup for the CDP (feature-test) config.
import { chromium, type FullConfig, type Page } from '@playwright/test';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  waitForDockTabTitlesResolved,
  waitForServiceHostsRegistered,
  withFatalStartupTripwire,
} from './fixtures/helpers';
import {
  bootstrapRendererDevServer,
  isPortInUse,
  waitForPort,
  WEBSOCKET_PORT,
} from './global-setup';

/**
 * Chromium remote-debugging port the self-launched Electron instance exposes and the CDP fixture
 * connects to. Kept in sync with the `CDP_URL` default in fixtures/cdp.fixture.ts and the
 * `--remote-debugging-port` in the `start:cdp` npm script.
 */
export const CDP_PORT = 9223;

/** File the launched Electron PID is written to, for {@link globalTeardownCdp} to kill it. */
export const CDP_PID_FILE = path.join(__dirname, '.cdp-app.pid');

/** File the launched Electron's isolated user-data dir is written to, for teardown to remove it. */
export const CDP_USER_DATA_FILE = path.join(__dirname, '.cdp-app.user-data-dir');

/**
 * File the launched app's stdout/stderr is streamed to. Kept alongside the other `.cdp-*` marker
 * files in `e2e-tests/` — a location Playwright does not clear (unlike `outputDir`) — and added to
 * the CI artifact upload so it survives a failed run. Without this the app is spawned `stdio:
 * 'ignore'` and a startup crash surfaces only as an opaque WebSocket-port timeout with no cause.
 */
export const CDP_APP_LOG_FILE = path.join(__dirname, '.cdp-app-startup.log');

/** How long to wait for the launched app's WebSocket / CDP port before failing setup. */
const APP_READY_TIMEOUT = process.env.CI ? 600_000 : 120_000;

/**
 * How long to wait after the ports are up for the renderer to actually settle (dock tabs present
 * with resolved titles) before failing setup. Port readiness alone is not enough: a Windows CI
 * instance has come up with PAPI responding but every dock tab stuck at "Unknown" and blank panels
 * for the whole run, which made all five feature tests burn their own timeouts against one broken
 * shared instance. Failing setup here instead surfaces one clear error plus the app's startup log.
 */
const RENDERER_SETTLE_TIMEOUT = process.env.CI ? 180_000 : 120_000;

/**
 * Playwright global setup for the CDP config. Unlike the smoke config — whose fixture launches
 * Electron per worker — the CDP fixture connects over CDP to a separately-running app. This setup
 * provides that app so `npm run test:e2e:cdp` is self-contained (no manual `npm run start:cdp`):
 *
 * 1. Bootstraps the renderer dev server via {@link bootstrapRendererDevServer}.
 * 2. Launches Electron (paranext-core) detached, with the interlinearizer extension loaded via
 *    `--extensions` and Chromium remote debugging on {@link CDP_PORT}, in an isolated user-data
 *    dir.
 * 3. Waits for the PAPI WebSocket and the CDP debug port to come up, then for the renderer to settle
 *    (dock tabs present with resolved titles — see {@link waitForRendererSettled}).
 * 4. Records the PID and user-data dir for {@link globalTeardownCdp}.
 *
 * The isolated user-data dir means the run never touches a developer's real profile; the feature
 * tests self-establish every precondition (they create the E2E project, navigate, and wipe the
 * draft at the start of each test), so a fresh profile is sufficient.
 *
 * If the CDP port is already in use, a warm instance is assumed (a developer's own `npm run
 * start:cdp`) and setup is a no-op: no app is launched and nothing is recorded for teardown, so the
 * developer's instance is reused and left running. This keeps the manual
 * iterate-against-a-warm-instance workflow working through the same config.
 *
 * @param _config Playwright config object — unused; required by Playwright's global-setup
 *   interface.
 * @returns Resolves once a usable app is available (launched here, or an already-running one).
 * @throws {Error} If the app's WebSocket or CDP port do not become ready in time.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function globalSetupCdp(_config: FullConfig): Promise<void> {
  // A warm instance already owns the CDP port (a developer's `npm run start:cdp`). Reuse it: don't
  // launch a second app (it would collide on the WebSocket singleton and exit) and don't record a
  // PID, so teardown leaves the developer's instance running.
  if (await isPortInUse(CDP_PORT)) {
    console.log(
      `CDP port ${CDP_PORT} already in use — reusing the already-running Platform.Bible instance ` +
        '(not launching or tearing down an app).',
    );
    // Clear any stale ownership markers left on disk by a PRIOR launched run whose teardown never
    // completed (a crash or a `kill -9` of the test runner). This reuse path launches nothing and
    // records nothing, but globalTeardownCdp infers "this run launched an app" purely from these
    // files' existence — so a leftover .cdp-app.pid would make teardown SIGKILL a PID it never
    // started (which the OS may have recycled onto an unrelated process) and rm a user-data dir it
    // doesn't own. Removing them here keeps teardown a true no-op, honoring "leaves the developer's
    // instance running." e2e-tests/ is never auto-cleared, so nothing else sweeps them.
    clearStaleOwnershipMarkers();
    return;
  }

  await bootstrapRendererDevServer();

  const coreDir = path.resolve(__dirname, '../../paranext-core');
  const extensionDist = path.resolve(__dirname, '../dist');

  // Resolve the Electron binary from paranext-core's node_modules (its `electron` package's default
  // export is the path to the platform binary).
  const coreRequire = createRequire(path.resolve(coreDir, 'package.json'));
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const electronExecutable = coreRequire('electron') as string;

  // Isolated user-data dir so the singleton lock can't collide with a developer's own instance and
  // the run leaves the real profile untouched.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paranext-e2e-cdp-'));
  fs.writeFileSync(CDP_USER_DATA_FILE, userDataDir);

  // VSCode/Claude Code set ELECTRON_RUN_AS_NODE=1, which forces the Electron binary to run as plain
  // Node.js. Omit it so the Electron child launches a real GUI process.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ELECTRON_RUN_AS_NODE, ...restEnv } = process.env;

  console.log(`Launching Platform.Bible (CDP) from: ${coreDir}`);
  console.log(`Loading extension from: ${extensionDist}`);
  console.log(`Remote debugging on port ${CDP_PORT}`);

  // Stream the app's output to a log file rather than discarding it (`stdio: 'ignore'`): when the
  // app crashes on startup the only other symptom is an opaque WebSocket-port timeout below.
  const appLogFd = fs.openSync(CDP_APP_LOG_FILE, 'w');

  // Detached: unlike the smoke fixture's Playwright-owned `_electron.launch()`, the CDP fixture
  // connects to this process over CDP, so Playwright must not own its lifecycle. Teardown kills the
  // whole process tree by the recorded PID.
  const appProcess = spawn(
    electronExecutable,
    [
      `--user-data-dir=${userDataDir}`,
      coreDir,
      '--extensions',
      extensionDist,
      `--remote-debugging-port=${CDP_PORT}`,
      // Deterministic window size instead of the 1024x728 electron-window-state default —
      // paranext-core supports this argument for automation. Matches the CI xvfb screen (1280x960)
      // so the dock panels have room and modals are not clipped.
      '--window-size',
      '1280x960',
      // --no-sandbox: GitHub-hosted Linux runners don't ship a root-owned setuid chrome-sandbox
      // binary, so Electron's SUID sandbox helper aborts on launch. --ozone-platform=x11: in a
      // Wayland session with DISPLAY redirected to xvfb (local headless runs), Electron otherwise
      // picks the Wayland backend from the session environment and segfaults when the compositor
      // socket is unreachable; on CI runners (X11-only) it is a no-op.
      ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=x11'] : []),
    ],
    {
      cwd: coreDir,
      env: {
        ...restEnv,
        NODE_ENV: 'development',
        DEV_NOISY: process.env.DEV_NOISY ?? 'false',
        // With NODE_ENV=development, paranext-core's electron-debug auto-opens DevTools on every
        // window. On CI Linux DevTools docks INSIDE the window, squeezing the app viewport to
        // ~469px — dock panels collapse and modals get clipped at panel edges, so clicks land on
        // neighboring iframes (the gloss-roundtrip/Save-As CI failures). electron-is-dev honors
        // ELECTRON_IS_DEV=0, which disables electron-debug without affecting NODE_ENV-driven
        // behavior (dev-server URL, etc.).
        ELECTRON_IS_DEV: '0',
      },
      stdio: ['ignore', appLogFd, appLogFd],
      detached: true,
    },
  );
  appProcess.unref();
  // The child has inherited the fd; close our copy so the file is flushed and released on exit.
  fs.closeSync(appLogFd);

  if (appProcess.pid) fs.writeFileSync(CDP_PID_FILE, String(appProcess.pid));

  /**
   * Rejects the moment {@link appProcess} exits, so a startup crash (e.g. a sandbox
   * misconfiguration) fails setup immediately instead of only surfacing after the full
   * {@link APP_READY_TIMEOUT} port-wait below elapses. Raced against BOTH port waits and the
   * renderer-settle wait: a crash after an earlier stage completes must fail just as fast and with
   * the same informative message, not silently swallow the exit and time out on a later wait.
   */
  const earlyExit = new Promise<never>((_resolve, reject) => {
    appProcess.once('exit', (code, signal) => {
      reject(
        new Error(
          `Launched Platform.Bible (CDP) process exited early (code=${code}, signal=${signal}) ` +
            'before its WebSocket and CDP ports came up.',
        ),
      );
    });
  });
  // Setup returns with the app still running, so once the port/settle waits are done nothing
  // awaits earlyExit anymore — mark it handled so the eventual teardown kill (which fires the same
  // 'exit' event) can't surface as an unhandled rejection.
  earlyExit.catch(() => {});
  try {
    console.log(`Waiting for PAPI WebSocket on port ${WEBSOCKET_PORT}...`);
    await Promise.race([waitForPort(WEBSOCKET_PORT, APP_READY_TIMEOUT), earlyExit]);
    console.log(`Waiting for CDP debug port ${CDP_PORT}...`);
    // Race the same earlyExit sentinel here too: without it, a crash after the WebSocket port is up
    // would be swallowed and this wait would run out the full APP_READY_TIMEOUT with a generic
    // "port not available" error instead of the "process exited early" cause below.
    await Promise.race([waitForPort(CDP_PORT, APP_READY_TIMEOUT), earlyExit]);
    console.log('Ports are up. Waiting for the renderer to settle (dock tabs with real titles)...');
    await Promise.race([waitForRendererSettled(RENDERER_SETTLE_TIMEOUT), earlyExit]);
  } catch (error) {
    // The app never came up (or came up broken). Echo its captured output so the failure cause is
    // in the CI log itself, not just buried in the uploaded artifact, then re-throw the original
    // error.
    dumpAppLog();
    throw error;
  }
  console.log('Platform.Bible (CDP) is ready.');
}

/**
 * Connect to the launched app over CDP and wait for its renderer to settle: the renderer page
 * exists and the dock tabs have real titles (none stuck at "Unknown"). This is the earliest point
 * at which the tab-title-based locators the feature tests rely on can work, so gating setup on it
 * converts a broken shared instance into one fast, diagnosable setup failure instead of a cascade
 * of per-test timeouts.
 *
 * The Playwright connection is closed before returning either way — it only disconnects; the app
 * keeps running for the test fixtures to connect to.
 *
 * @param timeout Maximum time in milliseconds to wait for the renderer page and settled tabs.
 * @returns Resolves when the renderer page shows at least one dock tab and no "Unknown" titles.
 * @throws {Error} If no renderer page appears or tab titles do not resolve within `timeout`.
 */
async function waitForRendererSettled(timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`, {
    timeout: 30_000,
  });
  try {
    // The renderer page may not exist yet right after the CDP port opens — poll for it. Mirrors the
    // page-finding logic in fixtures/cdp.fixture.ts.
    let page: Page | undefined;
    while (!page && Date.now() < deadline) {
      const allPages = browser.contexts().flatMap((ctx) => ctx.pages());
      page =
        allPages.find((p) => p.url().startsWith('http://localhost:1212/')) ??
        allPages.find((p) => !p.url().includes('devtools://'));
      if (!page) {
        // intentional poll delay
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 500);
        });
      }
    }
    if (!page) {
      throw new Error(`No renderer page appeared over CDP within ${timeout}ms`);
    }
    // Floor each leftover budget to 1000ms, never a hair above 0: the preceding stage can finish at
    // (or, once waitForServiceHostsRegistered applies its own Math.max(1_000, …) floor, past) the
    // deadline, leaving a non-positive or single-digit remainder. waitForDockTabTitlesResolved
    // forwards its budget straight to page.waitForFunction, whose predicate is evaluated over a CDP
    // round-trip — a ~1ms budget expires during that round-trip and fails with a misleading "tabs
    // still Unknown" error even on a healthy app, whereas 1000ms leaves room for one real poll.
    // Matches the budgetLeft floor in waitForAppReady, which forwards to the same call.
    const budgetLeft = () => Math.max(1_000, deadline - Date.now());
    // Arm the fatal-startup tripwire around BOTH readiness stages, mirroring waitForAppReady: this
    // is the freshly-launched cold-start instance, so a fatal theme-settle error means the launch is
    // doomed — fail setup fast (and dump the app log) rather than wait out the full budget. The error
    // can surface during either stage, so the tripwire must stay armed across both.
    await withFatalStartupTripwire(page, true, async () => {
      // Gate on the upstream service hosts before the dock-tab wait, mirroring waitForAppReady: the
      // freshly-launched instance's tabs stay "Unknown" until the settings/menu-data/theme hosts
      // serve their metadata, and this is the exact path a Windows CDP cold start stalled on. Polls
      // the same rpc.discover WebSocket the tab-title wait's siblings use, so it needs no CDP page.
      await waitForServiceHostsRegistered(budgetLeft());
      // Strict cold-start gate: this is the freshly-launched instance's first settle, so every dock
      // tab must resolve. The per-test feature gate is lenient (shared instance already settled).
      await waitForDockTabTitlesResolved(page, budgetLeft(), {
        strict: true,
      });
    });
  } finally {
    // Disconnect only — connectOverCDP close() does not terminate the app.
    await browser.close();
  }
}

/**
 * Remove the ownership marker files ({@link CDP_PID_FILE}, {@link CDP_USER_DATA_FILE}) if present.
 * Called from the warm-instance reuse path, where this run launches no app and so owns none of the
 * resources those markers describe. {@link globalTeardownCdp} treats a present marker as "this run
 * launched an app it must kill/clean," so a stale marker from a prior launched run whose teardown
 * never completed would make teardown act on foreign resources — clearing them here prevents that.
 * Best-effort: each removal is guarded so a missing or unreadable marker never fails setup.
 *
 * @returns Nothing.
 */
function clearStaleOwnershipMarkers(): void {
  [CDP_PID_FILE, CDP_USER_DATA_FILE].forEach((markerFile) => {
    try {
      fs.rmSync(markerFile, { force: true });
    } catch (error) {
      console.warn(`Could not remove stale CDP marker ${markerFile}: ${error}`);
    }
  });
}

/**
 * Print the launched app's captured stdout/stderr to the console. Called when the app fails to open
 * its ports so the startup failure's cause appears inline in the CI log.
 *
 * @returns Nothing; logging-only.
 */
function dumpAppLog(): void {
  try {
    const log = fs.readFileSync(CDP_APP_LOG_FILE, 'utf-8');
    console.error(
      `--- Launched Platform.Bible (CDP) output (${CDP_APP_LOG_FILE}) ---\n${log || '(empty)'}\n--- end app output ---`,
    );
  } catch {
    console.error(`Could not read app log at ${CDP_APP_LOG_FILE}.`);
  }
}
