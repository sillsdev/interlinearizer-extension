// Self-launching global setup for the CDP (feature-test) config.
import { chromium, type FullConfig, type Page } from '@playwright/test';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DEV_APPDATA_SETTINGS_PATH,
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
 * File the launched app's stdout/stderr is streamed to. Kept alongside the other `.cdp-*` markers
 * in `e2e-tests/` (which Playwright doesn't clear) and uploaded as a CI artifact, so a startup
 * crash leaves a diagnosable log instead of only an opaque WebSocket-port timeout.
 */
export const CDP_APP_LOG_FILE = path.join(__dirname, '.cdp-app-startup.log');

/**
 * File the pre-launch dev-appdata settings backup is written to (kept alongside the other `.cdp-*`
 * markers) so teardown can restore the developer's original settings after the run.
 */
const CDP_SETTINGS_BACKUP_FILE = path.join(__dirname, '.cdp-settings-backup');

/** Marker stored in {@link CDP_SETTINGS_BACKUP_FILE} when no settings file existed before seeding. */
const SETTINGS_ABSENT_SENTINEL = '__SETTINGS_ABSENT__';

/** How long to wait for the launched app's WebSocket / CDP port before failing setup. */
const APP_READY_TIMEOUT = process.env.CI ? 600_000 : 120_000;

/**
 * How long to wait after the ports are up for the renderer to settle (dock tabs present with
 * resolved titles) before failing setup. Port readiness alone isn't enough: an instance can come up
 * with PAPI responding but every dock tab stuck at "Unknown" for the whole run. Failing setup here
 * surfaces one clear error rather than letting every feature test burn its own timeout.
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
  // launch a second app (it would collide on the WebSocket singleton) and don't record a PID, so
  // teardown leaves the developer's instance running.
  if (await isPortInUse(CDP_PORT)) {
    console.log(
      `CDP port ${CDP_PORT} already in use — reusing the already-running Platform.Bible instance ` +
        '(not launching or tearing down an app).',
    );
    // Clear stale ownership markers from a prior launched run whose teardown never completed.
    // globalTeardownCdp infers "this run launched an app" from these files' existence, so a leftover
    // .cdp-app.pid would make it SIGKILL a PID (possibly recycled) and rm a dir it doesn't own.
    // Removing them keeps teardown a true no-op on this reuse path.
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

  // Seed platform.firstRunComplete before launch so paranext-core's first-run wizard overlay does
  // not gate the app (same seeding the smoke tier does in fixtures/app.fixture.ts). The overlay is a
  // full-screen modal Dialog that intercepts pointer events, which would block every feature test.
  // Backed up and restored by globalTeardownCdp after the launched app is killed.
  seedFirstRunComplete();

  // Stream the app's output to a log file rather than discarding it (`stdio: 'ignore'`): when the
  // app crashes on startup the only other symptom is an opaque WebSocket-port timeout below.
  const appLogFd = fs.openSync(CDP_APP_LOG_FILE, 'w');

  // Detached: the CDP fixture connects to this process over CDP, so Playwright must not own its
  // lifecycle. Teardown kills the whole tree by the recorded PID.
  const appProcess = spawn(
    electronExecutable,
    [
      `--user-data-dir=${userDataDir}`,
      coreDir,
      '--extensions',
      extensionDist,
      `--remote-debugging-port=${CDP_PORT}`,
      // Deterministic window size matching the CI xvfb screen (1280x960) so dock panels have room
      // and modals aren't clipped. paranext-core supports this arg for automation.
      '--window-size',
      '1280x960',
      // --no-sandbox: GitHub-hosted Linux runners lack a setuid chrome-sandbox binary, so Electron's
      // SUID sandbox helper aborts on launch. --ozone-platform=x11: in a Wayland session with
      // DISPLAY redirected to xvfb (local headless runs), Electron otherwise picks Wayland and
      // segfaults when the compositor socket is unreachable; no-op on CI runners (X11-only).
      ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=x11'] : []),
    ],
    {
      cwd: coreDir,
      env: {
        ...restEnv,
        NODE_ENV: 'development',
        DEV_NOISY: process.env.DEV_NOISY ?? 'false',
        // With NODE_ENV=development, paranext-core auto-opens DevTools on every window; on CI Linux
        // that docks inside the window and squeezes the viewport so dock panels collapse and clicks
        // land on neighboring iframes. ELECTRON_IS_DEV=0 disables the auto-open without changing
        // other NODE_ENV-driven behavior (dev-server URL, etc.).
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
   * Rejects the moment {@link appProcess} exits, so a startup crash fails setup immediately instead
   * of surfacing only after the full {@link APP_READY_TIMEOUT} port-wait elapses. Raced against both
   * port waits and the renderer-settle wait, since a crash can come after any of them completes.
   */
  const earlyExit = new Promise<never>((_resolve, reject) => {
    appProcess.once('exit', (code, signal) => {
      reject(
        new Error(
          `Launched Platform.Bible (CDP) process exited early (code=${code}, signal=${signal}) ` +
            'during startup, before it became ready.',
        ),
      );
    });
  });
  // Setup returns with the app running, so nothing awaits earlyExit after the waits below — mark it
  // handled so the eventual teardown kill (same 'exit' event) can't surface as an unhandled
  // rejection.
  earlyExit.catch(() => {});
  try {
    console.log(`Waiting for PAPI WebSocket on port ${WEBSOCKET_PORT}...`);
    await Promise.race([waitForPort(WEBSOCKET_PORT, APP_READY_TIMEOUT), earlyExit]);
    console.log(`Waiting for CDP debug port ${CDP_PORT}...`);
    await Promise.race([waitForPort(CDP_PORT, APP_READY_TIMEOUT), earlyExit]);
    console.log('Ports are up. Waiting for the renderer to settle (dock tabs with real titles)...');
    await Promise.race([waitForRendererSettled(RENDERER_SETTLE_TIMEOUT), earlyExit]);
  } catch (error) {
    // The app never came up (or came up broken). Echo its captured output so the cause is in the CI
    // log itself, not only the uploaded artifact.
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
    // Floor each leftover budget to 1000ms (see the matching floor in waitForAppReady): a ~1ms
    // remainder would expire during waitForDockTabTitlesResolved's CDP round-trip and fail "tabs
    // still Unknown" on a healthy app.
    const budgetLeft = () => Math.max(1_000, deadline - Date.now());
    // Arm the fatal-startup tripwire around both stages, mirroring waitForAppReady: this is the
    // freshly-launched cold-start instance, so a fatal theme-settle error dooms the launch — fail
    // setup fast rather than wait out the full budget.
    await withFatalStartupTripwire(page, true, async () => {
      // Gate on the upstream service hosts before the dock-tab wait: the tabs stay "Unknown" until
      // the settings/menu-data/theme hosts serve their metadata (the path a Windows CDP cold start
      // stalled on). Polls the same rpc.discover WebSocket, so it needs no CDP page.
      await waitForServiceHostsRegistered(budgetLeft());
      // Strict cold-start gate: the instance's first settle, so every dock tab must resolve.
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
 * Remove the ownership marker files ({@link CDP_PID_FILE}, {@link CDP_USER_DATA_FILE}) if present and
 * restore any settings a prior launched run seeded. Called from the warm-instance reuse path, where
 * this run owns none of the resources those markers describe, so a stale marker from a prior
 * launched run would make {@link globalTeardownCdp} act on foreign resources (and a stale settings
 * seed would linger in the developer's dev-appdata). Best-effort: each removal is guarded.
 *
 * @returns Nothing.
 */
function clearStaleOwnershipMarkers(): void {
  // Undo any seed a prior launched run left behind before it crashed, so the developer's warm
  // instance isn't reused with lingering test settings on disk.
  restoreSeededSettings();
  [CDP_PID_FILE, CDP_USER_DATA_FILE].forEach((markerFile) => {
    try {
      fs.rmSync(markerFile, { force: true });
    } catch (error) {
      console.warn(`Could not remove stale CDP marker ${markerFile}: ${error}`);
    }
  });
}

/**
 * Back up paranext-core's dev-appdata settings file and seed `platform.firstRunComplete: true` into
 * it before launching the app, so the first-run wizard overlay does not gate the launched instance
 * (the same seeding the smoke tier does in fixtures/app.fixture.ts). The original file is saved to
 * {@link CDP_SETTINGS_BACKUP_FILE} for {@link restoreSeededSettings} to put back in teardown.
 * Recovers from a leftover backup first (a prior run that crashed before restoring) so the true
 * original — not an already-seeded file — is what gets backed up.
 *
 * @returns Nothing.
 */
function seedFirstRunComplete(): void {
  // A leftover backup means a prior launched run seeded but never restored; recover its original
  // first so we don't back up (and later "restore" to) an already-seeded file.
  restoreSeededSettings();

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(DEV_APPDATA_SETTINGS_PATH)) {
    const original = fs.readFileSync(DEV_APPDATA_SETTINGS_PATH, 'utf-8');
    fs.writeFileSync(CDP_SETTINGS_BACKUP_FILE, original);
    try {
      const parsed: unknown = JSON.parse(original);
      // Preserve existing settings only when the file holds a JSON object; a corrupt or non-object
      // file falls back to just the override.
      if (parsed && typeof parsed === 'object') existing = { ...parsed };
    } catch {
      // Corrupt file — overwrite with just the override.
    }
  } else {
    // Record absence so teardown deletes the file this run creates rather than leaving it behind.
    fs.writeFileSync(CDP_SETTINGS_BACKUP_FILE, SETTINGS_ABSENT_SENTINEL);
  }
  fs.mkdirSync(path.dirname(DEV_APPDATA_SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(
    DEV_APPDATA_SETTINGS_PATH,
    JSON.stringify({ ...existing, 'platform.firstRunComplete': true }),
  );
}

/**
 * Undo {@link seedFirstRunComplete}: restore the dev-appdata settings file from
 * {@link CDP_SETTINGS_BACKUP_FILE} (or delete it if the backup marks that no settings file existed
 * before seeding), then remove the backup marker. A no-op when no backup exists. Best-effort:
 * guarded so a settings-restore failure never aborts teardown.
 *
 * @returns Nothing.
 */
export function restoreSeededSettings(): void {
  if (!fs.existsSync(CDP_SETTINGS_BACKUP_FILE)) return;
  try {
    const backup = fs.readFileSync(CDP_SETTINGS_BACKUP_FILE, 'utf-8');
    if (backup === SETTINGS_ABSENT_SENTINEL) fs.rmSync(DEV_APPDATA_SETTINGS_PATH, { force: true });
    else fs.writeFileSync(DEV_APPDATA_SETTINGS_PATH, backup);
    fs.rmSync(CDP_SETTINGS_BACKUP_FILE, { force: true });
  } catch (error) {
    console.warn(`Could not restore dev-appdata settings after CDP run: ${error}`);
  }
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
