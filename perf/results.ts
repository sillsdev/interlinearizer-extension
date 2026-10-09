import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RESULTS_DIR } from './paths';

/** What every result file records about where and on what code it was measured. */
export function provenance(coreCommit: string) {
  const cpus = os.cpus();
  return {
    commit: execSync('git rev-parse HEAD').toString().trim(),
    dirty: execSync('git status --porcelain').toString().trim().length > 0,
    coreCommit,
    recordedAt: new Date().toISOString(),
    machine: {
      cpu: cpus[0]?.model,
      cores: cpus.length,
      memoryGb: Math.round(os.totalmem() / 1e9),
      os: `${os.type()} ${os.release()}`,
      node: process.version,
      loadAverage: os.loadavg(),
    },
  };
}

/** Writes a result file named for its kind, date, and commit, returning its path. */
export function writeResults<T extends { recordedAt: string; commit: string }>(
  kind: string,
  results: T,
): string {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(
    RESULTS_DIR,
    `${kind}-${results.recordedAt.slice(0, 10)}-${results.commit.slice(0, 8)}.json`,
  );
  fs.writeFileSync(file, `${JSON.stringify({ kind, ...results }, undefined, 2)}\n`);
  return file;
}
