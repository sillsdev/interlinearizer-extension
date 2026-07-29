// Self-launching global setup for the CDP (feature-test) config.
import { chromium, type FullConfig, type Page } from '@playwright/test';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  backupAndSeedSettings,
  E2E_SETTINGS_OVERRIDES,
  restoreBackedUpSettings,
  waitForAtLeastOneProjectMetadata,
  waitForDockTabTitlesResolved,
  waitForInterlinearizerReady,
  waitForServiceHostsRegistered,
  withFatalStartupTripwire,
} from './fixtures/helpers';
import {
  bootstrapRendererDevServer,
  DEV_SERVER_PID_FILE,
  isPortInUse,
  waitForPort,
  WEBSOCKET_PORT,
} from './global-setup';
import { killProcessFromPidFile } from './global-teardown';
import {
  killProcessTree,
  POST_SIGKILL_EXIT_WAIT_MS,
  removeDirWithRetry,
  waitForProcessExit,
} from './process-utils';

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
 * @param _config - Playwright config object — unused; required by Playwright's global-setup
 *   interface.
 * @returns Resolves once a usable app is available (launched here, or an already-running one).
 * @throws {Error} If the run is configured for more than one worker, or if the app's WebSocket or
 *   CDP port do not become ready in time.
 */
export default async function globalSetupCdp(config: FullConfig): Promise<void> {
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
  // the run leaves the real profile untouched. Creating the dir and recording its ownership marker
  // are both covered here: this is past bootstrapRendererDevServer's own cleanup but before the
  // try/catch below, so a failure at either step would otherwise leave the dev server it just
  // started running, plus an unreferenced temp dir that teardown can never find.
  let userDataDir = '';
  try {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paranext-e2e-cdp-'));
    fs.writeFileSync(CDP_USER_DATA_FILE, userDataDir);
  } catch (error) {
    // Empty when mkdtempSync itself failed, in which case there is no dir to remove.
    if (userDataDir) await removeDirWithRetry(userDataDir, 'CDP user-data dir');
    killProcessFromPidFile(DEV_SERVER_PID_FILE, 'SIGTERM', 'renderer dev server');
    throw error;
  }

  // VSCode/Claude Code set ELECTRON_RUN_AS_NODE=1, which forces the Electron binary to run as plain
  // Node.js. Omit it so the Electron child launches a real GUI process.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ELECTRON_RUN_AS_NODE, ...restEnv } = process.env;

  console.log(`Launching Platform.Bible (CDP) from: ${coreDir}`);
  console.log(`Loading extension from: ${extensionDist}`);
  console.log(`Remote debugging on port ${CDP_PORT}`);

  // Everything from the settings seed onward acquires state this setup owns (seeded settings, the
  // log fd, the launched process, the PID marker). Playwright does not run globalTeardown when
  // globalSetup throws, so a failure anywhere in here must clean up on the spot rather than leak to
  // the next run — hence the single try/catch spanning both the launch and the readiness waits,
  // rather than one starting only at the waits.
  let appProcess: ReturnType<typeof spawn> | undefined;
  let exited: Promise<void> | undefined;
  try {
    // Seed E2E_SETTINGS_OVERRIDES before launch and back up settings (restored by globalTeardownCdp
    // after the launched app is killed).
    seedE2ESettingsOverrides(config.workers);

    // Stream the app's output to a log file rather than discarding it (`stdio: 'ignore'`): when the
    // app crashes on startup the only other symptom is an opaque WebSocket-port timeout below.
    const appLogFd = fs.openSync(CDP_APP_LOG_FILE, 'w');

    // Detached: the CDP fixture connects to this process over CDP, so Playwright must not own its
    // lifecycle. Teardown kills the whole tree by the recorded PID.
    try {
      appProcess = spawn(
        electronExecutable,
        [
          `--user-data-dir=${userDataDir}`,
          coreDir,
          '--extensions',
          extensionDist,
          `--remote-debugging-port=${CDP_PORT}`,
          // Deterministic window size matching the CI xvfb screen (1280x960) so dock panels have
          // room and modals aren't clipped. paranext-core supports this arg for automation.
          '--window-size',
          '1280x960',
          // --no-sandbox: GitHub-hosted Linux runners lack a setuid chrome-sandbox binary, so
          // Electron's SUID sandbox helper aborts on launch. --ozone-platform=x11: in a Wayland
          // session with DISPLAY redirected to xvfb (local headless runs), Electron otherwise picks
          // Wayland and segfaults when the compositor socket is unreachable; no-op on CI runners
          // (X11-only).
          ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=x11'] : []),
        ],
        {
          cwd: coreDir,
          env: {
            ...restEnv,
            NODE_ENV: 'development',
            DEV_NOISY: process.env.DEV_NOISY ?? 'false',
            // With NODE_ENV=development, paranext-core auto-opens DevTools on every window; on CI
            // Linux that docks inside the window and squeezes the viewport so dock panels collapse
            // and clicks land on neighboring iframes. ELECTRON_IS_DEV=0 disables the auto-open
            // without changing other NODE_ENV-driven behavior (dev-server URL, etc.).
            ELECTRON_IS_DEV: '0',
          },
          stdio: ['ignore', appLogFd, appLogFd],
          detached: true,
        },
      );
    } finally {
      // Close our copy of the fd whether or not the spawn succeeded: on success the child has
      // inherited it (so the file is flushed and released when the child exits), and on failure
      // there is no child to inherit it and leaving it open would leak the descriptor.
      fs.closeSync(appLogFd);
    }
    appProcess.unref();

    /**
     * Rejects if the process could not be spawned at all (a missing or non-executable Electron
     * binary). Registering a listener is what makes this recoverable: `spawn` reports such failures
     * by emitting `'error'` asynchronously, and an unhandled `'error'` on an EventEmitter throws as
     * an uncaughtException outside this try/catch — killing the setup process before any cleanup
     * runs and stranding the seeded settings. No `'exit'` follows a failed spawn, so neither
     * {@link earlyExit} nor `exited` covers this.
     */
    const spawnFailed = new Promise<never>((_resolve, reject) => {
      appProcess?.once('error', (error) => {
        reject(
          new Error(`Failed to spawn Platform.Bible (CDP) at ${electronExecutable}: ${error}`),
        );
      });
    });
    // Handled for the same reason as earlyExit below: setup returns with nothing awaiting this.
    spawnFailed.catch(() => {});

    // Resolves once the process exits (unlike earlyExit below, which rejects). Allows the
    // failure-path cleanup to bound its wait for a just-issued SIGKILL to take effect. Registered
    // before the PID-marker write so a write failure still reaches cleanUpFailedLaunch with a usable
    // exit signal rather than making it skip the post-kill wait.
    exited = new Promise<void>((resolve) => {
      appProcess?.once('exit', () => resolve());
    });

    if (appProcess.pid) fs.writeFileSync(CDP_PID_FILE, String(appProcess.pid));

    /**
     * Rejects the moment {@link appProcess} exits, so a startup crash fails setup immediately
     * instead of surfacing only after the full {@link APP_READY_TIMEOUT} port-wait elapses. Raced
     * against both port waits and the renderer-settle wait, since a crash can come after any of
     * them completes.
     */
    const earlyExit = new Promise<never>((_resolve, reject) => {
      appProcess?.once('exit', (code, signal) => {
        reject(
          new Error(
            `Launched Platform.Bible (CDP) process exited early (code=${code}, signal=${signal}) ` +
              'during startup, before it became ready.',
          ),
        );
      });
    });
    // Setup returns with the app running, so nothing awaits earlyExit after the waits below — mark
    // it handled so the eventual teardown kill (same 'exit' event) can't surface as an unhandled
    // rejection.
    earlyExit.catch(() => {});

    console.log(`Waiting for PAPI WebSocket on port ${WEBSOCKET_PORT}...`);
    await Promise.race([waitForPort(WEBSOCKET_PORT, APP_READY_TIMEOUT), earlyExit, spawnFailed]);
    console.log(`Waiting for CDP debug port ${CDP_PORT}...`);
    await Promise.race([waitForPort(CDP_PORT, APP_READY_TIMEOUT), earlyExit, spawnFailed]);
    console.log(
      'Ports are up. Waiting for the renderer to settle (dock tabs with real titles) and the ' +
        'interlinearizer extension to activate...',
    );
    await Promise.race([waitForRendererSettled(RENDERER_SETTLE_TIMEOUT), earlyExit, spawnFailed]);
  } catch (error) {
    await cleanUpFailedLaunch(userDataDir, appProcess?.pid, exited);
    throw error;
  }
  console.log('Platform.Bible (CDP) is ready.');
}

