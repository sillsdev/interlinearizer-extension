import type { Frame, Page } from '@playwright/test';
import path from 'path';
import { summarize, type Timing } from '../../../perf/bench/measure';
import { readDraftJson, readManifest } from '../../../perf/dataset/store';
import { TIERS, type TierSpec } from '../../../perf/dataset/tiers';
import { SOURCE_PROJECT_NAME } from '../../../perf/paths';
import { provenance, writeResults } from '../../../perf/results';
import { readCaptureMeta } from '../../../perf/usj-cache';
import { expect, test } from '../../fixtures/cdp.fixture';
import { waitForAppAndInterlinearizerReady } from '../../fixtures/helpers';

const RUNS = Number(process.env.PERF_RUNS ?? 5);

/** Edits made before reading the heap, enough to fill the undo history. */
const UNDO_FILL_EDITS = 100;

/** Paranext-core's cap on one websocket message, which every command argument and result crosses. */
const MAX_WEBSOCKET_PAYLOAD_BYTES = 100 * 1024 * 1024;

/** Book the book-switch scenario leaves for before returning, short so its load stays cheap. */
const AWAY_BOOK = 'JUD';

/** Storage key that asks the WebView for timing entries. */
const PERF_MARKS_KEY = 'interlinearizer.perfMarks';

const VIEW_TAB = /^Interlinearizer: WEB/;

/** Names the saved projects a run seeds, so a later run can recognize them. */
const SAVED_PROJECT_NAME = /^Perf [a-z-]+ \d+$/;

type Measure = { name: string; duration: number; end: number; detail: unknown };

/** Collected durations per measure name, summarized once a scenario's runs are done. */
class Samples {
  private readonly byName = new Map<string, number[]>();

  add(measures: Measure[], names?: readonly string[]): void {
    measures
      .filter(({ name }) => !names || names.includes(name))
      .forEach(({ name, duration }) => {
        const durations = this.byName.get(name) ?? [];
        durations.push(duration);
        this.byName.set(name, durations);
      });
  }

  addValue(name: string, value: number): void {
    this.add([{ name, duration: value, end: 0, detail: undefined }]);
  }

  summary(): Record<string, Timing> {
    return Object.fromEntries([...this.byName].map(([name, values]) => [name, summarize(values)]));
  }
}

/** Size of `json` once it is embedded as a string in a JSON-RPC message. */
function wireBytes(json: string): number {
  return Buffer.byteLength(JSON.stringify(json));
}

async function sendCommand(page: Page, command: string, ...args: unknown[]): Promise<unknown> {
  return page.evaluate(([name, params]) => window.papi.commands.sendCommand(name, ...params), [
    command,
    args,
  ] as const);
}

async function setBook(page: Page, book: string): Promise<void> {
  await page.evaluate(
    (bookCode) =>
      window.papi.scrollGroups.setScrRef(0, { book: bookCode, chapterNum: 1, verseNum: 1 }),
    book,
  );
}

/** The open WebView's frame, waiting for it to appear. */
async function viewFrame(page: Page): Promise<Frame> {
  const iframe = page.locator('iframe[title^="Interlinearizer: WEB"]').first();
  await expect(iframe).toBeAttached({ timeout: 60_000 });
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error('The Interlinearizer WebView has no frame');
  return frame;
}

async function openView(page: Page, projectId: string, book: string): Promise<Frame> {
  await setBook(page, book);
  await page.evaluate(
    (id) =>
      window.papi.webViews.openWebView('interlinearizer.mainWebView', undefined, { projectId: id }),
    projectId,
  );
  return viewFrame(page);
}

async function closeView(page: Page): Promise<void> {
  const tab = page.locator('.dock-tab', { hasText: VIEW_TAB });
  if ((await tab.count()) === 0) return;
  await tab.first().locator('.dock-tab-close-btn').dispatchEvent('click');
  await expect(tab).toHaveCount(0, { timeout: 30_000 });
}

/** Every timing entry the WebView has recorded, with its end relative to the frame's start. */
async function readMeasures(frame: Frame): Promise<Measure[]> {
  return frame.evaluate(() =>
    performance
      .getEntriesByType('measure')
      .filter((entry) => entry.name.startsWith('ilz:'))
      .map((entry) => ({
        name: entry.name.slice('ilz:'.length),
        duration: entry.duration,
        end: entry.startTime + entry.duration,
        detail: 'detail' in entry ? entry.detail : undefined,
      })),
  );
}

