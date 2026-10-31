import type { Browser, Frame, Page } from '@playwright/test';
import type { DraftProject } from 'interlinearizer';
import { execFileSync } from 'child_process';
import path from 'path';
import { readDraftJson, readManifest } from '../../../perf/dataset/store';
import { TIERS, type TierSpec } from '../../../perf/dataset/tiers';
import { provenance, writeResults } from '../../../perf/results';
import { addSavedProject, readDraft, writeDraft } from '../../../perf/storage';
import type { TextReadStatus } from '../../../src/types/text-read-status';
import { expect, test } from '../../fixtures/cdp.fixture';
import { waitForAppAndInterlinearizerReady } from '../../fixtures/helpers';
import {
  launchPackagedApp,
  OZONE_PLATFORM,
  PACKAGED_APP_PATH,
  stopPackagedApp,
  STORAGE_DIR,
} from '../../perf-app';
import { type HostHeap, readHostCpuMs } from './host-inspector';
import {
  clearMeasures,
  closeView,
  connect,
  HOST_CALLS,
  HOST_PATH_KEY,
  hostHeap,
  hostPid,
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

/** Whether host-path sessions open without reading the whole text, to isolate that read's cost. */
const SKIP_SESSION_READS = process.env.PERF_SKIP_SESSION_READS === 'true';

/** Edits made before reading the heap, enough to fill the undo history. */
const UNDO_FILL_EDITS = 100;

/** Book the book-switch scenario leaves for before returning, short so its load stays cheap. */
const AWAY_BOOK = 'JUD';

/** Names the saved projects a run seeds, so a later run can recognize them. */
const SAVED_PROJECT_NAME = /^Perf [a-z-]+ \d+$/;

/** How long each Scripture save gets to settle before the next step, its re-fetches included. */
const SAVE_SETTLE_MS = 3_000;

/** Tries at picking a menu item before a run gives up on it. */
const MENU_ATTEMPTS = 3;

/** The app a run drives; restarting a packaged app replaces its connection. */
type App = { page: Page; browser?: Browser };

const TOKEN_GLOSS_INPUT = 'input[aria-label^="Gloss for "]:not([aria-label^="Gloss for morpheme"])';

function tokenGlossInputs(frame: Frame) {
  return frame.locator(TOKEN_GLOSS_INPUT);
}

/**
 * Waits for `frame`'s first token gloss input to become editable.
 *
 * @returns When that input was first seen editable, in milliseconds since the epoch.
 */
async function editableAt(frame: Frame): Promise<number> {
  const handle = await frame.waitForFunction(
    (selector) => {
      const input = document.querySelector(selector);
      return (
        input instanceof HTMLInputElement &&
        !input.disabled &&
        !input.readOnly &&
        performance.timeOrigin + performance.now()
      );
    },
    TOKEN_GLOSS_INPUT,
    { polling: 'raf', timeout: 60_000 },
  );
  return Number(await handle.jsonValue());
}

/**
 * The view holding an edit or Save whose autosave has yet to be seen landing. Closing a view sends
 * its pending autosave, which could then land after the next tier's seed and overwrite it.
 */
let unsavedFrame: Frame | undefined;

/**
 * Glosses the `index`th visible word and commits it, as a reader moving on with Tab does. A view on
 * the host path passes `autosaves` false, because its session stores each edit itself.
 */
async function editGloss(
  frame: Frame,
  index: number,
  value: string,
  autosaves = true,
): Promise<void> {
  const input = tokenGlossInputs(frame).nth(index);
  await input.fill(value);
  await input.press('Tab');
  if (autosaves) unsavedFrame = frame;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

/** Waits for the view's autosave to land, and stops counting the view as unsaved. */
async function waitForAutosave(frame: Frame): Promise<Measure[]> {
  const measures = await waitForMeasure(frame, 'autosave');
  if (unsavedFrame === frame) unsavedFrame = undefined;
  return measures;
}

/**
 * Reads the host's whole-text read status for the source, starting the read when it has none.
 *
 * @returns The status, or `undefined` when the command answers with something other than a string.
 */
async function textReadStatus(page: Page, projectId: string): Promise<TextReadStatus | undefined> {
  const json = await sendCommand(page, 'interlinearizer.getTextReadStatus', projectId);
  return typeof json === 'string' ? JSON.parse(json) : undefined;
}

/**
 * Starts the host's read of the source's whole text, and waits until it has read every book.
 *
 * @throws If any book failed to read, since the read's timing would then leave it out.
 */
async function readWholeText(page: Page, projectId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const status = await textReadStatus(page, projectId);
        return status !== undefined && status.booksRead === status.bookCount;
      },
      { timeout: 300_000, intervals: [250] },
    )
    .toBe(true);
  expect((await textReadStatus(page, projectId))?.failedBookIds).toEqual([]);
}

