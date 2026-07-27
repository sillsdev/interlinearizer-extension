// Adapted from paranext-core/e2e-tests/global-teardown.ts
import type { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { DEV_SERVER_PID_FILE } from './global-setup';
import { killProcessTree } from './process-utils';

/** Return value of {@link killProcessFromPidFile}. */
export interface KillFromPidFileResult {
  /** Whether a valid PID was found and {@link killProcessTree} reported the kill succeeded. */
  killed: boolean;
  /** The PID that was targeted, if the file held a valid one — set regardless of kill success. */
  pid?: number;
}

/**
 * Remove a PID marker file, swallowing any filesystem error. Separate from the kill it accompanies
 * so a marker-removal failure cannot be mistaken for a kill failure (see the call sites in
 * {@link killProcessFromPidFile}). A leftover marker is harmless — the next run re-reads it and
 * finds a dead PID — so warning and continuing beats aborting teardown.
 *
 * @param pidFile Absolute path to the PID marker file to remove.
 * @param label Human-readable name of the process the marker belongs to, used in the warning log.
 * @returns Nothing.
 */
function removePidFile(pidFile: string, label: string): void {
  try {
    fs.unlinkSync(pidFile);
  } catch (e) {
    console.warn(`Could not remove ${label} PID marker ${pidFile}: ${e}`);
  }
}

/**
 * Kill a process recorded in a PID file (whole tree), then remove the PID file. Shared by this
 * teardown's dev-server kill and {@link globalTeardownCdp}'s launched-app kill, which follow the
 * same read-PID-file → validate → kill → remove-marker shape and differ only in signal and
 * logging.
 *
 * A missing PID file is a no-op; a file whose contents don't parse as an integer is warned about
 * and skipped rather than used to kill an arbitrary PID. The PID file is always removed when
 * present, so no run leaves a stale marker behind. A filesystem error (concurrent deletion, a
 * locked file) is warned about and swallowed so teardown continues rather than aborting — with the
 * marker removal guarded separately (see {@link removePidFile}) so it cannot downgrade a successful
 * kill to `killed: false`.
 *
 * @param pidFile Absolute path to the file holding the target process's PID.
 * @param signal Kill signal to send (`'SIGKILL'` when the target may ignore SIGTERM).
 * @param label Human-readable name of the process, used in the "Stopping <label>" log line.
 * @returns See {@link KillFromPidFileResult}.
 */
export function killProcessFromPidFile(
  pidFile: string,
  signal: 'SIGTERM' | 'SIGKILL',
  label: string,
): KillFromPidFileResult {
  // Teardown runs once after every worker; a filesystem error here (the PID file deleted by a
  // concurrent run between reads, or locked) must not abort the remaining cleanup (the core stop
  // script) and leak Electron processes. Wrap the whole read → validate → kill → unlink sequence so
  // any such error is logged and swallowed, continuing to return false.
  try {
    if (!fs.existsSync(pidFile)) return { killed: false };
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (Number.isNaN(pid)) {
      console.warn(`Invalid PID in ${pidFile}, skipping ${label} kill`);
      removePidFile(pidFile, label);
      return { killed: false };
    }
    console.log(`Stopping ${label} (PID: ${pid})...`);
    const killed = killProcessTree(pid, signal);
    // Remove the marker independently of the kill result: an fs error here says nothing about
    // whether the kill succeeded, and callers act on `killed`/`pid` (globalTeardownCdp waits for the
    // PID to exit before removing the app's user-data dir). Folding this into the outer catch would
    // report a successful kill as `killed: false` and skip that wait, hitting a live SingletonLock.
    removePidFile(pidFile, label);
    return { killed, pid };
  } catch (e) {
    console.warn(`Failed to kill ${label} from ${pidFile}: ${e}`);
    return { killed: false };
  }
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
  const coreDir = path.resolve(__dirname, '../../paranext-core');

  // Kill the renderer dev server if we started it
  killProcessFromPidFile(DEV_SERVER_PID_FILE, 'SIGTERM', 'renderer dev server');

  // Run the core stop script to ensure all Electron processes are terminated
  console.log('Running cleanup: npm run stop (in paranext-core)');
  try {
    execSync('npm run stop', { cwd: coreDir, stdio: 'pipe', timeout: 10_000 });
    console.log('Cleanup completed.');
  } catch {
    console.log('Cleanup: No processes to stop or already stopped.');
  }
}
