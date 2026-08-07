/// <reference types="jest" />

import * as fs from 'node:fs';
import * as path from 'node:path';

import localizedStringsContribution from '../../contributions/localizedStrings.json';

/** Repo root, so the scan does not depend on Jest's working directory. */
const REPO_ROOT = path.resolve(__dirname, '../..');

/** Matches one localize key reference, e.g. `%interlinearizer_save%`. */
const KEY_PATTERN = /%interlinearizer_[A-Za-z0-9_]+%/g;

/** Extension sources, excluding tests (which may name keys that only the fixtures they build use). */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** Contribution files that reference keys rather than define them. */
function contributionFiles(): string[] {
  const dir = path.join(REPO_ROOT, 'contributions');
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name !== 'localizedStrings.json')
    .map((name) => path.join(dir, name));
}

describe('localizedStrings contribution', () => {
  // A key the extension names but the contribution omits is not a build or type error: PAPI renders
  // the raw `%…%` string to the user.
  it('defines every key the extension references', () => {
    const defined = new Set(Object.keys(localizedStringsContribution.localizedStrings.en));
    const undefinedKeys = [
      ...sourceFiles(path.join(REPO_ROOT, 'src')),
      ...contributionFiles(),
    ].flatMap((file) =>
      (fs.readFileSync(file, 'utf8').match(KEY_PATTERN) ?? [])
        .filter((key) => !defined.has(key))
        .map((key) => `${key} (${path.relative(REPO_ROOT, file)})`),
    );
    expect([...new Set(undefinedKeys)].sort()).toEqual([]);
  });
});