const isNode = (value: unknown): value is { type?: unknown; content?: unknown } =>
  !!value && typeof value === 'object';

/**
 * Adds `word` to the first text after a verse marker in `content`, in place.
 *
 * @returns Whether it found such text.
 */
function addWordAfterVerse(content: unknown[], word: string, state = { inVerse: false }): boolean {
  return content.some((node, i) => {
    if (typeof node === 'string') {
      if (!state.inVerse || !node.trim()) return false;
      content[i] = `${node} ${word}`;
      return true;
    }
    if (!isNode(node)) return false;
    if (node.type === 'verse') state.inVerse = true;
    return Array.isArray(node.content) && addWordAfterVerse(node.content, word, state);
  });
}

/**
 * A copy of chapter `usj` with `word` added to its first verse's text.
 *
 * @throws If the chapter holds no verse text.
 */
function withWord(usj: unknown, word: string): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(usj));
  if (!isNode(copy) || !Array.isArray(copy.content) || !addWordAfterVerse(copy.content, word))
    throw new Error('The chapter holds no verse text to add a word to');
  return copy;
}

/** Makes the project's text editable; the sample WEB installs read-only. */
async function makeEditable(page: Page, projectId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const base = await window.papi.projectDataProviders.get('platform.base', id);
    await base.setSetting('platform.isEditable', true);
  }, projectId);
}

async function chapterUsj(page: Page, projectId: string, book: string): Promise<unknown> {
  return page.evaluate(
    async ([id, bookCode]) => {
      const pdp = await window.papi.projectDataProviders.get('platformScripture.USJ_Chapter', id);
      return pdp.getChapterUSJ({ book: bookCode, chapterNum: 1, verseNum: 1 });
    },
    [projectId, book] as const,
  );
}

/**
 * Saves `usj` as `book`'s first chapter, as the Scripture editor does.
 *
 * @returns Milliseconds until the save answered.
 */
async function saveChapter(
  page: Page,
  projectId: string,
  book: string,
  usj: unknown,
): Promise<number> {
  return page.evaluate(
    async ([id, bookCode, chapter]) => {
      const pdp = await window.papi.projectDataProviders.get('platformScripture.USJ_Chapter', id);
      const start = performance.now();
      // Resolves false when the text is unchanged; a failed save rejects.
      await pdp.setChapterUSJ({ book: bookCode, chapterNum: 1, verseNum: 1 }, chapter);
      return performance.now() - start;
    },
    [projectId, book, usj] as const,
  );
}

/**
 * Times saves of the first chapter of the view's book, each with a word added and followed at once
 * by a gloss commit. Restores the chapter after each run.
 *
 * Reads the extension host's CPU time over each save's settle period when given `cpuPid`. Waits for
 * each gloss's autosave when `autosaves` is set.
 */
async function measureScriptureSaves(
  page: Page,
  frame: Frame,
  projectId: string,
  book: string,
  cpuPid: number | undefined,
  autosaves: boolean,
): Promise<Record<string, unknown>> {
  const samples = new Samples();
  const original = await chapterUsj(page, projectId, book);
  try {
    for (let run = 0; run < RUNS; run += 1) {
      // eslint-disable-next-line no-await-in-loop
      await clearMeasures(frame);
      // eslint-disable-next-line no-await-in-loop
      const cpuBefore = cpuPid === undefined ? 0 : await readHostCpuMs(cpuPid);
      const startedAt = Date.now();
      samples.addValue(
        'scripture-save',
        // eslint-disable-next-line no-await-in-loop
        await saveChapter(page, projectId, book, withWord(original, `perfsave${run}`)),
      );
      // eslint-disable-next-line no-await-in-loop
      await editGloss(frame, run % 10, `save-${run}`, autosaves);
      // eslint-disable-next-line no-await-in-loop
      samples.add(await waitForMeasure(frame, 'gloss-render'), ['gloss-render']);
      // eslint-disable-next-line no-await-in-loop
      if (autosaves) await waitForAutosave(frame);
      // eslint-disable-next-line no-await-in-loop
      await sleep(SAVE_SETTLE_MS - (Date.now() - startedAt));
      if (cpuPid !== undefined)
        // eslint-disable-next-line no-await-in-loop
        samples.addValue('save-host-cpu', (await readHostCpuMs(cpuPid)) - cpuBefore);
      // eslint-disable-next-line no-await-in-loop
      await saveChapter(page, projectId, book, original);
      // eslint-disable-next-line no-await-in-loop
      await sleep(SAVE_SETTLE_MS);
    }
  } finally {
    await saveChapter(page, projectId, book, original);
  }
  return samples.summary();
}