/**
 * Undo everything {@link globalSetupCdp} acquired, after its launch failed. Playwright skips
 * globalTeardown when globalSetup throws, so this is the only chance to release the seeded
 * settings, the launched process, its user-data dir, the ownership markers, and the renderer dev
 * server before the failure propagates — otherwise each leaks into the next run.
 *
 * Callable at any point after the settings seed, including before a process was spawned: an absent
 * `pid` simply skips the kill. Every step is individually best-effort (the kill, the dir removal,
 * and the settings restore all swallow their own errors), so one failure cannot strand the rest.
 *
 * @param userDataDir Isolated user-data dir created for the launch, removed here.
 * @param pid PID of the launched app if it was spawned; `undefined` if the failure preceded the
 *   spawn or the process never reported a PID.
 * @param exited Promise resolving when the launched process exits, used to bound the post-SIGKILL
 *   wait; `undefined` when no process was spawned.
 * @returns Resolves once every cleanup step has been attempted.
 */
async function cleanUpFailedLaunch(
  userDataDir: string,
  pid: number | undefined,
  exited: Promise<void> | undefined,
): Promise<void> {
  // The app never came up (or came up broken). Echo its captured output so the cause is in the CI
  // log itself, not only the uploaded artifact.
  dumpAppLog();
  const killed = pid ? killProcessTree(pid, 'SIGKILL') : false;
  if (killed && exited) {
    await waitForProcessExit(exited, POST_SIGKILL_EXIT_WAIT_MS);
  }
  await removeDirWithRetry(userDataDir, 'CDP user-data dir');
  // Restore settings after waiting for the kill above to take effect. The still-running app owns
  // dev-appdata/settings.json, so restoring before it's dead risks flushing the seeded value back
  // over the just-restored original, with no backup left to recover from.
  restoreSeededSettings();
  fs.rmSync(CDP_PID_FILE, { force: true });
  fs.rmSync(CDP_USER_DATA_FILE, { force: true });
  // Also stop the renderer dev server that bootstrapRendererDevServer() may have started.
  killProcessFromPidFile(DEV_SERVER_PID_FILE, 'SIGTERM', 'renderer dev server');
}

