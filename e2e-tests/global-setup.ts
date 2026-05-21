// Adapted from paranext-core/e2e-tests/global-setup.ts
import type { FullConfig } from '@playwright/test';
import { execSync, spawn } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';

const WEBSOCKET_PORT = 8876;
const RENDERER_PORT = 1212;

/** Check if a port is already in use */
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

/** Wait until a port is accepting connections */
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

// Playwright global setup requires this signature even though config is unused
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
    await waitForPort(RENDERER_PORT, 120_000);
    console.log('Renderer dev server is ready.');
  }
}
