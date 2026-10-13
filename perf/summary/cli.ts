/* eslint-disable no-console -- a command-line tool reports to its terminal */
import fs from 'fs';
import path from 'path';
import { RESULTS_DIR } from '../paths';

type Json = Record<string, unknown>;

/** A tier's cells for one row: what the app or WebView measured, and what the extension host did. */
type Cells = { main?: string; host?: string };

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object';

const isTiming = (value: unknown): value is { medianMs: number; p90Ms: number } =>
  isObject(value) && typeof value.medianMs === 'number' && typeof value.p90Ms === 'number';

/** Sections of a tier's results that describe its input rather than measure it. */
const DESCRIPTIVE = new Set(['viewBook', 'dataset', 'skipped', 'error']);

/** Printed under every table measured on the generated datasets. */
const DATASET_NOTE =
  "The datasets gloss WEB's English, which has fewer word forms than a real project's language: about 2.8× the links per token payload of a real Paratext 9 import, so costs that scale with payload count, such as the pool index and catalog rows, read 2–3× low.";

const isBytes = (name: string) => /bytes/i.test(name);

function formatMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return ms >= 100 ? `${Math.round(ms)}` : `${ms.toFixed(1)}`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function formatValue(name: string, value: unknown): string | undefined {
  if (isTiming(value))
    return isBytes(name)
      ? formatBytes(value.medianMs)
      : `${formatMs(value.medianMs)} / ${formatMs(value.p90Ms)}`;
  if (typeof value === 'number') return isBytes(name) ? formatBytes(value) : String(value);
  return undefined;
}

/**
 * Every measured value of a tier, keyed by its dotted path. A section split into `webView` and
 * `host` puts each side's value for a metric in its own column of the same row.
 */
function cellsOf(tier: Json, prefix = ''): Map<string, Cells> {
  const cells = new Map<string, Cells>();
  const set = (name: string, side: keyof Cells, cell: string | undefined) => {
    if (cell !== undefined) cells.set(name, { ...cells.get(name), [side]: cell });
  };
  Object.entries(tier).forEach(([key, value]) => {
    if (!prefix && DESCRIPTIVE.has(key)) return;
    const name = prefix + key;
    if (isObject(value) && isObject(value.webView) && isObject(value.host)) {
      const { webView, host } = value;
      Object.entries(webView).forEach(([metric, v]) =>
        set(`${name}.${metric}`, 'main', formatValue(metric, v)),
      );
      Object.entries(host).forEach(([metric, v]) =>
        set(`${name}.${metric}`, 'host', formatValue(metric, v)),
      );
    } else if (isObject(value) && !isTiming(value)) {
      cellsOf(value, `${name}.`).forEach((cell, nested) => cells.set(nested, cell));
    } else {
      set(name, 'main', formatValue(name, value));
    }
  });
  return cells;
}

function notesOf(name: string, tier: Json): string[] {
  if (typeof tier.skipped === 'string') return [`${name} skipped: ${tier.skipped}`];
  const notes = typeof tier.error === 'string' ? [`${name} failed: ${tier.error}`] : [];
  if (isObject(tier.memory) && tier.memory.hostGcForced === false)
    notes.push(
      `${name}: host heap readings took the least of several, without a forced collection`,
    );
  return notes;
}

function table(result: Json): string {
  const tiers = isObject(result.tiers) ? result.tiers : {};
  const names = Object.keys(tiers);
  const cells = names.map((name) => (isObject(tiers[name]) ? cellsOf(tiers[name]) : new Map()));
  const rows = [...new Set(cells.flatMap((c) => [...c.keys()]))];
  const withHost = cells.some((c) => [...c.values()].some((cell) => cell.host !== undefined));
  const columns = names.flatMap((name, i) => [
    { label: name, cell: (row: string) => cells[i].get(row)?.main },
    ...(withHost
      ? [{ label: `${name} host`, cell: (row: string) => cells[i].get(row)?.host }]
      : []),
  ]);
  const machine = isObject(result.machine) ? result.machine : {};
  const load = Array.isArray(machine.loadAverage) ? machine.loadAverage[0] : undefined;
  const header = [
    `**${result.kind}** at \`${String(result.commit).slice(0, 8)}\`${result.dirty ? ' (dirty)' : ''}, core \`${String(result.coreCommit).slice(0, 8)}\``,
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
  const notes = names.flatMap((name) => (isObject(tiers[name]) ? notesOf(name, tiers[name]) : []));
  return [
    header,
    '',
    `| Metric (median / p90 ms) | ${columns.map(({ label }) => label).join(' | ')} |`,
    `| --- |${columns.map(() => ' ---: |').join('')}`,
    ...rows.map((row) => `| ${row} | ${columns.map(({ cell }) => cell(row) ?? '—').join(' | ')} |`),
    '',
    ...[...notes, DATASET_NOTE].map((note) => `- ${note}`),
  ].join('\n');
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
      .map((file) => table(JSON.parse(fs.readFileSync(file, 'utf-8'))))
      .join('\n\n'),
  );
}

main();
