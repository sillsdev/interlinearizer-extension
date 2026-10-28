/* eslint-disable no-console -- a command-line tool reports to its terminal */
import fs from 'fs';
import path from 'path';
import { RESULTS_DIR } from '../paths';

type Json = Record<string, unknown>;

/** A section's rows, each named and holding one cell per tier. */
type Rows = Map<string, Map<string, string>>;

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object';

const isTiming = (value: unknown): value is { medianMs: number; p90Ms: number } =>
  isObject(value) && typeof value.medianMs === 'number' && typeof value.p90Ms === 'number';

/** Sections of a tier's results that describe its input rather than measure it. */
const DESCRIPTIVE = new Set(['viewBook', 'dataset', 'skipped', 'error']);

/** Printed ahead of every result measured on the generated datasets. */
const DATASET_NOTE =
  "The datasets gloss WEB's English, which has fewer word forms than a real project's language: about 2.8× the links per token payload of a real Paratext 9 import, so costs that scale with payload count, such as the pool index and catalog rows, read 2–3× low.";

/** Explains the rows under a call, printed ahead of any report that has them. */
const HOST_NOTE =
  "A call's own row is how long the WebView waited for it. Below it, `↳ host` is the part of that wait the extension host spent working, broken into steps by the `↳ host:` rows, and `↳ transport` is the rest, spent passing the request and reply between the two processes.";

/** Headings for each kind of result. */
const KIND_TITLES: Record<string, string> = {
  app: 'In the app (`perf:app`)',
  bench: 'Data layer in Node (`perf:bench`)',
};

/** What each kind of result measures, printed ahead of its tables. */
const KIND_INTROS: Record<string, string> = {
  app: 'The extension timed in the running app, driven as a user would drive it.',
  bench: "The data layer's functions timed directly in Node, without the app.",
};

/** What each section's scenario does, keyed by result kind and section path. */
const SECTION_DESCRIPTIONS: Record<string, string> = {
  'app.wireBytes':
    'The size of each payload the WebView receives as one websocket message. A tier whose draft is over the per-message cap cannot load in the app.',
  'app.memory':
    'Heap in use before the view opens, then how far it has grown at each later point. The host heap belongs to the whole platform, not just this extension.',
  'app.cold': "The packaged app restarts before each run, then the view opens on the tier's book.",
  'app.open':
    "A new view opens on the tier's book in an app that is already running. Some steps run at the same time, so they do not add up to the total.",
  'app.switchBook':
    "With the view open, the book changes to Jude and back; the times are for the return. Book change to rendered includes fetching the book's text.",
  'app.edit': 'One gloss typed and committed with Tab, then the autosave that commit sets off.',
  'app.picker':
    'The Select Interlinear Project dialog opens, listing every saved project for the source.',
  'app.save': 'Save from the Project menu writes the analysis to the project it came from.',
  'app.concordance':
    "The concordance opens in a fresh view, which reads and indexes every book of the source and re-anchors the draft to each book it analyzes beyond the open one. Only large-loadable's draft spans more than the open book, so only its read includes re-anchoring.",
  'bench.timings.load': 'The steps of opening the view on a book.',
  'bench.timings.storage':
    'Splitting the draft into per-book shards to store it, and merging them back.',
  'bench.timings.edit':
    "Committing one gloss to the store and rerunning the view's selectors, then serializing the draft to save it.",
  'bench.timings.concordance':
    'Indexing every book of the source and deriving the concordance rows.',
  'bench.timings.text':
    "Filing every book's word forms in the host's form index, the books already tokenized.",
  'bench.timings.apply':
    "One edit applied through the host's draft repository, with its draft loaded and indexed and its storage in memory, the writes to storage included.",
  'bench.formsNotInText':
    "How many of the catalog's forms the text lacks, by the WebView's whole-text read and by the host's form index, and how many forms the two disagree on.",
  'app.textRead':
    "With a view open, the host reads every book of the source and files its word forms, from the first `getTextReadStatus` until it reports every book read. Tokenizing is summed over the books, which are read a few at a time. The host heap with the whole text read includes each book's USJ, which the platform keeps for every book subscription.",
  'bench.memory': 'Heap held by the parsed draft, and by an undo history filled to its limit.',
};