/**
 * Times the host path: opening a view, edits once the session's whole-text read has finished, and
 * Scripture saves. With {@link SKIP_SESSION_READS}, sessions read no text, so nothing waits for it.
 * Writes its sections into `result`. Leaves no view open and the host-path flag off.
 */
async function measureHostPath(
  page: Page,
  projectId: string,
  tier: TierSpec,
  cpuPid: number | undefined,
  result: Record<string, unknown>,
): Promise<void> {
  await closeSettledView(page);
  try {
    await page.evaluate((key) => localStorage.setItem(key, 'true'), HOST_PATH_KEY);
    if (SKIP_SESSION_READS) await sendCommand(page, 'interlinearizer.setSkipSessionReads', true);
    // The view's pages queue behind the session-open read's passes, so no edit lands during them.
    const open = new Samples();
    for (let run = 0; run < RUNS; run += 1) {
      // eslint-disable-next-line no-await-in-loop
      await closeView(page);
      // eslint-disable-next-line no-await-in-loop
      const { frame, openedAt } = await openView(page, projectId, tier.viewBook);
      // eslint-disable-next-line no-await-in-loop
      open.addValue('open-to-editable', (await editableAt(frame)) - openedAt);
    }
    result.hostOpen = open.summary();

    await closeView(page);
    const { frame } = await openView(page, projectId, tier.viewBook);
    if (!SKIP_SESSION_READS) await readWholeText(page, projectId);
    const edits = new Samples();
    for (let run = 0; run < RUNS; run += 1) {
      // eslint-disable-next-line no-await-in-loop
      await clearMeasures(frame);
      // eslint-disable-next-line no-await-in-loop
      await editGloss(frame, run, `host-${run}`, false);
      // eslint-disable-next-line no-await-in-loop
      edits.add(await waitForMeasure(frame, 'gloss-render'), ['gloss-render']);
    }
    result.hostEdit = edits.summary();

    result.hostScriptureSave = await measureScriptureSaves(
      page,
      frame,
      projectId,
      tier.viewBook,
      cpuPid,
      false,
    );
  } finally {
    try {
      await closeView(page);
    } finally {
      await page.evaluate((key) => localStorage.removeItem(key), HOST_PATH_KEY);
      if (SKIP_SESSION_READS) await sendCommand(page, 'interlinearizer.setSkipSessionReads', false);
    }
  }
}

/** Waits for any autosave an edit or Save started to land. */
async function settleAutosave(): Promise<void> {
  if (unsavedFrame) await waitForAutosave(unsavedFrame);
}

