// Adapted from paranext-core/e2e-tests/global-setup.ts
import type { FullConfig } from '@playwright/test';
import { execSync, spawn } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { killProcessTree } from './process-utils';

export const WEBSOCKET_PORT = 8876;
export const RENDERER_PORT = 1212;

/**
 * File the renderer dev server's PID is written to, for {@link globalTeardown} to kill it — and for
 * a CDP setup failure path to kill it too, since Playwright skips `globalTeardown` when
 * `globalSetup` throws.
 *
 * Names the dev server the CURRENT run spawned, never one it merely reused: a kill from here
 * signals the recorded PID's whole process tree, so a foreign or already-exited PID could take down
 * something unrelated.
 */
export const DEV_SERVER_PID_FILE = path.join(__dirname, '.dev-server.pid');

/** Check if a port is already in use. */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      server.close();
      resolve(true);
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/**
 * Wait until an HTTP GET to `url` returns a non-5xx response.
 *
 * Webpack-dev-middleware holds requests open until the initial compilation finishes, so a
 * successful response guarantees the initial renderer bundle is ready.
 *
 * @param url - URL to probe.
 * @param timeout - Total budget in ms, spanning all retries rather than one probe.
 * @throws {Error} If the server does not respond within `timeout` milliseconds.
 */
function waitForHttpOk(url: string, timeout: number): Promise<void> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    let done = false;
    let currentReq: http.ClientRequest | undefined;

    /**
     * Mark the probe as failed, destroy the in-flight request, and reject the outer promise with
     * `message` as the Error's text.
     */
    const fail = (message: string) => {
      if (done) return;
      done = true;
      currentReq?.destroy();
      reject(new Error(message));
    };

    const overallTimer = setTimeout(() => {
      fail(`${url} did not respond within ${timeout}ms`);
    }, timeout);

    /** Fire one HTTP GET attempt; retries on transient failure within the overall timeout budget. */
    const attempt = () => {
      if (done) return;
      if (Date.now() - startTime >= timeout) {
        clearTimeout(overallTimer);
        fail(`${url} did not respond within ${timeout}ms`);
        return;
      }

      currentReq = http.get(url, { headers: { Connection: 'close' } }, (res) => {
        if (done) {
          res.resume();
          return;
        }

        res.resume();

        if (res.statusCode !== undefined && res.statusCode < 500) {
          clearTimeout(overallTimer);
          done = true;
          resolve();
          return;
        }

        // Retry transient dev-server responses while staying within overall timeout budget.
        setTimeout(attempt, 1_000);
      });

      currentReq.setTimeout(15_000, () => {
        currentReq?.destroy(new Error('HTTP readiness probe timed out'));
      });

      currentReq.on('error', () => {
        if (!done) setTimeout(attempt, 1_000);
      });
    };

    attempt();
  });
}

/**
 * Wait until a port is accepting connections.
 *
 * @throws {Error} If the port does not become available within `timeout` milliseconds.
 */