/** The memory reading every other one in its section is taken against. */
const MEMORY_BASELINE = 'heapBeforeOpenBytes';

/** Headings for a result's sections, keyed by dotted path; an unlisted section shows its path. */
const SECTION_LABELS: Record<string, string> = {
  wireBytes: 'Sent over the websocket',
  memory: 'Memory',
  cold: 'First open after the app starts',
  open: 'Open the view in a running app',
  switchBook: 'Switch away and back to the book',
  edit: 'Edit one gloss',
  picker: 'List saved projects in the picker',
  save: 'Save the analysis to its project',
  concordance: 'Open the concordance',
  textRead: 'Read the whole text in the host',
  formsNotInText: 'Catalog forms not in the text',
  'timings.load': 'Load',
  'timings.storage': 'Storage',
  'timings.edit': 'Edit one gloss',
  'timings.concordance': 'Concordance',
  'timings.text': 'Form-in-text index',
  'timings.apply': 'Apply one edit in the host',
};

/** Names for measured values, by their key; an unlisted value shows its key. */
const METRIC_LABELS: Record<string, string> = {
  draft: 'Draft',
  projectsForSource: 'Saved projects list',
  'app-startup': 'App startup',
  'usj-fetch': 'Fetch book text',
  tokenize: 'Tokenize book',
  'book-fetch': 'Fetch tokenized book',
  'book-parse': 'Parse tokenized book',
  'outline-fetch': 'Fetch book outline',
  'outline-parse': 'Parse book outline',
  'page-fetch': 'Fetch a page of segments',
  'page-parse': 'Parse a page of segments',
  'book-render': 'Book change to rendered',
  'draft-fetch': 'Fetch draft',
  'draft-parse': 'Parse draft',
  'store-mount': 'Mount analysis store',
  reanchor: 'Reanchor analysis to book',
  'open-to-interactive': 'Total: open to settled',
  'dispatch-render': 'Commit gloss to re-render',
  'autosave-serialize': 'Serialize draft',
  autosave: 'Autosave',
  'projects-fetch': 'Fetch saved projects',
  save: 'Save',
  'save-bytes': 'Request sent',
  'concordance-read': 'Read every book',
  'concordance-entries': 'Build entries',
  'text-read': 'Read every book',
  'text-read-tokenize': 'Tokenize every book, summed',
  formIndex: "Index every book's forms",
  byWebViewRead: "By the WebView's read",
  byHostIndex: "By the host's index",
  disagreeing: 'Disagreeing',
  parseDraft: 'Parse draft',
  storeMount: 'Mount analysis store',
  readShards: 'Parse and merge shards',
  writeShards: 'Split and serialize shards',
  dispatch: 'Commit gloss and reselect',
  link: "Change one link's status",
  widePayload: 'Edit the most-linked payload',
  serializeDraft: 'Serialize draft',
  build: 'Build entries and rows',
  parsedDraftBytes: 'Parsed draft',
  undoHistoryBytes: 'Full undo history',
};

/** Names for the steps a host call is split into. */
const PHASE_LABELS: Record<string, string> = {
  read: 'read storage',
  usj: 'fetch USJ',
  tokenize: 'extract and tokenize',
  resegment: 'segment by boundaries',
  parse: 'parse and validate',
  compare: 'split and compare shards',
  serialize: 'serialize reply',
  write: 'write storage',
};

/** When the app's memory readings were taken, by the prefix of their key. */
const MEMORY_POINTS: Record<string, string> = {
  viewLoaded: 'view loaded',
  withFullUndoHistory: 'full undo history',
  afterPicker: 'after picker',
  afterSave: 'after save',
  beforeTextRead: 'before the whole-text read',
  afterTextRead: 'with the whole text read',
};

const isBytes = (name: string) => /bytes/i.test(name);

const formatNumber = (n: number) => (n >= 100 ? `${Math.round(n)}` : n.toFixed(1));

/** A median and p90 in one shared unit, seconds for long timings. */
function formatTiming(medianMs: number, p90Ms: number): string {
  if (p90Ms >= 10_000) return `${formatNumber(medianMs / 1000)} / ${formatNumber(p90Ms / 1000)} s`;
  return `${formatNumber(medianMs)} / ${formatNumber(p90Ms)} ms`;
}