/** Closes the open view once any autosave it owes has landed, so none lands after a later seed. */
async function closeSettledView(page: Page): Promise<void> {
  await settleAutosave();
  await closeView(page);
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
 * Restarts the packaged app and points `app` at the new instance, with no view open. Runs
 * `whileStopped` between the old instance exiting and the new one launching, outside the startup
 * time.
 *
 * @returns Milliseconds until the new instance was ready.
 */
async function restart(app: App, whileStopped?: () => Promise<void>): Promise<number> {
  await settleAutosave();
  await app.browser?.close();
  await stopPackagedApp();
  await whileStopped?.();
  const startupMs = await launchPackagedApp();
  Object.assign(app, await connect());
  // A view the layout restored would load before a timed open could.
  await closeView(app.page);
  await enableMarks(app.page);
  return startupMs;
}

/**
 * Stores the tier's draft and saved projects straight into the app's extension storage, adding each
 * project's id to `created` as it lands. A running app sees the draft from its next load of it, so
 * no view may be open and no autosave in flight.
 */
async function seedTier(
  projectId: string,
  tier: TierSpec,
  draftJson: string,
  created: string[],
): Promise<void> {
  const draft: DraftProject = { ...JSON.parse(draftJson), sourceProjectId: projectId };
  await writeDraft(STORAGE_DIR, draft);
  for (let i = 0; i < tier.savedProjects; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await addSavedProject(STORAGE_DIR, draft, `Perf ${tier.name} ${i + 1}`));
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

/**
 * Opens a fresh view on `book` and adds its load, the host's draft, book, outline and page fetches
 * included, to `open`.
 */
async function measureOpen(
  page: Page,
  projectId: string,
  book: string,
  open: ScenarioSamples,
): Promise<void> {
  await takeHostEntries(page);
  const { frame, openedAt } = await openView(page, projectId, book);
  const editable = editableAt(frame);
  await waitForMeasure(frame, 'book-render', book);
  const settled = await waitForMeasure(frame, 'reanchor', book);
  open.webView.add(settled);
  open.webView.addValue('open-to-editable', (await editable) - openedAt);
  const frameOrigin = await frame.evaluate(() => performance.timeOrigin);
  open.webView.addValue(
    'open-to-interactive',
    frameOrigin + Math.max(...settled.map((m) => m.end)) - openedAt,
  );
  const hostEntries = await takeHostEntries(page);
  open.addHostCall(HOST_CALLS.getDraft, hostEntries, settled);
  open.addHostCall(HOST_CALLS.getTokenizedBook, hostEntries, settled);
  open.addHostCall(HOST_CALLS.getBookOutline, hostEntries, settled);
  // The first pages load side by side, so each is sampled without a transport to pair it with.
  hostEntries
    .filter(({ name }) => name === 'getSegments')
    .forEach(({ duration }) => open.host.addValue('page-fetch', duration));
  const tokenizes = hostEntries.filter(({ name }) => name === 'getTokenizedBook:tokenize').length;
  if (tokenizes !== 1) console.warn(`Opening ${book} tokenized it ${tokenizes} times, not once`);
  await closeSettledView(page);
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
  const wire: Record<string, number> = { draft: draftWire };
  Object.assign(result, {
    viewBook: tier.viewBook,
    dataset: { counts: manifest.counts, bytes: manifest.bytes },
    wireBytes: wire,
  });
  if (draftWire > MAX_WEBSOCKET_PAYLOAD_BYTES) {
    result.skipped = `The draft is ${(draftWire / 1e6).toFixed(1)} MB on the wire, over the websocket's per-message cap; the app cannot load it.`;
    return;
  }

  const seed = () => seedTier(projectId, tier, draftJson, createdProjects);
  await closeSettledView(app.page);
  // A packaged app restarts before its first open below, so it is seeded while stopped.
  if (!PACKAGED_APP_PATH) await seed();

  // The first open after each app start.
  if (PACKAGED_APP_PATH) {
    const cold = scenarioSamples();
    for (let run = 0; run < RUNS; run += 1) {
      // eslint-disable-next-line no-await-in-loop
      cold.webView.addValue('app-startup', await restart(app, run === 0 ? seed : undefined));
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
  const { frame } = await openView(page, projectId, tier.viewBook);
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
      [
        'book-fetch',
        'book-parse',
        'outline-fetch',
        'outline-parse',
        'page-fetch',
        'page-parse',
        'reanchor',
        'book-render',
      ],
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
    const measures = await waitForAutosave(frame);
    edits.webView.add(measures, [
      'dispatch-render',
      'gloss-render',
      'autosave-serialize',
      'autosave',
    ]);
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
  await waitForAutosave(frame);
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
  const projectsJson = await sendCommand(page, 'interlinearizer.getProjectsForSource', projectId);
  if (typeof projectsJson !== 'string')
    throw new Error(`getProjectsForSource returned ${typeof projectsJson}, not a JSON string`);
  wire.projectsForSource = wireBytes(projectsJson);
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
    saves.webView.add(measures, ['save']);
    const bytes = detailBytes(measures, 'save');
    if (bytes !== undefined) saves.webView.addValue('save-bytes', bytes);
    // eslint-disable-next-line no-await-in-loop
    saves.addHostCall(HOST_CALLS.saveDraftToProject, await takeHostEntries(page), measures);
  }
  result.save = saves.summary();
  await recordMemory('afterSave');

  // Concordance: indexing every book of the source, in a fresh WebView each run since a WebView
  // keeps the index it built.
  const concordance = new Samples();
  for (let run = 0; run < RUNS; run += 1) {
    // eslint-disable-next-line no-await-in-loop
    await closeSettledView(page);
    // eslint-disable-next-line no-await-in-loop
    const { frame: view } = await openView(page, projectId, tier.viewBook);
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

  // Whole-text read in the host, in a fresh view each run, since the host keeps the read until
  // the view closes.
  const textRead = new Samples();
  for (let run = 0; run < RUNS; run += 1) {
    const isLast = run === RUNS - 1;
    // eslint-disable-next-line no-await-in-loop
    await closeSettledView(page);
    // eslint-disable-next-line no-await-in-loop
    const { frame: view } = await openView(page, projectId, tier.viewBook);
    // eslint-disable-next-line no-await-in-loop
    await waitForMeasure(view, 'reanchor', tier.viewBook);
    // eslint-disable-next-line no-await-in-loop
    if (isLast) await recordMemory('beforeTextRead');
    // eslint-disable-next-line no-await-in-loop
    await takeHostEntries(page);
    // eslint-disable-next-line no-await-in-loop
    await readWholeText(page, projectId);
    // eslint-disable-next-line no-await-in-loop
    const entries = await takeHostEntries(page);
    entries
      .filter(({ name }) => name === 'readText')
      .forEach(({ duration }) => textRead.addValue('text-read', duration));
    textRead.addValue(
      'text-read-tokenize',
      entries
        .filter(({ name }) => name === 'readText:tokenize')
        .reduce((total, { duration }) => total + duration, 0),
    );
    // eslint-disable-next-line no-await-in-loop
    if (isLast) await recordMemory('afterTextRead');
  }
  result.textRead = textRead.summary();

  // Scripture saves with no whole-text read running; closing the last view ended it.
  const cpuPid = hostBefore ? await hostPid(page) : undefined;
  await closeSettledView(page);
  const { frame: saveView } = await openView(page, projectId, tier.viewBook);
  await waitForMeasure(saveView, 'reanchor', tier.viewBook);
  result.scriptureSave = await measureScriptureSaves(
    page,
    saveView,
    projectId,
    tier.viewBook,
    cpuPid,
    true,
  );

  await measureHostPath(page, projectId, tier, cpuPid, result);
}

test('measure the app', async ({ mainPage }) => {
  const app: App = { page: mainPage };
  await waitForAppAndInterlinearizerReady(mainPage, { cdp: true });
  const projectId = await sourceProjectId(mainPage);
  await makeEditable(mainPage, projectId);

  const requested = (process.env.PERF_TIERS ?? '').split(',').filter(Boolean);
  const tiers = TIERS.filter((t) => requested.length === 0 || requested.includes(t.name));
  await closeSettledView(mainPage);
  await deleteLeftoverProjects(mainPage, projectId);
  const originalDraft = await readDraft(STORAGE_DIR, projectId);
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
        await closeSettledView(app.page);
        await Promise.all(
          createdProjects
            .splice(0)
            .map((id) => sendCommand(app.page, 'interlinearizer.deleteProject', id)),
        );
      }
      console.log(`${tier.name}: ${JSON.stringify(result, undefined, 2)}`);
    }, Promise.resolve());
  } finally {
    await closeSettledView(app.page);
    await app.page.evaluate((key) => localStorage.removeItem(key), PERF_MARKS_KEY);
    await setHostPerfMarks(app.page, false);
    await writeDraft(STORAGE_DIR, originalDraft);
  }

  const file = await writeResults('app', {
    // Assumes that the packaged app was built from this checkout.
    ...provenance(
      execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: path.resolve(__dirname, '../../../../paranext-core'),
      })
        .toString()
        .trim(),
    ),
    appBuild: app.page.url().startsWith('http://localhost') ? 'dev renderer' : 'packaged',
    ...(PACKAGED_APP_PATH && OZONE_PLATFORM ? { display: OZONE_PLATFORM } : {}),
    extensionBuild:
      process.env.E2E_BUILD_SCRIPT === 'build:production' ? 'production' : 'development',
    runs: RUNS,
    ...(SKIP_SESSION_READS ? { skipSessionReads: true } : {}),
    tiers: results,
  });
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
  await app.browser?.close();
  const failed = Object.entries(results).filter(([, result]) => 'error' in result);
  if (failed.length > 0)
    throw new Error(failed.map(([name, result]) => `${name}: ${String(result.error)}`).join('\n'));
});
