// Adapted from paranext-core/e2e-tests/global-teardown.ts
import type { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Playwright global teardown. Runs once after all test workers have finished.
 *
 * Stops the renderer dev server started by {@link globalSetup} (if any), then runs `npm run stop` in
 * paranext-core to terminate any lingering Electron processes.
 *
 * @param _config Playwright config object — unused; required by Playwright's global-teardown
 *   interface.
 * @returns Resolves when all cleanup steps have completed.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const extensionRoot = path.resolve(__dirname, '..');
  const coreDir = path.resolve(__dirname, '../../paranext-core');

  // Kill the renderer dev server if we started it
  const pidFile = path.join(extensionRoot, 'e2e-tests', '.dev-server.pid');
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (Number.isNaN(pid)) {
      console.warn(`Invalid PID in ${pidFile}, skipping process kill`);
      fs.unlinkSync(pidFile);
    } else {
      console.log(`Stopping renderer dev server (PID: ${pid})...`);
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Already stopped
        }
      }
      fs.unlinkSync(pidFile);
    }
  }

  // Run the core stop script to ensure all Electron processes are terminated
  console.log('Running cleanup: npm run stop (in paranext-core)');
  try {
    execSync('npm run stop', { cwd: coreDir, stdio: 'pipe', timeout: 10_000 });
    console.log('Cleanup completed.');
  } catch {
    console.log('Cleanup: No processes to stop or already stopped.');
  }
}
