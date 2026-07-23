// Cross-platform process-tree termination, shared by global-teardown.ts and global-teardown-cdp.ts.
import { execFileSync } from 'child_process';
import fs from 'fs';

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

/**
 * Race `exitSignal` — a promise that resolves once a LIVE process handle reports its 'exit' event —
 * against `timeoutMs`. For a caller that just sent a kill signal to a process it holds a handle for
 * (an Electron app, a spawned child), this bounds the wait for the process to actually die before
 * touching files it may still hold open (e.g. its user-data dir), without blindly sleeping the full
 * timeout when the process dies sooner.
 *
 * For a caller that only has a bare PID (e.g. read from a marker file written by a different
 * process invocation, with no handle to listen on), use {@link waitForPidExit} instead.
 *
 * @param exitSignal Promise that resolves when the process has exited.
 * @param timeoutMs Maximum time in milliseconds to wait before giving up.
 * @returns Resolves once `exitSignal` settles, or once `timeoutMs` elapses — whichever is first.
 */
export async function waitForProcessExit(
  exitSignal: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    exitSignal,
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

/**
 * Poll for a PID to stop existing. For a caller with only a bare PID and no live process handle to
 * listen on (see {@link waitForProcessExit} for that case) — e.g. teardown, which reads the PID back
 * from a marker file a separate setup invocation wrote. Signal `0` tests existence without
 * affecting the process; Node (including on Windows) throws once the PID no longer exists.
 *
 * @param pid PID to poll.
 * @param timeoutMs Maximum time in milliseconds to wait before giving up.
 * @param pollIntervalMs Milliseconds between existence checks. Defaults to 100.
 * @returns Resolves once the PID no longer exists, or once `timeoutMs` elapses — whichever is
 *   first.
 */
export async function waitForPidExit(
  pid: number,
  timeoutMs: number,
  pollIntervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }
}

/**
 * Remove a directory tree, retrying once after a delay if the first attempt fails — e.g. a
 * just-killed process (Electron's SingletonLock, a Windows file handle) has not yet released it.
 * Best-effort and non-throwing: a persistent failure is logged, never thrown, so callers can rely
 * on this never aborting their own cleanup sequence.
 *
 * @param dir Directory to remove.
 * @param label Human-readable name for the directory, used in the warning log if removal ultimately
 *   fails (e.g. `'user data dir'`, `'CDP user-data dir'`).
 * @param retryDelayMs Milliseconds to wait before the retry attempt. Defaults to 3000.
 * @returns Resolves once removal succeeds or the retry attempt is exhausted.
 */
export async function removeDirWithRetry(
  dir: string,
  label: string,
  retryDelayMs = 3_000,
): Promise<void> {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, retryDelayMs);
    });
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove ${label} ${dir}: ${error}`);
    }
  }
}
