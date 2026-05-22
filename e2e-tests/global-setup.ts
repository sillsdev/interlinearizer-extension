// Adapted from paranext-core/e2e-tests/global-setup.ts
import type { FullConfig } from '@playwright/test';
import { execSync, spawn } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';

const WEBSOCKET_PORT = 8876;
const RENDERER_PORT = 1212;

/**
 * Check if a port is already in use.
 *
 * @param port Port number to probe.
 * @returns Resolves to `true` if the port is occupied, `false` if it is free.
 */
function isPortInUse(port: number): Promise<boolean> {
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
 * webpack-dev-middleware holds every request open until the current compilation finishes, so a
 * successful response guarantees the initial bundle is ready. Using this after `waitForPort`
 * ensures Electron is not launched while webpack is still compiling (which would cause a
 * mid-load HMR reload that closes the Playwright page reference).
 *
 * @param url URL to probe.
 * @param timeout Maximum time in milliseconds to wait before rejecting.
 * @returns Resolves when the server returns a non-5xx response.
 * @throws {Error} If the server does not respond within `timeout` milliseconds.
 */
function waitForHttpOk(url: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`${url} did not respond within ${timeout}ms`));
    }, timeout);

    const req = http.get(url, (res) => {
      clearTimeout(timer);
      res.resume();
      if (res.statusCode !== undefined && res.statusCode < 500) {
        resolve();
      } else {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Wait until a port is accepting connections.
 *
 * @param port Port number to poll.
 * @param timeout Maximum time in milliseconds to wait before rejecting.
 * @returns Resolves when a TCP connection to the port succeeds.
 * @throws {Error} If the port does not become available within `timeout` milliseconds.
 */
function waitForPort(port: number, timeout: number): Promise<void> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() - startTime > timeout) {
        reject(new Error(`Port ${port} did not become available within ${timeout}ms`));
        return;
      }
      const socket = net.createConnection(port, '127.0.0.1');
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
 * Playwright global setup. Runs once before any test worker starts.
 *
 * 1. Fails fast if port 8876 is already in use (a running Platform.Bible would conflict with the
 *    Electron instance launched by fixtures).
 * 2. Removes stale Electron singleton lock files left behind by crashes.
 * 3. Fails fast if the extension dist is missing (directs the developer to run `npm run build`).
 * 4. Ensures the paranext-core dev main bundle exists, building it via `npm run prestart` if not.
 * 5. Starts the paranext-core webpack renderer dev server on port 1212 if not already running, and
 *    stores its PID for {@link globalTeardown} to stop it.
 *
 * @param _config Playwright config object — unused; required by Playwright's global-setup
 *   interface.
 * @returns Resolves when the renderer dev server is ready.
 * @throws {Error} If port 8876 is already in use.
 * @throws {Error} If the extension dist is missing.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function globalSetup(_config: FullConfig): Promise<void> {
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

  // Fail fast if the extension dist is missing — tests cannot run without a built extension
  const extensionMain = path.join(extensionRoot, 'dist/src/main.js');
  if (!fs.existsSync(extensionMain)) {
    throw new Error(
      `Extension dist not found at ${extensionMain}. ` +
        'Run "npm run build" in interlinearizer-extension before running E2E tests.',
    );
  }
  console.log('Extension dist found.');

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

    const pidFile = path.join(extensionRoot, 'e2e-tests/.dev-server.pid');
    if (devServer.pid) {
      fs.writeFileSync(pidFile, String(devServer.pid));
    }

    console.log(`Waiting for renderer dev server on port ${RENDERER_PORT}...`);
    await waitForPort(RENDERER_PORT, 60_000);
    console.log(`Port ${RENDERER_PORT} is accepting connections. Waiting for webpack compilation...`);
    // webpack-dev-middleware blocks HTTP responses until the initial bundle is compiled.
    // Waiting here ensures Electron loads a fully-compiled renderer and avoids a mid-load
    // HMR full-reload that would close the Playwright page reference during tests.
    await waitForHttpOk(`http://localhost:${RENDERER_PORT}/`, 300_000);
    console.log('Renderer dev server is ready.');
  }
}