export function waitForPort(port: number, timeout: number): Promise<void> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    /** Attempt one TCP connection; retries after 500 ms on failure within the overall timeout. */
    const tryConnect = () => {
      if (Date.now() - startTime > timeout) {
        reject(new Error(`Port ${port} did not become available within ${timeout}ms`));
        return;
      }
      const socket = net.createConnection(port, 'localhost');
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

/**
 * Bootstrap everything an Electron launch needs, short of launching Electron itself: verify no
 * conflicting instance is running, clear stale singleton locks, confirm the extension is built,
 * ensure the paranext-core dev main bundle exists, and start the renderer dev server on port 1212
 * (recording its PID for teardown).
 *
 * Self-cleaning on failure: if a dev server started here never becomes ready, it is killed before
 * the error propagates (see {@link killSpawnedDevServer}), so it cannot leak. Callers therefore need
 * no dev-server cleanup of their own for a bootstrap failure.
 *
 * @returns Resolves when the renderer dev server is ready.
 * @throws {Error} If port 8876 is already in use (a running Platform.Bible would conflict).
 * @throws {Error} If the extension fails to build.
 * @throws {Error} If a dev server started here does not open port 1212 within 60s, or (outside CI)
 *   fails the HTTP compilation probe within 120s.
 */
export async function bootstrapRendererDevServer(): Promise<void> {
  const extensionRoot = path.resolve(__dirname, '..');
  const coreDir = path.resolve(__dirname, '../../paranext-core');

  // Fail fast if Platform.Bible is already running (single-instance lock will
  // cause Playwright's Electron instance to exit immediately)
  if (await isPortInUse(WEBSOCKET_PORT)) {
    throw new Error(
      `Port ${WEBSOCKET_PORT} is already in use. ` +
        'Stop the running Platform.Bible instance (npm run core:stop) before running E2E tests.',
    );
  }

  // Remove stale Electron singleton lock files (left behind after crashes).
  const os = await import('os');
  let appSupportDir: string;
  if (process.platform === 'darwin') {
    appSupportDir = path.join(os.homedir(), 'Library/Application Support');
  } else if (process.platform === 'linux') {
    appSupportDir = path.join(os.homedir(), '.config');
  } else {
    appSupportDir = process.env.APPDATA || '';
  }

  ['Electron', 'paratext-10-studio', 'platform-bible', 'Paranext', 'Platform.Bible'].forEach(
    (dir) => {
      const lockPath = path.join(appSupportDir, dir, 'SingletonLock');
      if (fs.existsSync(lockPath)) {
        console.log(`Removing stale singleton lock: ${lockPath}`);
        fs.unlinkSync(lockPath);
      }
    },
  );

  // Rebuild rather than merely checking dist exists. A dist left over from another branch loads an
  // extension the tests were not written against, and the selector mismatches that follow read as
  // real regressions rather than a build problem. A no-op rebuild costs seconds against a
  // multi-minute run, so always paying it is cheaper than ever debugging the stale case.
  console.log('Building the extension...');
  execSync('npm run build', { cwd: extensionRoot, stdio: 'inherit' });

  // Ensure the paranext-core dev main bundle exists
  const devMainPath = path.join(coreDir, '.erb/dll/main.bundle.dev.js');
  if (!fs.existsSync(devMainPath)) {
    console.log('Development main bundle not found. Building...');
    execSync('npm run prestart', { cwd: coreDir, stdio: 'inherit' });
  } else {
    console.log('Development main bundle found.');
  }

  // Start the webpack dev server for the renderer if not already running
  if (await isPortInUse(RENDERER_PORT)) {
    console.log(`Renderer dev server already running on port ${RENDERER_PORT}.`);
    // A marker on disk can only be a prior run's leftover here, and killing by a stale PID risks a
    // process the OS has since recycled it onto. The reused server is left running instead.
    removeDevServerPidMarker();
  } else {
    console.log('Starting paranext-core renderer dev server...');
    const devServer = spawn('npm', ['run', 'start:renderer'], {
      cwd: coreDir,
      stdio: 'ignore',
      shell: true,
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, SKIP_START_MAIN: '1' },
    });

    devServer.unref();

    // From here on this run owns a spawned, detached dev server. Playwright skips globalTeardown
    // when globalSetup throws, so a failure below must kill it on the spot or it survives the
    // failed run, holds port 1212, and silently serves a stale bundle to every later run. The
    // PID-marker write is inside this try for the same reason: a synchronous writeFileSync failure
    // would otherwise leak the running server with no marker for any later teardown to find it by.
    // Scoped to this branch only: the already-running branch above didn't start the server, so this
    // run must leave it alone.
    try {
      /**
       * Rejects if the dev server could not be spawned. `spawn` reports that by emitting `'error'`
       * asynchronously, and an unhandled `'error'` on an EventEmitter throws as an
       * uncaughtException that no catch here could reach; racing it against the readiness wait
       * routes it through this block's cleanup instead, and fails immediately rather than after the
       * full 60s port wait.
       */
      const spawnFailed = new Promise<never>((_resolve, reject) => {
        devServer.once('error', (error) => {
          reject(new Error(`Failed to spawn the renderer dev server: ${error}`));
        });
      });
      // Nothing awaits this once the waits below succeed, so mark it handled.
      spawnFailed.catch(() => {});

      if (devServer.pid) {
        fs.writeFileSync(DEV_SERVER_PID_FILE, String(devServer.pid));
      }

      console.log(`Waiting for renderer dev server on port ${RENDERER_PORT}...`);
      await Promise.race([waitForPort(RENDERER_PORT, 60_000), spawnFailed]);
      console.log(
        `Port ${RENDERER_PORT} is accepting connections. Waiting for webpack compilation...`,
      );
      // webpack-dev-middleware holds requests open until initial compilation finishes. Probe a
      // renderer URL to opportunistically wait for compilation, but do not hard-fail CI on this
      // probe because CI runners can be noisy and late-compiling; the fixture has a longer CI-ready
      // timeout and will keep waiting for the renderer window to recover.
      try {
        await waitForHttpOk(`http://localhost:${RENDERER_PORT}/`, 120_000);
      } catch (error) {
        if (!process.env.CI) throw error;
        const message =
          error instanceof Error ? error.message : 'Unknown renderer readiness probe failure';
        console.warn(
          `Renderer HTTP readiness probe timed out in CI: ${message}. Continuing with port-only readiness.`,
        );
      }
    } catch (error) {
      killSpawnedDevServer(devServer.pid);
      throw error;
    }
    console.log('Renderer dev server is ready.');
  }
}

