import type { FullConfig } from '@playwright/test';
import { restoreStorage } from './global-setup-perf';
import globalTeardownCdp from './global-teardown-cdp';

/** Stops the app as the CDP tier does, then gives the developer back the storage it set aside. */
export default async function globalTeardownPerf(config: FullConfig): Promise<void> {
  try {
    await globalTeardownCdp(config);
  } finally {
    restoreStorage();
  }
}
