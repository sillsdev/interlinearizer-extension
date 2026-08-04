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
 */
export default async function globalTeardownCdp(config: FullConfig): Promise<void> {
  // Snapshot before killProcessFromPidFile unlinks CDP_PID_FILE. `||` not `&&`: a run that crashed
  // between globalSetupCdp's two marker writes still owns a seed with only one marker present.
  const launchedApp = fs.existsSync(CDP_PID_FILE) || fs.existsSync(CDP_USER_DATA_FILE);

  try {
    // Kill the app we launched (whole process tree) before the shared teardown's generic sweep.
    // SIGKILL (not SIGTERM): Electron can ignore SIGTERM, and we need it fully dead before removing
    // its user-data dir below.
    const { killed: appKilled, pid: appPid } = killProcessFromPidFile(
      CDP_PID_FILE,
      'SIGKILL',
      'self-launched Platform.Bible (CDP) app',
    );

    // Remove the isolated user-data dir created for this run. Give the just-killed Electron a moment
    // to actually exit and release the SingletonLock before removing — polling for exit rather than
    // listening for it, since teardown only has a bare PID, not a live process handle.
    if (fs.existsSync(CDP_USER_DATA_FILE)) {
      const userDataDir = fs.readFileSync(CDP_USER_DATA_FILE, 'utf-8').trim();
      if (userDataDir) {
        if (appKilled && appPid !== undefined) {
          await waitForPidExit(appPid, 1_000);
        }
        await removeDirWithRetry(userDataDir, 'CDP user-data dir');
      }
      // Guard the marker removal: an fs error here (locked file on Windows, or the file deleted by a
      // concurrent run between the existsSync above and this unlink) must not abort teardown before
      // the shared cleanup below — that would leak the renderer dev server and lingering Electron.
      try {
        fs.unlinkSync(CDP_USER_DATA_FILE);
      } catch (e) {
        console.warn(`Could not remove CDP user-data marker ${CDP_USER_DATA_FILE}: ${e}`);
      }
    }
  } catch (error) {
    console.warn(`CDP teardown's own cleanup failed: ${error}`);
  }

  // Gated like the resources above: the shared backup file (helpers.ts) could otherwise belong to a
  // still-in-flight smoke run, not this one.
  if (launchedApp) restoreSeededSettings();

  // Delegate to the shared teardown to stop the renderer dev server and sweep lingering processes.
  await globalTeardown(config);
}