/**
 * Kill a dev server this run spawned but never got ready, and clear its PID marker. Used only on
 * {@link bootstrapRendererDevServer}'s failure path, where the caller's own cleanup cannot reach:
 * the CDP setup's `cleanUpFailedLaunch` runs only for failures after the bootstrap returns, and
 * Playwright skips `globalTeardown` entirely when `globalSetup` throws.
 *
 * Deliberately does not reuse `killProcessFromPidFile` from global-teardown.ts: importing it here
 * would make setup and teardown mutually dependent (teardown already imports
 * {@link DEV_SERVER_PID_FILE} from this module). The PID is in hand anyway, so the read-back that
 * helper exists to do is unnecessary.
 *
 * Best-effort: every step swallows its own error, since this runs while an exception is already
 * propagating and must not replace the real failure with a cleanup one.
 *
 * @param pid - PID of the spawned dev server; `undefined` if the spawn never reported one, in which
 *   case there is nothing to kill and no marker was written.
 */
function killSpawnedDevServer(pid: number | undefined): void {
  if (!pid) return;
  console.log(`Renderer dev server failed to become ready — stopping it (PID: ${pid})...`);
  killProcessTree(pid, 'SIGTERM');
  removeDevServerPidMarker();
}

/**
 * Delete the dev server's PID marker so no later cleanup kills by the PID it holds. Best-effort: a
 * filesystem error is warned about and swallowed, since one caller runs while an exception is
 * already propagating and the other must not fail a healthy bootstrap over a marker.
 */
function removeDevServerPidMarker(): void {
  try {
    fs.rmSync(DEV_SERVER_PID_FILE, { force: true });
  } catch (error) {
    console.warn(
      `Could not remove renderer dev server PID marker ${DEV_SERVER_PID_FILE}: ${error}`,
    );
  }
}

/**
 * Playwright global setup for the smoke config. Runs once before any test worker starts. Bootstraps
 * the renderer dev server via {@link bootstrapRendererDevServer}; the smoke fixture
 * (`app.fixture.ts`) then launches its own Electron instance per worker.
 *
 * @param _config - Playwright config object — unused; required by Playwright's global-setup
 *   interface.
 * @throws {Error} If port 8876 is already in use.
 * @throws {Error} If the extension fails to build.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function globalSetup(_config: FullConfig): Promise<void> {
  await bootstrapRendererDevServer();
}
