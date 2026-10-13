import type { Browser, Frame, Page } from '@playwright/test';
import path from 'path';
import { readDraftJson, readManifest } from '../../../perf/dataset/store';
import { TIERS, type TierSpec } from '../../../perf/dataset/tiers';
import { provenance, writeResults } from '../../../perf/results';
import { readCaptureMeta } from '../../../perf/usj-cache';
import { expect, test } from '../../fixtures/cdp.fixture';
import { waitForAppAndInterlinearizerReady } from '../../fixtures/helpers';
import {
  launchPackagedApp,
  OZONE_PLATFORM,
  PACKAGED_APP_PATH,
  stopPackagedApp,
} from '../../perf-app';
import type { HostHeap } from './host-inspector';
import {
  clearMeasures,
  closeView,
  connect,
  HOST_CALLS,
  hostHeap,
  heapUsed,
  MAX_WEBSOCKET_PAYLOAD_BYTES,
  type Measure,
  openView,
  PERF_MARKS_KEY,
  Samples,
  scenarioSamples,
  type ScenarioSamples,
  sendCommand,
  setBook,
  setHostPerfMarks,
  sourceProjectId,
  takeHostEntries,
  waitForMeasure,
  wireBytes,
} from './view-driver';

const RUNS = Number(process.env.PERF_RUNS ?? 10);

/** Edits made before reading the heap, enough to fill the undo history. */
const UNDO_FILL_EDITS = 100;

/** Book the book-switch scenario leaves for before returning, short so its load stays cheap. */
const AWAY_BOOK = 'JUD';

/** Names the saved projects a run seeds, so a later run can recognize them. */
const SAVED_PROJECT_NAME = /^Perf [a-z-]+ \d+$/;

/** Tries at picking a menu item before a run gives up on it. */
const MENU_ATTEMPTS = 3;

/** The app a run drives; restarting a packaged app replaces its connection. */
type App = { page: Page; browser?: Browser };

function tokenGlossInputs(frame: Frame) {
  return frame.locator('input[aria-label^="Gloss for "]:not([aria-label^="Gloss for morpheme"])');
}

/** Glosses the `index`th visible word and commits it, as a reader moving on with Tab does. */
async function editGloss(frame: Frame, index: number, value: string): Promise<void> {
  const input = tokenGlossInputs(frame).nth(index);
  await input.fill(value);
  await input.press('Tab');
}

/** Picks `item` from the Project menu, starting over when a re-render closes the menu mid-click. */
async function openProjectMenuItem(
  frame: Frame,
  item: RegExp,
  attemptsLeft = MENU_ATTEMPTS,
): Promise<void> {
  try {
    await frame.locator("button[aria-label='Project']").first().click();
    await frame.getByRole('menuitem', { name: item }).first().click({ timeout: 5_000 });
  } catch (error) {
    if (attemptsLeft <= 1) throw error;
    await frame.page().keyboard.press('Escape');
    await openProjectMenuItem(frame, item, attemptsLeft - 1);
  }
}

/** Turns on timing entries in the WebView and the extension host. */
async function enableMarks(page: Page): Promise<void> {
  await page.evaluate((key) => localStorage.setItem(key, 'true'), PERF_MARKS_KEY);
  await setHostPerfMarks(page, true);
}

/**
 * Restarts the packaged app and points `app` at the new instance, with no view open.
 *
 * @returns Milliseconds until the new instance was ready.
 */
async function restart(app: App): Promise<number> {
  await app.browser?.close();
  await stopPackagedApp();
  const startupMs = await launchPackagedApp();
  Object.assign(app, await connect());
  // A view the layout restored would load before a timed open could.
  await closeView(app.page);
  await enableMarks(app.page);
  return startupMs;
}

