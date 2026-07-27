// Teardown for the self-launching CDP (feature-test) config.
import type { FullConfig } from '@playwright/test';
import fs from 'fs';
import { CDP_PID_FILE, CDP_USER_DATA_FILE, restoreSeededSettings } from './global-setup-cdp';
import globalTeardown, { killProcessFromPidFile } from './global-teardown';
import { removeDirWithRetry, waitForPidExit } from './process-utils';

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
  // SIGKILL (not SIGTERM): Electron can ignore SIGTERM, and we need it fully dead before removing
  // its user-data dir below.
  const { killed: appKilled, pid: appPid } = killProcessFromPidFile(
    CDP_PID_FILE,
    'SIGKILL',
    'self-launched Platform.Bible (CDP) app',
  );

  // Remove the isolated user-data dir created for this run. Give the just-killed Electron a moment to
  // actually exit and release the SingletonLock before removing — polling for exit rather than
  // listening for it, since teardown only has a bare PID, not a live process handle.
  //
  // The whole user-data cleanup is best-effort: every step is guarded, and the settings restore plus
  // the shared teardown run from `finally` regardless. Skipping them would leak the renderer dev
  // server and lingering Electron processes, and leave the developer's seeded settings on disk —
  // far worse than a leftover temp dir or marker file.
  try {
    if (fs.existsSync(CDP_USER_DATA_FILE)) {
      const userDataDir = fs.readFileSync(CDP_USER_DATA_FILE, 'utf-8').trim();
      if (userDataDir) {
        if (appKilled && appPid !== undefined) {
          await waitForPidExit(appPid, 1_000);
        }
        await removeDirWithRetry(userDataDir, 'CDP user-data dir');
      }
      fs.unlinkSync(CDP_USER_DATA_FILE);
    }
  } catch (e) {
    // An fs error here — a locked file on Windows, or the marker deleted by a concurrent run
    // between the existsSync and the read/unlink — is logged and swallowed.
    console.warn(`Could not clean up CDP user-data marker ${CDP_USER_DATA_FILE}: ${e}`);
  } finally {
    restoreSeededSettings();

    // Delegate to the shared teardown to stop the renderer dev server and sweep lingering processes.
    await globalTeardown(config);
  }
}
