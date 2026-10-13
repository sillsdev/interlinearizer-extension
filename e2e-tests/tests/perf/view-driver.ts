import { chromium, type Browser, type Frame, type Page } from '@playwright/test';
import { summarize, type Timing } from '../../../perf/bench/measure';
import { SOURCE_PROJECT_NAME } from '../../../perf/paths';
import { expect } from '../../fixtures/cdp.fixture';
import { CDP_PORT } from '../../global-setup-cdp';
import { type HostHeap, readHostHeap } from './host-inspector';

/** Paranext-core's cap on one websocket message, which every command argument and result crosses. */
export const MAX_WEBSOCKET_PAYLOAD_BYTES = 100 * 1024 * 1024;

/** Storage key that asks the WebView for timing entries. */
export const PERF_MARKS_KEY = 'interlinearizer.perfMarks';

export const VIEW_TAB = /^Interlinearizer: WEB/;

export type Measure = { name: string; duration: number; end: number; detail: unknown };

/** A duration the extension host recorded, named without its prefix. */
export type HostEntry = { name: string; duration: number };

/**
 * A host command a WebView measure times end to end, and the storage functions whose phases run
 * within it.
 */
export type HostCall = { measure: string; command: string; phasePrefixes: string[] };

/** The host commands the scenarios time. */
export const HOST_CALLS = {
  getDraft: { measure: 'draft-fetch', command: 'getDraft', phasePrefixes: ['getDraft'] },
  saveDraft: { measure: 'autosave', command: 'saveDraft', phasePrefixes: ['saveDraft'] },
  getProjectsForSource: {
    measure: 'projects-fetch',
    command: 'getProjectsForSource',
    phasePrefixes: ['getProjectsForSource', 'listProjects'],
  },
  saveAnalysis: {
    measure: 'save',
    command: 'saveAnalysis',
    phasePrefixes: ['saveAnalysis', 'updateAnalysis'],
  },
} satisfies Record<string, HostCall>;

/** Collected durations per measure name, summarized once a scenario's runs are done. */
export class Samples {
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

/** One scenario's samples, from the WebView and from the extension host. */
export function scenarioSamples() {
  const webView = new Samples();
  const host = new Samples();
  return {
    webView,
    host,
    /**
     * Adds the host's time for `call`, named for the WebView measure it serves, with each phase
     * summed and the transport the WebView saw beyond it. Adds nothing when the host did not run
     * `call` exactly once, since its phases could not then be told apart.
     */
    addHostCall(call: HostCall, entries: HostEntry[], measures: Measure[]): void {
      const totals = entries.filter(({ name }) => name === call.command);
      if (totals.length !== 1) {
        console.warn(`Expected one host ${call.command} call, saw ${totals.length}; not sampled`);
        return;
      }
      const [{ duration: hostMs }] = totals;
      host.addValue(call.measure, hostMs);
      const phases = new Map<string, number>();
      entries.forEach(({ name, duration }) => {
        const [prefix, phase] = name.split(':');
        if (phase && call.phasePrefixes.includes(prefix))
          phases.set(phase, (phases.get(phase) ?? 0) + duration);
      });
      phases.forEach((ms, phase) => host.addValue(`${call.measure}:${phase}`, ms));
      const seen = measures.find(({ name }) => name === call.measure);
      if (seen) webView.addValue(`${call.measure}:transport`, seen.duration - hostMs);
    },
    summary() {
      return { webView: webView.summary(), host: host.summary() };
    },
  };
}

export type ScenarioSamples = ReturnType<typeof scenarioSamples>;

/** Size of `json` once it is embedded as a string in a JSON-RPC message. */
export function wireBytes(json: string): number {
  return Buffer.byteLength(JSON.stringify(json));
}

export async function sendCommand(
  page: Page,
  command: string,
  ...args: unknown[]
): Promise<unknown> {
  return page.evaluate(([name, params]) => window.papi.commands.sendCommand(name, ...params), [
    command,
    args,
  ] as const);
}

export async function setBook(page: Page, book: string): Promise<void> {
  await page.evaluate(
    (bookCode) =>
      window.papi.scrollGroups.setScrRef(0, { book: bookCode, chapterNum: 1, verseNum: 1 }),
    book,
  );
}

/** The open WebView's frame, waiting for it to appear. */
export async function viewFrame(page: Page): Promise<Frame> {
  const iframe = page.locator('iframe[title^="Interlinearizer: WEB"]').first();
  await expect(iframe).toBeAttached({ timeout: 60_000 });
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error('The Interlinearizer WebView has no frame');
  return frame;
}

export async function openView(page: Page, projectId: string, book: string): Promise<Frame> {
  await setBook(page, book);
  await page.evaluate(
    (id) =>
      window.papi.webViews.openWebView('interlinearizer.mainWebView', undefined, { projectId: id }),
    projectId,
  );
  return viewFrame(page);
}

export async function closeView(page: Page): Promise<void> {
  const tab = page.locator('.dock-tab', { hasText: VIEW_TAB });
  if ((await tab.count()) === 0) return;
  await tab.first().locator('.dock-tab-close-btn').dispatchEvent('click');
  await expect(tab).toHaveCount(0, { timeout: 30_000 });
}

/** Every timing entry the WebView has recorded, with its end relative to the frame's start. */
export async function readMeasures(frame: Frame): Promise<Measure[]> {
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

export async function clearMeasures(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });
}

