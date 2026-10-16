import type { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import globalSetupCdp, { CDP_PORT } from './global-setup-cdp';
import { isPortInUse, WEBSOCKET_PORT } from './global-setup';
import globalTeardownCdp from './global-teardown-cdp';
import { DEV_STORAGE_DIR as STORAGE_DIR } from '../perf/paths';
import { launchPackagedApp, PACKAGED_APP_PATH, stopPackagedApp } from './perf-app';

/** Where the developer's storage waits out a run. */
const STORAGE_BACKUP_DIR = `${STORAGE_DIR}.perf-backup`;

/** Puts back storage a run set aside, discarding what the run stored. */
function restoreStorage(): void {
  if (!fs.existsSync(STORAGE_BACKUP_DIR)) return;
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
  fs.renameSync(STORAGE_BACKUP_DIR, STORAGE_DIR);
}

/**
 * Launches the app as the CDP tier does, but over empty extension storage, so listing projects
 * reads only what the run seeds and the developer's drafts and projects stay untouched. With
 * `PERF_APP_PATH` set it builds the extension and launches that packaged app in its own home.
 *
 * @returns The run's teardown, which stops the app and gives back the storage set aside.
 * @throws {Error} If Platform.Bible is already running, since it may own the storage a run sets
 *   aside.
 */
export default async function globalSetupPerf(config: FullConfig): Promise<() => Promise<void>> {
  if ((await isPortInUse(CDP_PORT)) || (await isPortInUse(WEBSOCKET_PORT))) {
    throw new Error(
      "Platform.Bible is already running. Quit it, or a previous run's app, so the run gets an app and storage of its own.",
    );
  }
  if (PACKAGED_APP_PATH) {
    const buildScript = process.env.E2E_BUILD_SCRIPT ?? 'build:production';
    execSync(`npm run ${buildScript}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    await launchPackagedApp();
    return stopPackagedApp;
  }
  // A crashed run leaves its backup in place; put it back before setting storage aside again.
  restoreStorage();
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.renameSync(STORAGE_DIR, STORAGE_BACKUP_DIR);
  try {
    fs.mkdirSync(STORAGE_DIR);
    await globalSetupCdp(config);
  } catch (error) {
    restoreStorage();
    throw error;
  }
  return async () => {
    try {
      await globalTeardownCdp(config);
    } finally {
      restoreStorage();
    }
  };
}