/** Stores the tier's draft and saved projects, adding each project's id to `created` as it lands. */
async function seedTier(
  page: Page,
  projectId: string,
  tier: TierSpec,
  draftJson: string,
  created: string[],
): Promise<void> {
  await sendCommand(page, 'interlinearizer.saveDraft', projectId, draftJson);
  const analysisJson = JSON.stringify(JSON.parse(draftJson).analysis);
  for (let i = 0; i < tier.savedProjects; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const projectJson = await sendCommand(
      page,
      'interlinearizer.createProject',
      projectId,
      ['en'],
      undefined,
      `Perf ${tier.name} ${i + 1}`,
    );
    if (typeof projectJson !== 'string') throw new Error('createProject returned no project');
    const { id } = JSON.parse(projectJson);
    created.push(id);
    // eslint-disable-next-line no-await-in-loop
    await sendCommand(page, 'interlinearizer.saveAnalysis', id, analysisJson, 'null');
  }
}

/** Deletes saved projects an interrupted run left behind, so the picker lists only this run's. */
async function deleteLeftoverProjects(page: Page, projectId: string): Promise<void> {
  const json = await sendCommand(page, 'interlinearizer.getProjectsForSource', projectId);
  if (typeof json !== 'string') return;
  const projects: { id: string; name?: string }[] = JSON.parse(json);
  await Promise.all(
    projects
      .filter(({ name }) => name && SAVED_PROJECT_NAME.test(name))
      .map(({ id }) => sendCommand(page, 'interlinearizer.deleteProject', id)),
  );
}

/** Opens a fresh view on `book` and adds its load, the host's draft fetch included, to `open`. */
async function measureOpen(
  page: Page,
  projectId: string,
  book: string,
  open: ScenarioSamples,
): Promise<void> {
  await takeHostEntries(page);
  const frame = await openView(page, projectId, book);
  await waitForMeasure(frame, 'book-render', book);
  const settled = await waitForMeasure(frame, 'reanchor', book);
  open.webView.add(settled);
  open.webView.addValue('open-to-interactive', Math.max(...settled.map((m) => m.end)));
  open.addHostCall(HOST_CALLS.getDraft, await takeHostEntries(page), settled);
  await closeView(page);
}

/** The bytes a measure's detail records, when it records any. */
function detailBytes(measures: Measure[], name: string): number | undefined {
  const detail = measures.find((m) => m.name === name)?.detail;
  return detail &&
    typeof detail === 'object' &&
    'bytes' in detail &&
    typeof detail.bytes === 'number'
    ? detail.bytes
    : undefined;
}

