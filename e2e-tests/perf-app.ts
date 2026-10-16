import { chromium } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CACHE_DIR, DEV_STORAGE_DIR } from '../perf/paths';
import { CDP_PORT, waitForRendererSettled } from './global-setup-cdp';
import { isPortInUse, waitForPort, WEBSOCKET_PORT } from './global-setup';
import { E2E_SETTINGS_OVERRIDES } from './fixtures/helpers';
import { killProcessTree, waitForPidExit } from './process-utils';

/** Path to a packaged app's executable; set, it is what the harness launches. */
export const PACKAGED_APP_PATH = process.env.PERF_APP_PATH;

/** Home the packaged app runs under, apart from the developer's profile and kept across restarts. */
export const PERF_HOME_DIR = path.join(CACHE_DIR, 'app-home');

/** This extension's projects and drafts in the app a run drives. */
export const STORAGE_DIR = PACKAGED_APP_PATH
  ? path.join(PERF_HOME_DIR, '.platform.bible', 'extensions', 'interlinearizer', 'user-data')
  : DEV_STORAGE_DIR;

/** Display backend the app runs on under Linux, overridable with `PERF_OZONE_PLATFORM`. */
export const OZONE_PLATFORM =
  process.platform === 'linux' ? (process.env.PERF_OZONE_PLATFORM ?? 'x11') : undefined;

const PID_FILE = path.join(__dirname, '.perf-app.pid');

/** Where the launched app's output goes, overwritten by each launch. */
export const PERF_APP_LOG_FILE = path.join(__dirname, '.perf-app.log');

const READY_TIMEOUT = 5 * 60_000;

const QUIT_TIMEOUT = 60_000;

/** Prepares the packaged app's home and seeds the settings every e2e launch forces. */
function seedSettings(): void {
  // .NET reports a special folder that does not exist yet as an empty path. Windows resolves
  // AppData under USERPROFILE; when it is missing, Electron cannot take its single-instance lock
  // and the app quits as if another instance held it.
  ['.config', '.local/share', 'AppData/Roaming', 'AppData/Local'].forEach((dir) =>
    fs.mkdirSync(path.join(PERF_HOME_DIR, dir), { recursive: true }),
  );
  const file = path.join(PERF_HOME_DIR, '.platform.bible', 'data', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current: Record<string, unknown> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf-8'))
    : {};
  fs.writeFileSync(file, JSON.stringify({ ...current, ...E2E_SETTINGS_OVERRIDES }, undefined, 2));
}

/**
 * Launches the packaged app with the built extension and remote debugging, then waits until the
 * extension is ready.
 *
 * @returns Milliseconds from spawning the app to its being ready.
 * @throws If the app is already running, exits during startup, or is not ready in time.
 */
export async function launchPackagedApp(): Promise<number> {
  if (!PACKAGED_APP_PATH) throw new Error('PERF_APP_PATH names no packaged app');
  if ((await isPortInUse(WEBSOCKET_PORT)) || (await isPortInUse(CDP_PORT)))
    throw new Error('Platform.Bible is already running');
  seedSettings();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ELECTRON_RUN_AS_NODE, ...restEnv } = process.env;
  const logFd = fs.openSync(PERF_APP_LOG_FILE, 'w');
  const started = Date.now();
  let app: ReturnType<typeof spawn>;
  try {
    app = spawn(
      PACKAGED_APP_PATH,
      [
        '--extensions',
        path.resolve(__dirname, '../dist'),
        `--remote-debugging-port=${CDP_PORT}`,
        '--window-size',
        '1280x960',
        ...(process.platform === 'linux'
          ? ['--no-sandbox', `--ozone-platform=${OZONE_PLATFORM}`]
          : []),
      ],
      {
        env: {
          ...restEnv,
          HOME: PERF_HOME_DIR,
          // Windows takes the home folder from here, and its data provider ignores both variables.
          USERPROFILE: PERF_HOME_DIR,
          PLATFORM_BIBLE_PROJECT_ROOT_FOLDER: path.join(
            PERF_HOME_DIR,
            '.platform.bible',
            'projects',
            'Paratext 9 Projects',
          ),
          // Display authority usually lives in the real home, which the app cannot see.
          ...(fs.existsSync(path.join(os.homedir(), '.Xauthority')) && !process.env.XAUTHORITY
            ? { XAUTHORITY: path.join(os.homedir(), '.Xauthority') }
            : {}),
        },
        stdio: ['ignore', logFd, logFd],
        detached: true,
      },
    );
  } finally {
    fs.closeSync(logFd);
  }
  app.unref();
  if (app.pid) fs.writeFileSync(PID_FILE, String(app.pid));

  const exited = new Promise<never>((_resolve, reject) => {
    app.once('exit', (code, signal) =>
      reject(new Error(`The packaged app exited during startup (code=${code}, signal=${signal})`)),
    );
    app.once('error', reject);
  });
  exited.catch(() => {});
  try {
    await Promise.race([waitForPort(WEBSOCKET_PORT, READY_TIMEOUT), exited]);
    await Promise.race([waitForPort(CDP_PORT, READY_TIMEOUT), exited]);
    await Promise.race([waitForRendererSettled(READY_TIMEOUT), exited]);
  } catch (error) {
    await stopPackagedApp();
    throw error;
  }
  return Date.now() - started;
}

/** Asks the app to quit as a user would, so it saves its layout. */
async function requestQuit(): Promise<void> {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`, {
    timeout: 10_000,
  });
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((p) => !p.url().startsWith('devtools://'));
    // The app may close the connection before the command answers.
    await page?.evaluate(() => window.papi.commands.sendCommand('platform.quit')).catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stops the packaged app this harness launched, if it is running. */
export async function stopPackagedApp(): Promise<void> {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = Number(fs.readFileSync(PID_FILE, 'utf-8'));
  try {
    await requestQuit();
  } catch {
    // Not reachable over CDP; the kill below still stops it.
  }
  await waitForPidExit(pid, QUIT_TIMEOUT);
  if (isAlive(pid)) {
    killProcessTree(pid, 'SIGKILL');
    await waitForPidExit(pid, 10_000);
  }
  // The next launch needs the websocket port free.
  const deadline = Date.now() + QUIT_TIMEOUT;
  while (Date.now() < deadline && (await isPortInUse(WEBSOCKET_PORT))) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 250);
    });
  }
  fs.rmSync(PID_FILE, { force: true });
}
