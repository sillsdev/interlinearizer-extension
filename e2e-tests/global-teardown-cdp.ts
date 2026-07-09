// Teardown for the self-launching CDP (feature-test) config.
import type { FullConfig } from '@playwright/test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { CDP_PID_FILE, CDP_USER_DATA_FILE } from './global-setup-cdp';
import globalTeardown from './global-teardown';

/**
 * Forcibly kill the launched app and all of its children, cross-platform.
 *
 * Electron spawns a tree of processes (main, renderer, GPU, utility). Leaving any alive holds the
 * PAPI WebSocket port and poisons the next run's fast-fail port check, so we must kill the whole
 * tree, not just the top process.
 *
 * - On Windows there is no process group and `process.kill(-pid)` is meaningless, so shell out to
 *   `taskkill /T /F`, which terminates the process and its entire descendant tree.
 * - Elsewhere the app was spawned `detached`, so it is its own process-group leader: signal the
 *   negative PID to SIGKILL the whole group in one call, falling back to the bare PID if the group
 *   is already gone.
 *
 * @param pid PID of the detached app process recorded by {@link globalSetupCdp}.
 * @returns `true` if a kill was issued, `false` if the process was already gone.
 */
function killAppTree(pid: number): boolean {
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
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      // Already stopped
      return false;
    }
  }
}

/**
 * Playwright global teardown for the CDP config. Kills the Electron instance launched by
 * {@link globalSetupCdp} (by the PID recorded in {@link CDP_PID_FILE}), removes its isolated
 * user-data dir, then delegates to the shared {@link globalTeardown} to stop the renderer dev server
 * and sweep any lingering core processes.
 *
 * @param config Playwright config object — forwarded to the shared teardown.
 * @returns Resolves when the launched app is killed, its user-data dir removed, and shared teardown
 *   has completed.
 */
export default async function globalTeardownCdp(config: FullConfig): Promise<void> {
  // Kill the app we launched (whole process tree) before the shared teardown's generic sweep.
  // SIGKILL/`/F` (not SIGTERM) to match the smoke teardown: Electron can ignore SIGTERM, and we
  // need it fully dead before removing its user-data dir below.
  let appKilled = false;
  if (fs.existsSync(CDP_PID_FILE)) {
    const pid = parseInt(fs.readFileSync(CDP_PID_FILE, 'utf-8').trim(), 10);
    if (Number.isNaN(pid)) {
      console.warn(`Invalid PID in ${CDP_PID_FILE}, skipping app kill`);
    } else {
      console.log(`Stopping self-launched Platform.Bible (CDP) app (PID: ${pid})...`);
      appKilled = killAppTree(pid);
    }
    fs.unlinkSync(CDP_PID_FILE);
  }

  // Remove the isolated user-data dir created for this run. Give the just-killed Electron a moment
  // to release the SingletonLock and flush files before removing, then retry once — the smoke
  // teardown removes its dir the same defensive way.
  if (fs.existsSync(CDP_USER_DATA_FILE)) {
    const userDataDir = fs.readFileSync(CDP_USER_DATA_FILE, 'utf-8').trim();
    if (userDataDir) {
      if (appKilled) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1_000);
        });
      }
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 3_000);
        });
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch (e) {
          console.warn(`Could not remove CDP user-data dir ${userDataDir}: ${e}`);
        }
      }
    }
    fs.unlinkSync(CDP_USER_DATA_FILE);
  }

  // Delegate to the shared teardown to stop the renderer dev server and sweep lingering processes.
  await globalTeardown(config);
}
