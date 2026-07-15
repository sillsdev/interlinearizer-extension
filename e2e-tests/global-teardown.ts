// Adapted from paranext-core/e2e-tests/global-teardown.ts
import type { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { killProcessTree } from './process-utils';

/**
 * Kill a process recorded in a PID file (whole tree), then remove the PID file. Shared by this
 * teardown's dev-server kill and {@link globalTeardownCdp}'s launched-app kill, which follow the
 * same read-PID-file → validate → kill → remove-marker shape and differ only in signal and
 * logging.
 *
 * A missing PID file is a no-op; a file whose contents don't parse as an integer is warned about
 * and skipped rather than used to kill an arbitrary PID. The PID file is always removed when
 * present, so no run leaves a stale marker behind.
 *
 * @param pidFile Absolute path to the file holding the target process's PID.
 * @param signal Kill signal to send (`'SIGKILL'` when the target may ignore SIGTERM).
 * @param label Human-readable name of the process, used in the "Stopping <label>" log line.
 * @returns `true` if a valid PID was found and {@link killProcessTree} reported the kill succeeded;
 *   `false` if the PID file was absent or its contents were not a valid integer.
 */
export function killProcessFromPidFile(
  pidFile: string,
  signal: 'SIGTERM' | 'SIGKILL',
  label: string,
): boolean {
  if (!fs.existsSync(pidFile)) return false;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
  if (Number.isNaN(pid)) {
    console.warn(`Invalid PID in ${pidFile}, skipping ${label} kill`);
    fs.unlinkSync(pidFile);
    return false;
  }
  console.log(`Stopping ${label} (PID: ${pid})...`);
  const killed = killProcessTree(pid, signal);
  fs.unlinkSync(pidFile);
  return killed;
}

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
  killProcessFromPidFile(pidFile, 'SIGTERM', 'renderer dev server');

  // Run the core stop script to ensure all Electron processes are terminated
  console.log('Running cleanup: npm run stop (in paranext-core)');
  try {
    execSync('npm run stop', { cwd: coreDir, stdio: 'pipe', timeout: 10_000 });
    console.log('Cleanup completed.');
  } catch {
    console.log('Cleanup: No processes to stop or already stopped.');
  }
}
