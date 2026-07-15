// Cross-platform process-tree termination, shared by global-teardown.ts and global-teardown-cdp.ts.
import { execFileSync } from 'child_process';

/**
 * Forcibly kill a process and all of its descendants, cross-platform.
 *
 * Both the renderer dev server and the self-launched Electron app spawn a tree of child processes.
 * Killing only the top PID leaves the children running — orphaned webpack workers, or a held PAPI
 * WebSocket port that poisons the next run's fast-fail port check.
 *
 * - On Windows there is no process group, so shell out to `taskkill /T /F`, which terminates the
 *   whole descendant tree. `taskkill` always force-kills, so `signal` is ignored on this branch.
 * - Elsewhere the target was spawned `detached` (its own process-group leader): signal the negative
 *   PID to hit the whole group, falling back to the bare PID if the group is already gone.
 *
 * @param pid PID of the detached process to kill. Non-positive values are rejected (see the guard).
 * @param signal POSIX signal to send when not on Windows (ignored on Windows). Defaults to
 *   `'SIGTERM'`.
 * @returns `true` if a kill was issued, `false` if the PID was invalid or the process was already
 *   gone.
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  if (pid <= 0) {
    // Guard against a malformed PID (e.g. parseInt yielding 0 or a negative from a corrupt PID
    // file): signaling -0/0 would target our own process group and a negative PID an unrelated one.
    return false;
  }
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