/** Fills `result` scenario by scenario, so a failure keeps whatever was already measured. */
async function measureTier(
  app: App,
  projectId: string,
  tier: TierSpec,
  createdProjects: string[],
  result: Record<string, unknown>,
): Promise<void> {
  const manifest = readManifest(tier.name);
  const draftJson = readDraftJson(tier.name);
  const draftWire = wireBytes(draftJson);
  Object.assign(result, {
    viewBook: tier.viewBook,
    dataset: { counts: manifest.counts, bytes: manifest.bytes },
    wireBytes: { draft: draftWire, projectsForSource: draftWire * tier.savedProjects },
  });
  if (draftWire > MAX_WEBSOCKET_PAYLOAD_BYTES) {
    result.skipped = `The draft is ${(draftWire / 1e6).toFixed(1)} MB on the wire, over the websocket's per-message cap; the app cannot load it.`;
    return;
  }

  await closeView(app.page);
  await seedTier(app.page, projectId, tier, draftJson, createdProjects);

  // The first open after each app start.
  if (PACKAGED_APP_PATH) {
    const cold = scenarioSamples();
    for (let run = 0; run < RUNS; run += 1) {
      // eslint-disable-next-line no-await-in-loop
      cold.webView.addValue('app-startup', await restart(app));
      // eslint-disable-next-line no-await-in-loop
      await measureOpen(app.page, projectId, tier.viewBook, cold);
    }
    result.cold = cold.summary();
    // The warm scenarios start from a fresh app too, so none inherits the cold runs' heap.
    await restart(app);
  }
  const { page } = app;

  const heapBefore = await heapUsed(page);
  let hostBefore: HostHeap | undefined;
  let hostSkipped: string | undefined;
  try {
    hostBefore = await hostHeap(page);
  } catch (e) {
    hostSkipped = `the extension host's inspector could not force a garbage collection (${e instanceof Error ? e.message : String(e)}).`;
  }
  const webViewMemory: Record<string, number> = { heapBeforeOpenBytes: heapBefore };
  const hostMemory: Record<string, number> = hostBefore
    ? { heapBeforeOpenBytes: hostBefore.heapUsed }
    : {};
  result.memory = { webView: webViewMemory, host: hostMemory, ...(hostSkipped && { hostSkipped }) };
  /** Records both heaps at `point`, against their readings before the view opened. */
  const recordMemory = async (point: string) => {
    webViewMemory[`${point}Bytes`] = (await heapUsed(page)) - heapBefore;
    if (!hostBefore) return;
    const host = await hostHeap(page);
    hostMemory[`${point}Bytes`] = host.heapUsed - hostBefore.heapUsed;
    hostMemory[`${point}ExternalBytes`] = host.external - hostBefore.external;
    hostMemory[`${point}RssBytes`] = host.rss - hostBefore.rss;
  };

  // A freshly opened WebView in an app that is already running.
  const open = scenarioSamples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await measureOpen(page, projectId, tier.viewBook, open);
  }
  result.open = open.summary();

  // Switching back to the view book in a WebView that already holds the draft.
  const frame = await openView(page, projectId, tier.viewBook);
  await waitForMeasure(frame, 'reanchor', tier.viewBook);
  await recordMemory('viewLoaded');
  const switchBook = new Samples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await setBook(page, AWAY_BOOK);
    // eslint-disable-next-line no-await-in-loop
    await waitForMeasure(frame, 'reanchor', AWAY_BOOK);
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await setBook(page, tier.viewBook);
    // eslint-disable-next-line no-await-in-loop
    await waitForMeasure(frame, 'book-render', tier.viewBook);
    switchBook.add(
      // eslint-disable-next-line no-await-in-loop
      await waitForMeasure(frame, 'reanchor', tier.viewBook),
      ['usj-fetch', 'tokenize', 'reanchor', 'book-render'],
    );
  }
  result.switchBook = switchBook.summary();

  // Edits: one gloss committed, then its debounced autosave round-trip.
  const edits = scenarioSamples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await takeHostEntries(page);
    // eslint-disable-next-line no-await-in-loop
    await editGloss(frame, run, `perf-${run}`);
    // eslint-disable-next-line no-await-in-loop
    await waitForMeasure(frame, 'dispatch-render');
    // eslint-disable-next-line no-await-in-loop
    const measures = await waitForMeasure(frame, 'autosave');
    edits.webView.add(measures, ['dispatch-render', 'autosave-serialize', 'autosave']);
    // eslint-disable-next-line no-await-in-loop
    edits.addHostCall(HOST_CALLS.saveDraft, await takeHostEntries(page), measures);
  }
  result.edit = edits.summary();

  for (let i = 0; i < UNDO_FILL_EDITS; i += 1) {
    // The last edit's autosave lands before the heaps are read, so neither holds a save in flight.
    // eslint-disable-next-line no-await-in-loop
    if (i === UNDO_FILL_EDITS - 1) await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await editGloss(frame, i % 20, `undo-${i}`);
  }
  await waitForMeasure(frame, 'autosave');
  await clearMeasures(frame);
  await recordMemory('withFullUndoHistory');

  // Picker: listing the source's saved projects.
  const dialog = frame.locator('[data-slot="dialog-content"]');
  const picker = scenarioSamples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await takeHostEntries(page);
    // eslint-disable-next-line no-await-in-loop
    await openProjectMenuItem(frame, /Select Interlinear Project/i);
    // eslint-disable-next-line no-await-in-loop
    const measures = await waitForMeasure(frame, 'projects-fetch');
    picker.webView.add(measures, ['projects-fetch']);
    // eslint-disable-next-line no-await-in-loop
    picker.addHostCall(HOST_CALLS.getProjectsForSource, await takeHostEntries(page), measures);
    // eslint-disable-next-line no-await-in-loop
    await frame.getByRole('button', { name: 'Cancel' }).first().click();
    // eslint-disable-next-line no-await-in-loop
    await expect(dialog).toHaveCount(0);
  }
  result.picker = picker.summary();
  await recordMemory('afterPicker');

  // Save: writing the draft's analysis to the project it was opened from.
  await clearMeasures(frame);
  await openProjectMenuItem(frame, /Select Interlinear Project/i);
  await dialog
    .locator('li > button', { hasText: `Perf ${tier.name} 1` })
    .first()
    .click();
  // Replacing an edited draft asks first; an unedited one opens straight away.
  await frame
    .getByTestId('discard-draft-confirm')
    .click({ timeout: 5_000 })
    .catch(() => {});
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  // Opening the project reseeds the store; a menu opened before that lands is dismissed by it.
  await waitForMeasure(frame, 'store-mount');
  const saves = scenarioSamples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await takeHostEntries(page);
    // eslint-disable-next-line no-await-in-loop
    await openProjectMenuItem(frame, /^Save(?! As)/);
    // eslint-disable-next-line no-await-in-loop
    const measures = await waitForMeasure(frame, 'save');
    // A save then persists the draft as clean, and that re-render would close the next run's menu.
    // eslint-disable-next-line no-await-in-loop
    await waitForMeasure(frame, 'autosave');
    saves.webView.add(measures, ['save']);
    const bytes = detailBytes(measures, 'save');
    if (bytes !== undefined) saves.webView.addValue('save-bytes', bytes);
    // eslint-disable-next-line no-await-in-loop
    saves.addHostCall(HOST_CALLS.saveAnalysis, await takeHostEntries(page), measures);
  }
  result.save = saves.summary();
  await recordMemory('afterSave');

  // Concordance: indexing every book of the source, in a fresh WebView each run since a WebView
  // keeps the index it built.
  const concordance = new Samples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await closeView(page);
    // eslint-disable-next-line no-await-in-loop
    const view = await openView(page, projectId, tier.viewBook);
    // eslint-disable-next-line no-await-in-loop
    await waitForMeasure(view, 'reanchor', tier.viewBook);
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(view);
    // eslint-disable-next-line no-await-in-loop
    await openProjectMenuItem(view, /^Concordance/);
    concordance.add(
      // eslint-disable-next-line no-await-in-loop
      await waitForMeasure(view, 'concordance-entries'),
      ['concordance-read', 'concordance-entries'],
    );
  }
  result.concordance = concordance.summary();
}

