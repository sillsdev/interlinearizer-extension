// Self-launching global setup for the CDP (feature-test) config.
import type { FullConfig } from '@playwright/test';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
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

/** How long to wait for the launched app's WebSocket / CDP port before failing setup. */
const APP_READY_TIMEOUT = process.env.CI ? 600_000 : 120_000;

/**
 * Playwright global setup for the CDP config. Unlike the smoke config — whose fixture launches
 * Electron per worker — the CDP fixture connects over CDP to a separately-running app. This setup
 * provides that app so `npm run test:e2e:cdp` is self-contained (no manual `npm run start:cdp`):
 *
 * 1. Bootstraps the renderer dev server via {@link bootstrapRendererDevServer}.
 * 2. Launches Electron (paranext-core) detached, with the interlinearizer extension loaded via
 *    `--extensions` and Chromium remote debugging on {@link CDP_PORT}, in an isolated user-data
 *    dir.
 * 3. Waits for the PAPI WebSocket and the CDP debug port to come up.
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

  // Detached: unlike the smoke fixture's Playwright-owned `_electron.launch()`, the CDP fixture
  // connects to this process over CDP, so Playwright must not own its lifecycle. Teardown kills the
  // whole process group by the recorded PID.
  const appProcess = spawn(
    electronExecutable,
    [
      `--user-data-dir=${userDataDir}`,
      coreDir,
      '--extensions',
      extensionDist,
      `--remote-debugging-port=${CDP_PORT}`,
    ],
    {
      cwd: coreDir,
      env: { ...restEnv, NODE_ENV: 'development', DEV_NOISY: process.env.DEV_NOISY ?? 'false' },
      stdio: 'ignore',
      detached: true,
    },
  );
  appProcess.unref();

  if (appProcess.pid) fs.writeFileSync(CDP_PID_FILE, String(appProcess.pid));

  console.log(`Waiting for PAPI WebSocket on port ${WEBSOCKET_PORT}...`);
  await waitForPort(WEBSOCKET_PORT, APP_READY_TIMEOUT);
  console.log(`Waiting for CDP debug port ${CDP_PORT}...`);
  await waitForPort(CDP_PORT, APP_READY_TIMEOUT);
  console.log('Platform.Bible (CDP) is ready.');
}