/**
 * Waits until the WebView has recorded `name`, for `book` when given, and returns every entry. Only
 * entries recorded since the last {@link clearMeasures} count.
 */
export async function waitForMeasure(
  frame: Frame,
  name: string,
  book?: string,
): Promise<Measure[]> {
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
export async function heapUsed(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('HeapProfiler.collectGarbage');
    const { usedSize } = await session.send('Runtime.getHeapUsage');
    return usedSize;
  } finally {
    await session.detach();
  }
}

/** Turns the extension host's timing entries on or off. */
export async function setHostPerfMarks(page: Page, on: boolean): Promise<void> {
  await sendCommand(page, 'interlinearizer.setPerfMarks', on);
}

async function readHost(page: Page): Promise<{ entries: HostEntry[]; pid: number }> {
  const json = await sendCommand(page, 'interlinearizer.readPerf');
  if (typeof json !== 'string') throw new Error("The host's timing entries are off");
  return JSON.parse(json);
}

/** Every duration the host recorded since the last call, which clears them. */
export async function takeHostEntries(page: Page): Promise<HostEntry[]> {
  return (await readHost(page)).entries;
}

/**
 * The extension host's memory after a full garbage collection. Clears the host's timing entries.
 *
 * @throws If the host's inspector cannot be opened to force the collection.
 */
export async function hostHeap(page: Page): Promise<HostHeap> {
  return readHostHeap((await readHost(page)).pid);
}

/** The bundled sample project's id, waiting out its install on a profile's first launch. */
export async function sourceProjectId(page: Page): Promise<string> {
  // Polled from here: `waitForFunction` takes an async predicate's pending promise as truthy.
  const lookUp = () =>
    page.evaluate(async (name) => {
      const projects = await window.papi.projectLookup.getMetadataForAllProjects();
      return projects.find((project) => project.name === name)?.id;
    }, SOURCE_PROJECT_NAME);
  await expect
    .poll(lookUp, {
      message: `No ${SOURCE_PROJECT_NAME} project is installed`,
      timeout: 120_000,
      intervals: [1_000],
    })
    .toEqual(expect.any(String));
  const projectId = await lookUp();
  if (projectId === undefined) throw new Error(`The ${SOURCE_PROJECT_NAME} project went away`);
  return projectId;
}

/** Connects to the running app's renderer over CDP. */
export async function connect(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`, {
    timeout: 30_000,
  });
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((p) => !p.url().startsWith('devtools://'));
  if (!page) throw new Error('No renderer page found via CDP');
  return { browser, page };
}