async function clearMeasures(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });
}

/**
 * Waits until the WebView has recorded `name`, for `book` when given, and returns every entry. Only
 * entries recorded since the last {@link clearMeasures} count.
 */
async function waitForMeasure(frame: Frame, name: string, book?: string): Promise<Measure[]> {
  await frame.waitForFunction(
    ([entryName, bookCode]) =>
      performance
        .getEntriesByName(entryName, 'measure')
        .some(
          (entry) =>
            bookCode === undefined ||
            ('detail' in entry &&
              !!entry.detail &&
              typeof entry.detail === 'object' &&
              'book' in entry.detail &&
              entry.detail.book === bookCode),
        ),
    [`ilz:${name}`, book] as const,
    { timeout: 10 * 60_000, polling: 50 },
  );
  return readMeasures(frame);
}

/** Bytes of JS heap the renderer holds after a full collection. */
async function heapUsed(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('HeapProfiler.collectGarbage');
    const { usedSize } = await session.send('Runtime.getHeapUsage');
    return usedSize;
  } finally {
    await session.detach();
  }
}

function tokenGlossInputs(frame: Frame) {
  return frame.locator('input[aria-label^="Gloss for "]:not([aria-label^="Gloss for morpheme"])');
}

/** Glosses the `index`th visible word and commits it, as a reader moving on with Tab does. */
async function editGloss(frame: Frame, index: number, value: string): Promise<void> {
  const input = tokenGlossInputs(frame).nth(index);
  await input.fill(value);
  await input.press('Tab');
}

async function openProjectMenuItem(frame: Frame, item: RegExp): Promise<void> {
  await frame.locator("button[aria-label='Project']").first().click();
  await frame.getByRole('menuitem', { name: item }).first().click();
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

async function measureTier(
  page: Page,
  projectId: string,
  tier: TierSpec,
  createdProjects: string[],
): Promise<Record<string, unknown>> {
  const manifest = readManifest(tier.name);
  const draftJson = readDraftJson(tier.name);
  const draftWire = wireBytes(draftJson);
  const result: Record<string, unknown> = {
    viewBook: tier.viewBook,
    dataset: { counts: manifest.counts, bytes: manifest.bytes },
    wireBytes: { draft: draftWire, projectsForSource: draftWire * tier.savedProjects },
  };
  if (draftWire > MAX_WEBSOCKET_PAYLOAD_BYTES) {
    result.skipped = `The draft is ${(draftWire / 1e6).toFixed(1)} MB on the wire, over the websocket's per-message cap; the app cannot load it.`;
    return result;
  }

  await closeView(page);
  await seedTier(page, projectId, tier, draftJson, createdProjects);
  const heapBefore = await heapUsed(page);

  // A freshly opened WebView, fetching the draft and text from scratch.
  const open = new Samples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    const frame = await openView(page, projectId, tier.viewBook);
    // eslint-disable-next-line no-await-in-loop
    await waitForMeasure(frame, 'book-render', tier.viewBook);
    // eslint-disable-next-line no-await-in-loop
    const settled = await waitForMeasure(frame, 'reanchor', tier.viewBook);
    open.add(settled);
    open.addValue('open-to-interactive', Math.max(...settled.map((m) => m.end)));
    // eslint-disable-next-line no-await-in-loop
    await closeView(page);
  }
  result.open = open.summary();

  // Switching back to the view book in a WebView that already holds the draft.
  const frame = await openView(page, projectId, tier.viewBook);
  await waitForMeasure(frame, 'reanchor', tier.viewBook);
  const heapLoaded = await heapUsed(page);
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
  const edits = new Samples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await editGloss(frame, run, `perf-${run}`);
    // eslint-disable-next-line no-await-in-loop
    await waitForMeasure(frame, 'dispatch-render');
    // eslint-disable-next-line no-await-in-loop
    const measures = await waitForMeasure(frame, 'autosave');
    edits.add(measures, ['dispatch-render', 'autosave-serialize', 'autosave']);
  }
  result.edit = edits.summary();

  for (let i = 0; i < UNDO_FILL_EDITS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await editGloss(frame, i % 20, `undo-${i}`);
  }
  await clearMeasures(frame);
  const heapWithUndo = await heapUsed(page);
  result.memory = {
    heapBeforeOpenBytes: heapBefore,
    viewLoadedBytes: heapLoaded - heapBefore,
    withFullUndoHistoryBytes: heapWithUndo - heapBefore,
  };

  // Picker: listing the source's saved projects.
  const picker = new Samples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await openProjectMenuItem(frame, /Select Interlinear Project/i);
    // eslint-disable-next-line no-await-in-loop
    picker.add(await waitForMeasure(frame, 'projects-fetch'), ['projects-fetch']);
    // eslint-disable-next-line no-await-in-loop
    await frame.getByRole('button', { name: 'Cancel' }).first().click();
  }
  result.picker = picker.summary();

  // Save: writing the draft's analysis to the project it was opened from.
  await clearMeasures(frame);
  await openProjectMenuItem(frame, /Select Interlinear Project/i);
  await frame
    .locator('[data-slot="dialog-content"] li > button', { hasText: `Perf ${tier.name} 1` })
    .first()
    .click();
  // Replacing an edited draft asks first; an unedited one opens straight away.
  await frame
    .getByTestId('discard-draft-confirm')
    .click({ timeout: 5_000 })
    .catch(() => {});
  await expect(frame.locator('[data-slot="dialog-content"]')).toHaveCount(0, { timeout: 60_000 });
  // Opening the project reseeds the store; a menu opened before that lands is dismissed by it.
  await waitForMeasure(frame, 'store-mount');
  const saves = new Samples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await clearMeasures(frame);
    // eslint-disable-next-line no-await-in-loop
    await openProjectMenuItem(frame, /^Save(?! As)/);
    // eslint-disable-next-line no-await-in-loop
    const measures = await waitForMeasure(frame, 'save');
    saves.add(measures, ['save']);
    const bytes = measures.find((m) => m.name === 'save')?.detail;
    if (bytes && typeof bytes === 'object' && 'bytes' in bytes && typeof bytes.bytes === 'number')
      saves.addValue('save-bytes', bytes.bytes);
  }
  result.save = saves.summary();

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

  return result;
}

