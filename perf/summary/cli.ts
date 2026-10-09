/* eslint-disable no-console -- a command-line tool reports to its terminal */
import fs from 'fs';
import path from 'path';
import { RESULTS_DIR } from '../paths';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object';

const isTiming = (value: unknown): value is { medianMs: number; p95Ms: number } =>
  isObject(value) && typeof value.medianMs === 'number' && typeof value.p95Ms === 'number';

/** Sections of a tier's results that describe its input rather than measure it. */
const DESCRIPTIVE = new Set(['viewBook', 'dataset', 'skipped', 'error']);

const isBytes = (name: string) => /bytes/i.test(name);

function formatMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return ms >= 100 ? `${Math.round(ms)}` : `${ms.toFixed(1)}`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** Every measured value of a tier, keyed by its dotted path. */
function cellsOf(tier: Json, prefix = ''): Map<string, string> {
  const cells = new Map<string, string>();
  Object.entries(tier).forEach(([key, value]) => {
    if (!prefix && DESCRIPTIVE.has(key)) return;
    const name = prefix + key;
    if (isTiming(value)) {
      cells.set(
        name,
        isBytes(name)
          ? formatBytes(value.medianMs)
          : `${formatMs(value.medianMs)} / ${formatMs(value.p95Ms)}`,
      );
    } else if (isObject(value)) {
      cellsOf(value, `${name}.`).forEach((cell, nested) => cells.set(nested, cell));
    } else if (typeof value === 'number') {
      cells.set(name, isBytes(name) ? formatBytes(value) : String(value));
    }
  });
  return cells;
}

function table(result: Json): string {
  const tiers = isObject(result.tiers) ? result.tiers : {};
  const names = Object.keys(tiers);
  const cells = names.map((name) => (isObject(tiers[name]) ? cellsOf(tiers[name]) : new Map()));
  const rows = [...new Set(cells.flatMap((c) => [...c.keys()]))];
  const machine = isObject(result.machine) ? result.machine : {};
  const load = Array.isArray(machine.loadAverage) ? machine.loadAverage[0] : undefined;
  const header = [
    `**${result.kind}** at \`${String(result.commit).slice(0, 8)}\`${result.dirty ? ' (dirty)' : ''}, core \`${String(result.coreCommit).slice(0, 8)}\``,
    `${machine.cpu}, ${machine.cores} threads, ${machine.memoryGb} GB, ${machine.os}, load ${typeof load === 'number' ? load.toFixed(1) : '?'}`,
    [
      result.host,
      result.display && `${result.display} display`,
      result.extensionBuild && `${result.extensionBuild} extension`,
      `${result.runs} runs`,
    ]
      .filter(Boolean)
      .join(', '),
  ].join('; ');
  const notes = names
    .map((name) => {
      const tier = tiers[name];
      if (!isObject(tier)) return undefined;
      if (typeof tier.skipped === 'string') return `${name} skipped: ${tier.skipped}`;
      if (typeof tier.error === 'string') return `${name} failed: ${tier.error}`;
      return undefined;
    })
    .filter(Boolean);
  return [
    header,
    '',
    `| Metric (median / p95 ms) | ${names.join(' | ')} |`,
    `| --- |${names.map(() => ' ---: |').join('')}`,
    ...rows.map((row) => `| ${row} | ${cells.map((c) => c.get(row) ?? '—').join(' | ')} |`),
    ...(notes.length ? ['', ...notes.map((note) => `- ${note}`)] : []),
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
