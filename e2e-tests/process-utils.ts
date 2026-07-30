// Cross-platform process-tree termination.
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
 * @param pid - PID of the detached process to kill. Non-positive values are rejected (see the
 *   guard).
 * @param signal - POSIX signal to send when not on Windows (ignored on Windows). Defaults to
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
 * How long either tier waits for a SIGKILLed app to actually exit before touching the files it held
 * (its user-data dir, and paranext-core's shared dev-appdata settings the run seeded). One budget
 * for both so the two paths that guard the same settings file cannot drift apart.
 *
 * SIGKILL gives the app no chance to flush settings on the way out, so what protects the seeded
 * file is restoring it only after the kill — never the length of this wait, which merely keeps a
 * still-open user-data dir from failing removal.
 */
export const POST_SIGKILL_EXIT_WAIT_MS = 3_000;

/**
 * Bound the wait for a killed process to actually exit without blindly sleeping the full timeout
 * when it dies sooner. Use before touching files the process may still hold open (e.g. its
 * user-data dir). Races `exitSignal` (a live process handle's exit event) against `timeoutMs`.
 *
 * For a caller with only a bare PID and no handle to listen on, use {@link waitForPidExit} instead.
 *
 * @param exitSignal - Promise that resolves when the process has exited.
 * @param timeoutMs - Cap on the wait; elapsing it resolves rather than throwing, so callers cannot
 *   distinguish a clean exit from a timeout.
 * @returns Resolves once `exitSignal` settles, or once `timeoutMs` elapses — whichever is first.
 */
export async function waitForProcessExit(
  exitSignal: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exitSignal,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_PID_POLL_INTERVAL_MS = 100;

/**
 * Poll for a PID to stop existing. This is the {@link waitForProcessExit} equivalent for a caller
 * with only a bare PID and no live process handle to listen on (e.g. teardown, which reads the PID
 * back from a marker file a separate setup invocation wrote).
 *
 * @param pid - PID to poll.
 * @param timeoutMs - Cap on the wait; elapsing it resolves rather than throwing, so callers cannot
 *   distinguish an exit from a timeout.
 * @param pollIntervalMs - Milliseconds between existence checks. Defaults to
 *   {@link DEFAULT_PID_POLL_INTERVAL_MS}.
 * @returns Resolves once the PID no longer exists or `timeoutMs` elapses — whichever is first.
 */
export async function waitForPidExit(
  pid: number,
  timeoutMs: number,
  pollIntervalMs = DEFAULT_PID_POLL_INTERVAL_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Signal 0 is a no-op existence probe — Node throws once the PID no longer exists.
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

const DEFAULT_RMDIR_RETRY_DELAY_MS = 3_000;

/**
 * Remove a directory tree, retrying once after a delay if the first attempt fails — e.g. a
 * just-killed process (Electron's SingletonLock, a Windows file handle) has not yet released it.
 * Best-effort and non-throwing: a persistent failure is logged, never thrown, so callers can rely
 * on this never aborting their own cleanup sequence.
 *
 * @param dir - Directory to remove.
 * @param label - Human-readable name for the directory, used in the warning log if removal
 *   ultimately fails (e.g. `'user data dir'`, `'CDP user-data dir'`).
 * @param retryDelayMs - Milliseconds to wait before the retry attempt. Defaults to
 *   {@link DEFAULT_RMDIR_RETRY_DELAY_MS}.
 */
export async function removeDirWithRetry(
  dir: string,
  label: string,
  retryDelayMs = DEFAULT_RMDIR_RETRY_DELAY_MS,
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