test('measure the app', async ({ mainPage: page }) => {
  await waitForAppAndInterlinearizerReady(page, { cdp: true });
  const meta = readCaptureMeta();
  const projectId = await page.evaluate(async (name) => {
    const projects = await window.papi.projectLookup.getMetadataForAllProjects();
    return projects.find((project) => project.name === name)?.id;
  }, SOURCE_PROJECT_NAME);
  if (!projectId) throw new Error(`No ${SOURCE_PROJECT_NAME} project is installed`);

  const requested = (process.env.PERF_TIERS ?? '').split(',').filter(Boolean);
  const tiers = TIERS.filter((t) => requested.length === 0 || requested.includes(t.name));
  await closeView(page);
  await deleteLeftoverProjects(page, projectId);
  const originalDraft = await sendCommand(page, 'interlinearizer.getDraft', projectId);
  await page.evaluate((key) => localStorage.setItem(key, 'true'), PERF_MARKS_KEY);

  const createdProjects: string[] = [];
  const results: Record<string, unknown> = {};
  try {
    await tiers.reduce(async (previous, tier) => {
      await previous;
      try {
        results[tier.name] = await measureTier(page, projectId, tier, createdProjects);
      } catch (e) {
        results[tier.name] = { error: e instanceof Error ? e.message : String(e) };
      } finally {
        // Each tier's picker lists only the projects that tier seeded.
        await closeView(page);
        await Promise.all(
          createdProjects
            .splice(0)
            .map((id) => sendCommand(page, 'interlinearizer.deleteProject', id)),
        );
      }
      console.log(`${tier.name}: ${JSON.stringify(results[tier.name], undefined, 2)}`);
    }, Promise.resolve());
  } finally {
    await closeView(page);
    await page.evaluate((key) => localStorage.removeItem(key), PERF_MARKS_KEY);
    await sendCommand(page, 'interlinearizer.saveDraft', projectId, originalDraft);
  }

  const file = writeResults('app', {
    ...provenance(meta.coreCommit),
    host: page.url().startsWith('http://localhost') ? 'dev renderer' : 'packaged',
    extensionBuild:
      process.env.E2E_BUILD_SCRIPT === 'build:production' ? 'production' : 'development',
    runs: RUNS,
    tiers: results,
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
});
