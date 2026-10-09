import { test } from '@playwright/test';
import path from 'path';
import { readDraftJson, readManifest } from '../../../perf/dataset/store';
import { TIERS } from '../../../perf/dataset/tiers';
import { provenance, writeResults } from '../../../perf/results';
import { readCaptureMeta } from '../../../perf/usj-cache';
import {
  launchPackagedApp,
  OZONE_PLATFORM,
  PACKAGED_APP_PATH,
  stopPackagedApp,
} from '../../perf-app';
import {
  closeView,
  connect,
  MAX_WEBSOCKET_PAYLOAD_BYTES,
  openView,
  PERF_MARKS_KEY,
  Samples,
  sendCommand,
  sourceProjectId,
  waitForMeasure,
  wireBytes,
} from './view-driver';

const RUNS = Number(process.env.PERF_RUNS ?? 5);

/** Restarts the app, returning how long the new instance took to be ready. */
async function restart(): Promise<number> {
  await stopPackagedApp();
  return launchPackagedApp();
}

test('measure the first load after app start', async () => {
  test.skip(!PACKAGED_APP_PATH, 'Cold loads are measured on a packaged app; set PERF_APP_PATH.');
  const meta = readCaptureMeta();
  const requested = (process.env.PERF_TIERS ?? '').split(',').filter(Boolean);
  const tiers = TIERS.filter((t) => requested.length === 0 || requested.includes(t.name));
  const results: Record<string, unknown> = {};
  let originalDraft: unknown;

  await tiers.reduce(async (previous, tier) => {
    await previous;
    const draftJson = readDraftJson(tier.name);
    const draftWire = wireBytes(draftJson);
    if (draftWire > MAX_WEBSOCKET_PAYLOAD_BYTES) {
      results[tier.name] = {
        skipped: `The draft is ${(draftWire / 1e6).toFixed(1)} MB on the wire, over the websocket's per-message cap; the app cannot load it.`,
      };
      return;
    }

    const seeding = await connect();
    const projectId = await sourceProjectId(seeding.page);
    originalDraft ??= await sendCommand(seeding.page, 'interlinearizer.getDraft', projectId);
    await sendCommand(seeding.page, 'interlinearizer.saveDraft', projectId, draftJson);
    await closeView(seeding.page);
    await seeding.browser.close();

    const open = new Samples();
    for (let run = 0; run < RUNS; run += 1) {
      // eslint-disable-next-line no-await-in-loop
      const startupMs = await restart();
      // eslint-disable-next-line no-await-in-loop
      const { browser, page } = await connect();
      try {
        // A view the layout restored would load before the timed open could.
        // eslint-disable-next-line no-await-in-loop
        await closeView(page);
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate((key) => localStorage.setItem(key, 'true'), PERF_MARKS_KEY);
        // eslint-disable-next-line no-await-in-loop
        const frame = await openView(page, projectId, tier.viewBook);
        // eslint-disable-next-line no-await-in-loop
        await waitForMeasure(frame, 'book-render', tier.viewBook);
        // eslint-disable-next-line no-await-in-loop
        const settled = await waitForMeasure(frame, 'reanchor', tier.viewBook);
        open.add(settled);
        open.addValue('open-to-interactive', Math.max(...settled.map((m) => m.end)));
        open.addValue('app-startup', startupMs);
        // eslint-disable-next-line no-await-in-loop
        await closeView(page);
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate((key) => localStorage.removeItem(key), PERF_MARKS_KEY);
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await browser.close();
      }
    }
    results[tier.name] = {
      viewBook: tier.viewBook,
      dataset: { counts: readManifest(tier.name).counts, bytes: readManifest(tier.name).bytes },
      open: open.summary(),
    };
    console.log(`${tier.name}: ${JSON.stringify(results[tier.name], undefined, 2)}`);
  }, Promise.resolve());

  if (originalDraft !== undefined) {
    const { browser, page } = await connect();
    await sendCommand(
      page,
      'interlinearizer.saveDraft',
      await sourceProjectId(page),
      originalDraft,
    );
    await browser.close();
  }

  const file = writeResults('cold', {
    ...provenance(meta.coreCommit),
    host: 'packaged',
    display: OZONE_PLATFORM,
    extensionBuild:
      (process.env.E2E_BUILD_SCRIPT ?? 'build:production') === 'build:production'
        ? 'production'
        : 'development',
    runs: RUNS,
    tiers: results,
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
});
