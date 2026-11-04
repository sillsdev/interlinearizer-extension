/// <reference types="jest" />

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');

/** Status of each test in the console-guard fixtures, keyed by title, from one child Jest run. */
let statuses: Record<string, string>;
/** Status of each console-guard fixture file, keyed by file name. */
let fileStatuses: Record<string, string>;

beforeAll(() => {
  const run = spawnSync(
    process.execPath,
    [
      require.resolve('jest/bin/jest'),
      '--json',
      '--testMatch',
      '<rootDir>/src/__tests__/fixtures/console-guard*.fixture.ts',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  const report: {
    testResults: {
      name: string;
      status: string;
      assertionResults: { title: string; status: string }[];
    }[];
  } = JSON.parse(run.stdout);
  statuses = Object.fromEntries(
    report.testResults.flatMap((file) => file.assertionResults.map((t) => [t.title, t.status])),
  );
  fileStatuses = Object.fromEntries(
    report.testResults.map((file) => [path.basename(file.name), file.status]),
  );
}, 60_000);

it('fails a test that logs an unexpected console.error', () => {
  expect(statuses['logs an error']).toBe('failed');
});

it('fails a test that logs an unexpected console.warn', () => {
  expect(statuses['logs a warning']).toBe('failed');
});

it('passes a test that silences console.error with a spy', () => {
  expect(statuses['logs an expected error through a spy']).toBe('passed');
});

it("passes a test that logs Redux Toolkit's slow invariant check warning", () => {
  expect(statuses['logs a slow Redux invariant check']).toBe('passed');
});

it('fails a test that logs a console.error worded as the slow invariant check warning', () => {
  expect(statuses['logs an error worded as a slow Redux invariant check']).toBe('failed');
});

it('fails the test that is running when a late console.error lands', () => {
  expect(statuses['runs while a late error lands']).toBe('failed');
});

it('fails the file when a console.error lands after its last test', () => {
  expect(fileStatuses['console-guard-after-last-test.fixture.ts']).toBe('failed');
});

it('fails the test whose cleanup hook logs, not the test after it', () => {
  expect(statuses['logs from its cleanup']).toBe('failed');
});

it('passes the test after a cleanup hook that logged', () => {
  expect(statuses['runs after a cleanup that logged']).toBe('passed');
});

it('fails the file when its own afterAll logs', () => {
  expect(fileStatuses['console-guard-after-all.fixture.ts']).toBe('failed');
});

it('fails the file when loading it logs', () => {
  expect(fileStatuses['console-guard-module-scope.fixture.ts']).toBe('failed');
});

it('passes the tests of a file whose loading logged', () => {
  expect(statuses['runs first after a module-scope log']).toBe('passed');
  expect(statuses['runs second after a module-scope log']).toBe('passed');
});

it('finishes a file that leaves fake timers on', () => {
  expect(fileStatuses['console-guard-fake-timers.fixture.ts']).toBe('passed');
});
