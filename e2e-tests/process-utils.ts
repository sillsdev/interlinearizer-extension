// Cross-platform process-tree termination, shared by global-teardown.ts and global-teardown-cdp.ts.
import { execFileSync } from 'child_process';

/**
 * Forcibly kill a process and all of its descendants, cross-platform.
 *
 * Both the renderer dev server (`npm run start:renderer`, spawned via a shell) and the
 * self-launched Electron app spawn a tree of child processes (webpack workers;
 * main/renderer/GPU/utility). Killing only the top PID leaves the children running, which for the
 * dev server means orphaned webpack workers and for Electron means a held PAPI WebSocket port that
 * poisons the next run's fast-fail port check.
 *
 * - On Windows there is no process group and `process.kill(-pid)` is meaningless, so shell out to
 *   `taskkill /T /F`, which terminates the process and its entire descendant tree. `taskkill`
 *   always force-kills (no graceful-signal equivalent), so `signal` is ignored on this branch.
 * - Elsewhere the target was spawned `detached`, so it is its own process-group leader: signal the
 *   negative PID to signal the whole group in one call, falling back to the bare PID if the group
 *   is already gone.
 *
 * @param pid PID of the detached process to kill.
 * @param signal POSIX signal to send when not on Windows (ignored on Windows, which always
 *   force-kills). Defaults to `'SIGTERM'`.
 * @returns `true` if a kill was issued, `false` if the process was already gone.
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return true;
    } catch {
      // taskkill exits non-zero when the process is already gone — nothing left to kill.
      return false;
    }
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      // Already stopped
      return false;
    }
  }
}