test('measure the app', async ({ mainPage }) => {
  const app: App = { page: mainPage };
  await waitForAppAndInterlinearizerReady(mainPage, { cdp: true });
  const meta = readCaptureMeta();
  const projectId = await sourceProjectId(mainPage);

  const requested = (process.env.PERF_TIERS ?? '').split(',').filter(Boolean);
  const tiers = TIERS.filter((t) => requested.length === 0 || requested.includes(t.name));
  await closeView(mainPage);
  await deleteLeftoverProjects(mainPage, projectId);
  const originalDraft = await sendCommand(mainPage, 'interlinearizer.getDraft', projectId);
  await enableMarks(mainPage);

  const createdProjects: string[] = [];
  const results: Record<string, Record<string, unknown>> = {};
  try {
    await tiers.reduce(async (previous, tier) => {
      await previous;
      const result: Record<string, unknown> = {};
      results[tier.name] = result;
      try {
        await measureTier(app, projectId, tier, createdProjects, result);
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      } finally {
        // Each tier's picker lists only the projects that tier seeded.
        await closeView(app.page);
        await Promise.all(
          createdProjects
            .splice(0)
            .map((id) => sendCommand(app.page, 'interlinearizer.deleteProject', id)),
        );
      }
      console.log(`${tier.name}: ${JSON.stringify(result, undefined, 2)}`);
    }, Promise.resolve());
  } finally {
    await closeView(app.page);
    await app.page.evaluate((key) => localStorage.removeItem(key), PERF_MARKS_KEY);
    await setHostPerfMarks(app.page, false);
    await sendCommand(app.page, 'interlinearizer.saveDraft', projectId, originalDraft);
  }

  const file = writeResults('app', {
    ...provenance(meta.coreCommit),
    appBuild: app.page.url().startsWith('http://localhost') ? 'dev renderer' : 'packaged',
    ...(PACKAGED_APP_PATH ? { display: OZONE_PLATFORM } : {}),
    extensionBuild:
      process.env.E2E_BUILD_SCRIPT === 'build:production' ? 'production' : 'development',
    runs: RUNS,
    tiers: results,
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
  await app.browser?.close();
});