/** Megabytes, signed when `bytes` is a change rather than a total. */
function formatBytes(bytes: number, isChange = false): string {
  const sign = isChange && bytes >= 0 ? '+' : '';
  return `${sign}${(bytes / 1e6).toFixed(1)} MB`;
}

function formatValue(name: string, value: unknown, isChange = false): string | undefined {
  if (isTiming(value))
    return isBytes(name) ? formatBytes(value.medianMs) : formatTiming(value.medianMs, value.p90Ms);
  if (typeof value === 'number')
    return isBytes(name) ? formatBytes(value, isChange) : String(value);
  return undefined;
}

const metricLabel = (key: string) => METRIC_LABELS[key] ?? key;

/**
 * Rows for a section measured on both sides of the websocket: each WebView call, then its
 * transport, then the host's share and that share's steps.
 */
function callRows(webView: Json, host: Json): [string, string | undefined][] {
  const calls = [...Object.keys(webView), ...Object.keys(host)].filter((key) => !key.includes(':'));
  return [...new Set(calls)].flatMap((call): [string, string | undefined][] => {
    const steps = Object.entries(host)
      .filter(([key]) => key.startsWith(`${call}:`))
      .map(([key, value]): [string, string | undefined] => {
        const step = key.slice(call.length + 1);
        return [`↳ host: ${PHASE_LABELS[step] ?? step}`, formatValue(key, value)];
      });
    if (!(call in webView)) return [[`Host: ${metricLabel(call)}`, formatValue(call, host[call])]];
    return [
      [metricLabel(call), formatValue(call, webView[call])],
      ['↳ transport', formatValue(call, webView[`${call}:transport`])],
      ['↳ host', formatValue(call, host[call])],
      ...steps,
    ];
  });
}

/**
 * Rows for the app's heap readings, the WebView's then the host's: each side's heap before the view
 * opens, then its change from that at each later point.
 */
function memoryRows(webView: Json, host: Json): [string, string | undefined][] {
  const sides: [string, Json][] = [
    ['WebView', webView],
    ['Host', host],
  ];
  return sides.flatMap(([side, readings]) =>
    Object.entries(readings).flatMap(([key, value]): [string, string | undefined][] => {
      if (key === MEMORY_BASELINE)
        return [[`${side} heap before opening`, formatValue(key, value)]];
      const point = MEMORY_POINTS[key.replace(/Bytes$/, '')];
      return point ? [[`${side} heap change, ${point}`, formatValue(key, value, true)]] : [];
    }),
  );
}

/** Adds every measured value of a tier to `sections`, under the section its dotted path names. */
function addTier(sections: Map<string, Rows>, tierName: string, tier: Json, prefix = ''): void {
  const add = (section: string, label: string, cell: string | undefined) => {
    if (cell === undefined) return;
    if (!sections.has(section)) sections.set(section, new Map());
    const rows = sections.get(section);
    if (!rows?.has(label)) rows?.set(label, new Map());
    rows?.get(label)?.set(tierName, cell);
  };
  Object.entries(tier).forEach(([key, value]) => {
    if (!prefix && DESCRIPTIVE.has(key)) return;
    const name = prefix + key;
    if (isObject(value) && isObject(value.webView) && isObject(value.host)) {
      const rows =
        key === 'memory'
          ? memoryRows(value.webView, value.host)
          : callRows(value.webView, value.host);
      rows.forEach(([label, cell]) => add(name, label, cell));
    } else if (isObject(value) && !isTiming(value)) {
      addTier(sections, tierName, value, `${name}.`);
    } else {
      // A key may itself be dotted, so the section is everything before the full path's last dot.
      const split = name.lastIndexOf('.');
      add(
        name.slice(0, Math.max(split, 0)),
        metricLabel(name.slice(split + 1)),
        formatValue(name, value),
      );
    }
  });
}

/** Tier names joined for a sentence: `a`, `a and b`, `a, b and c`. */
function listOf(names: string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names.join('');
}

/** A paragraph for each tier the run skipped or that failed partway. */
function tierProblems(tiers: Json): string[] {
  return Object.entries(tiers).flatMap(([name, tier]) => {
    if (!isObject(tier)) return [];
    if (typeof tier.skipped === 'string') return [`**${name}** was skipped: ${tier.skipped}`];
    return typeof tier.error === 'string' ? [`**${name}** failed partway: ${tier.error}`] : [];
  });
}

