/// <reference types="jest" />

import * as fs from 'node:fs';
import * as path from 'node:path';

import localizedStringsContribution from '../../contributions/localizedStrings.json';

/** Repo root, so the scan does not depend on Jest's working directory. */
const REPO_ROOT = path.resolve(__dirname, '../..');

/** Matches one localize key reference, e.g. `%interlinearizer_save%`. */
const KEY_PATTERN = /%interlinearizer_[A-Za-z0-9_]+%/g;

/**
 * Directories holding no key references: build output, dependencies, and tests and their mocks —
 * which may name keys that only the fixtures they build use. Dot-directories (tooling and editor
 * config) are skipped by the same rule.
 */
const SKIPPED_DIRS = new Set([
  '__mocks__',
  '__tests__',
  'coverage',
  'dist',
  'e2e-tests',
  'node_modules',
  'release',
  'temp-build',
]);

/** The contribution that defines the keys, rather than referencing them. */
const CONTRIBUTION_PATH = path.join(REPO_ROOT, 'contributions', 'localizedStrings.json');

/**
 * Every file that can name a key: sources, and the manifest and contribution files PAPI reads keys
 * out of. Scanning from the repo root rather than a fixed list means a key in a file type that does
 * not exist yet is still caught.
 */
function referencingFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('.')) return [];
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : referencingFiles(full);
    if (full === CONTRIBUTION_PATH) return [];
    return /\.(json|tsx?)$/.test(entry.name) ? [full] : [];
  });
}

describe('localizedStrings contribution', () => {
  // A key the extension names but the contribution omits is not a build or type error: PAPI renders
  // the raw `%…%` string to the user.
  it('defines every key the extension references', () => {
    const defined = new Set(Object.keys(localizedStringsContribution.localizedStrings.en));
    const undefinedKeys = referencingFiles(REPO_ROOT).flatMap((file) =>
      (fs.readFileSync(file, 'utf8').match(KEY_PATTERN) ?? [])
        .filter((key) => !defined.has(key))
        .map((key) => `${key} (${path.relative(REPO_ROOT, file)})`),
    );
    expect([...new Set(undefinedKeys)].sort()).toEqual([]);
  });
});
