import type { FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import globalSetupCdp, { CDP_PORT } from './global-setup-cdp';
import { isPortInUse } from './global-setup';
import { launchPackagedApp, PACKAGED_APP_PATH } from './perf-app';

/** The development host's storage for this extension's projects and drafts. */
const STORAGE_DIR = path.resolve(
  __dirname,
  '../../paranext-core/dev-appdata/extensions/interlinearizer/user-data',
);

/** Where the developer's storage waits out a run. */
const STORAGE_BACKUP_DIR = `${STORAGE_DIR}.perf-backup`;

/** Puts back storage a run set aside, discarding what the run stored. */
export function restoreStorage(): void {
  if (!fs.existsSync(STORAGE_BACKUP_DIR)) return;
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
  fs.renameSync(STORAGE_BACKUP_DIR, STORAGE_DIR);
}

/**
 * Launches the app as the CDP tier does, but over empty extension storage, so listing projects
 * reads only what the run seeds and the developer's drafts and projects stay untouched. A run that
 * reuses an already-running app keeps that app's storage, since it may already have read it. With
 * `PERF_APP_PATH` set it builds the extension and launches that packaged app in its own home.
 */
export default async function globalSetupPerf(config: FullConfig): Promise<void> {
  if (await isPortInUse(CDP_PORT)) {
    await globalSetupCdp(config);
    return;
  }
  if (PACKAGED_APP_PATH) {
    const buildScript = process.env.E2E_BUILD_SCRIPT ?? 'build:production';
    execSync(`npm run ${buildScript}`, { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' });
    await launchPackagedApp();
    return;
  }
  // A crashed run leaves its backup in place; put it back before setting storage aside again.
  restoreStorage();
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.renameSync(STORAGE_DIR, STORAGE_BACKUP_DIR);
  fs.mkdirSync(STORAGE_DIR);
  try {
    await globalSetupCdp(config);
  } catch (error) {
    restoreStorage();
    throw error;
  }
}