/** Says, ahead of the memory table, which tiers have no host heap readings and why. */
function memoryCaveat(tiers: Json): string | undefined {
  const skipped = Object.entries(tiers).flatMap(([name, tier]) =>
    isObject(tier) && isObject(tier.memory) && typeof tier.memory.hostSkipped === 'string'
      ? [{ name, reason: tier.memory.hostSkipped }]
      : [],
  );
  if (!skipped.length) return undefined;
  return `No host heap for ${listOf(skipped.map(({ name }) => name))}: ${skipped[0].reason}`;
}

function report(result: Json): string {
  const kind = String(result.kind);
  const tiers = isObject(result.tiers) ? result.tiers : {};
  const sections = new Map<string, Rows>();
  Object.entries(tiers).forEach(([name, tier]) => {
    if (isObject(tier)) addTier(sections, name, tier);
  });
  const allRows = [...sections.values()].flatMap((rows) => [...rows.values()]);
  const columns = Object.keys(tiers).filter((name) => allRows.some((row) => row.has(name)));
  const withHost = [...sections.values()].some((rows) => rows.has('↳ host'));
  const machine = isObject(result.machine) ? result.machine : {};
  const load = Array.isArray(machine.loadAverage) ? machine.loadAverage[0] : undefined;
  const header = [
    `Measured at \`${String(result.commit).slice(0, 8)}\`${result.dirty ? ' (dirty)' : ''}, core \`${String(result.coreCommit).slice(0, 8)}\``,
    `${machine.cpu}, ${machine.cores} threads, ${machine.memoryGb} GB, ${machine.os}, load ${typeof load === 'number' ? load.toFixed(1) : '?'}`,
    [
      result.appBuild,
      result.display && `${result.display} display`,
      result.extensionBuild && `${result.extensionBuild} extension`,
      `${result.runs} runs`,
    ]
      .filter(Boolean)
      .join(', '),
  ].join('; ');
  const intro = [
    KIND_INTROS[kind],
    `Each column is a dataset tier. Timings read median / p90 over the ${result.runs} runs.`,
    ...(withHost ? [HOST_NOTE] : []),
    DATASET_NOTE,
    ...tierProblems(tiers),
  ].filter(Boolean);
  const tables = [...sections].map(([section, rows]) => {
    const caveat = kind === 'app' && section === 'memory' ? memoryCaveat(tiers) : undefined;
    const description = [SECTION_DESCRIPTIONS[`${kind}.${section}`], caveat]
      .filter(Boolean)
      .join(' ');
    return [
      `### ${SECTION_LABELS[section] ?? (section || 'Other')}`,
      ...(description ? ['', description] : []),
      '',
      `| | ${columns.join(' | ')} |`,
      `| --- |${columns.map(() => ' ---: |').join('')}`,
      ...[...rows].map(
        ([label, cells]) =>
          `| ${label} | ${columns.map((name) => cells.get(name) ?? '—').join(' | ')} |`,
      ),
    ].join('\n');
  });
  return [`## ${KIND_TITLES[kind] ?? kind}`, header, ...intro, ...tables].join('\n\n');
}

/** The newest result file of each kind, or the files named on the command line. */
function resultFiles(): string[] {
  const named = process.argv.slice(2);
  if (named.length) return named;
  if (!fs.existsSync(RESULTS_DIR)) throw new Error(`No results in ${RESULTS_DIR}`);
  const newest = new Map<string, { file: string; recordedAt: string }>();
  fs.readdirSync(RESULTS_DIR)
    .filter((file) => file.endsWith('.json'))
    .forEach((file) => {
      const full = path.join(RESULTS_DIR, file);
      const { kind, recordedAt } = JSON.parse(fs.readFileSync(full, 'utf-8'));
      const current = newest.get(kind);
      if (!current || recordedAt > current.recordedAt) newest.set(kind, { file: full, recordedAt });
    });
  return [...newest.values()].map(({ file }) => file);
}

function main(): void {
  console.log(
    resultFiles()
      .map((file) => report(JSON.parse(fs.readFileSync(file, 'utf-8'))))
      .join('\n\n'),
  );
}

main();