/**
 * Connect to the launched app over CDP and wait for its renderer to settle: the renderer page
 * exists, the dock tabs have real titles (none stuck at "Unknown"), and the interlinearizer
 * extension has finished activating (registered `interlinearizer.openForWebView`). This is the
 * earliest point at which the tab-title-based locators AND the interlinearizer-opening flow that
 * the feature tests rely on can work.
 *
 * The Playwright connection is closed before returning either way — it only disconnects; the app
 * keeps running for the test fixtures to connect to.
 *
 * @returns Resolves when the renderer page shows at least one dock tab with no "Unknown" titles and
 *   the interlinearizer extension has registered its open-webview command.
 * @throws {Error} If no renderer page appears, tab titles do not resolve, or the extension does not
 *   activate within `timeout`.
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
      // Also gate on the interlinearizer extension having finished activating. Else, the first
      // feature test's short per-test budget covers activation it was never sized for.
      await waitForInterlinearizerReady(budgetLeft());
      // Also gate on the bundled WEB project having finished installing.
      await waitForAtLeastOneProjectMetadata(budgetLeft());
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
 * Seed {@link E2E_SETTINGS_OVERRIDES} before launching the app. Thin wrapper around
 * {@link backupAndSeedSettings} — see its doc for the backup/self-heal behavior.
 */
function seedE2ESettingsOverrides(workers: number): void {
  backupAndSeedSettings(E2E_SETTINGS_OVERRIDES, workers);
}

/**
 * Undo {@link seedE2ESettingsOverrides}. Thin wrapper around {@link restoreBackedUpSettings} — see
 * its doc for the restore/self-heal behavior.
 */
export function restoreSeededSettings(): void {
  restoreBackedUpSettings();
}

/**
 * Print the launched app's captured stdout/stderr to the console. Called when the app fails to open
 * its ports so the startup failure's cause appears inline in the CI log.
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
