/**
 * Detects coverage overlap redundancies by running each test suite in isolation and reporting which
 * suites cover functions or branches in source files outside their primary scope.
 *
 * Exit code 1 if any suite covers functions or branches in an out-of-scope source file.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globSync } from 'glob';

const rootDir = path.resolve(__dirname, '..');

/** V8 coverage data for a single source file as written by Jest's coverage-final.json. */
interface FileCoverage {
  path: string;
  /** Istanbul statement hit counts, keyed by statement id. */
  s: Record<string, number>;
  /** Istanbul branch hit counts, keyed by branch id; each value is an array of per-path counts. */
  b: Record<string, number[]>;
  /** Istanbul function hit counts, keyed by function id. */
  f: Record<string, number>;
  statementMap: Record<string, unknown>;
  branchMap: Record<string, unknown>;
  fnMap: Record<string, unknown>;
}

/** Coverage hits for a single out-of-scope file. */
interface OutOfScopeHit {
  file: string;
  fnHit: number;
  fnTotal: number;
  branchHit: number;
  branchTotal: number;
}

/** Result for one test suite run. */
interface SuiteResult {
  testFile: string;
  primarySourceFile: string;
  outOfScopeHits: OutOfScopeHit[];
  elapsedMs: number;
  error?: string;
}

/**
 * Derives the primary source file path from a test file path by stripping the `__tests__/` segment
 * and the `.test.` infix.
 *
 * Assumes a strict 1:1 test-to-source mapping with a mirrored directory structure
 * (`src/__tests__/foo.test.ts` → `src/foo.ts`). Test files that cover multiple source files, use a
 * non-standard naming convention, or don't mirror `src/` will derive a nonexistent primary source
 * file, causing all their coverage to be flagged as out-of-scope.
 *
 * @param testFile - Absolute path to a test file.
 * @returns Absolute path to the expected primary source file.
 */
function deriveSourcePath(testFile: string): string {
  const relative = path.relative(rootDir, testFile);
  const withoutTests = relative.replace(/src\/__tests__\//, 'src/');
  const withoutInfix = withoutTests.replace(/\.test\.(tsx?)$/, '.$1');
  return path.resolve(rootDir, withoutInfix);
}

/**
 * Counts the number of entries in a record whose value is greater than zero.
 *
 * @param counts - Map of id to hit count.
 * @returns Number of entries with a non-zero count.
 */
function countNonZero(counts: Record<string, number>): number {
  return Object.values(counts).filter((n) => n > 0).length;
}

/**
 * Counts the number of branch slots across all branch entries that were hit at least once.
 *
 * @param branches - Map of branch id to array of per-path hit counts.
 * @returns Number of individual branch slots with a non-zero count.
 */
function countBranchHits(branches: Record<string, number[]>): number {
  return Object.values(branches)
    .flat()
    .filter((n) => n > 0).length;
}

/**
 * Returns the total number of branch slots across all branch entries.
 *
 * @param branches - Map of branch id to array of per-path hit counts.
 * @returns Total number of individual branch slots.
 */
function countBranchTotal(branches: Record<string, number[]>): number {
  return Object.values(branches).flat().length;
}

/**
 * Formats a hit/total pair as a percentage string.
 *
 * @param hit - Number of covered items.
 * @param total - Total number of items.
 * @returns Percentage string, e.g. "50%", or "n/a" when total is zero.
 */
function pct(hit: number, total: number): string {
  if (total === 0) return 'n/a';
  return `${Math.round((hit / total) * 100)}%`;
}

/**
 * Escapes special regex characters in a string for use in a Jest --testPathPattern argument.
 *
 * @param s - Raw string to escape.
 * @returns Regex-safe escaped string.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Runs a single Jest test file with coverage enabled, writing results to `coverageDir`.
 *
 * @param testFile - Absolute path to the test file to run.
 * @param coverageDir - Directory where Jest should write coverage output.
 * @returns A promise that resolves when Jest exits successfully.
 * @throws If Jest exits with a non-zero status.
 */
function runJest(testFile: string, coverageDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const relativeTestFile = path.relative(rootDir, testFile);
    const proc = spawn(
      'node',
      [
        'node_modules/.bin/jest',
        '--config',
        'jest.config.ts',
        '--coverage',
        '--coverageDirectory',
        coverageDir,
        '--testPathPatterns',
        escapeRegExp(relativeTestFile),
        '--coverageThreshold',
        '{}',
        '--forceExit',
        '--silent',
      ],
      { cwd: rootDir },
    );

    const chunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Jest failed:\n${Buffer.concat(chunks).toString('utf8').trim()}`));
      }
    });
  });
}

/**
 * Analyses out-of-scope coverage for a single test file by running it in isolation and comparing
 * covered source files against the expected primary source file.
 *
 * @param testFile - Absolute path to the test file.
 * @returns A promise resolving to a SuiteResult describing any out-of-scope coverage hits.
 */
async function analyzeSuite(testFile: string): Promise<SuiteResult> {
  const primarySourceFile = deriveSourcePath(testFile);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-overlap-'));
  const start = Date.now();

  try {
    await runJest(testFile, tmpDir);

    const coverageJson = path.join(tmpDir, 'coverage-final.json');
    if (fs.existsSync(coverageJson)) {
      const coverageData: Record<string, FileCoverage> = JSON.parse(
        fs.readFileSync(coverageJson, 'utf8'),
      );

      const outOfScopeHits: OutOfScopeHit[] = Object.entries(coverageData)
        .filter(([filePath]) => filePath !== primarySourceFile)
        .flatMap(([filePath, data]) => {
          const fnHit = countNonZero(data.f);
          const fnTotal = Object.keys(data.fnMap).length;
          const branchHit = countBranchHits(data.b);
          const branchTotal = countBranchTotal(data.b);
          if (fnHit === 0 && branchHit === 0) return [];
          return [{ file: filePath, fnHit, fnTotal, branchHit, branchTotal }];
        });

      return { testFile, primarySourceFile, outOfScopeHits, elapsedMs: Date.now() - start };
    }

    return {
      testFile,
      primarySourceFile,
      outOfScopeHits: [],
      elapsedMs: Date.now() - start,
      error: 'coverage-final.json not found after jest run',
    };
  } catch (err) {
    return {
      testFile,
      primarySourceFile,
      outOfScopeHits: [],
      elapsedMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Prints a human-readable report of coverage overlap results and returns whether any ERROR-level
 * violations were found.
 *
 * @param results - Array of suite results to report.
 * @returns True if any suite has functions or branches covered in an out-of-scope file.
 */
function printReport(results: SuiteResult[]): boolean {
  console.log('\n=== Coverage Overlap Report ===\n');

  const hasViolations = results.reduce(
    (acc, { testFile, primarySourceFile, outOfScopeHits, elapsedMs, error }) => {
      const label = path.relative(rootDir, testFile);
      const primary = path.relative(rootDir, primarySourceFile);
      const time = `${(elapsedMs / 1000).toFixed(1)}s`;

      if (error) {
        console.log(`  [ERR]  ${label}  (${time})`);
        console.log(`         Error: ${error}`);
        return true;
      }

      if (outOfScopeHits.length === 0) {
        console.log(`  [OK]   ${label}  (${time})`);
        return acc;
      }

      console.log(`  [!!]   ${label}  →  primary: ${primary}  (${time})`);
      outOfScopeHits.forEach((hit) => {
        const file = path.relative(rootDir, hit.file);
        console.log(`         ERROR  ${file}`);
        console.log(
          `                functions ${pct(hit.fnHit, hit.fnTotal)}  ` +
            `branches ${pct(hit.branchHit, hit.branchTotal)}`,
        );
      });

      return true;
    },
    false,
  );

  console.log('');
  if (hasViolations) {
    console.log('FAIL: some test suites cover functions or branches in out-of-scope files.\n');
  } else {
    console.log('PASS: no out-of-scope function or branch coverage detected.\n');
  }

  return hasViolations;
}

/** Discovers all test files, runs each in isolation concurrently, and reports coverage overlap. */
(async function main() {
  const testFiles = globSync('src/**/__tests__/**/*.test.{ts,tsx}', {
    cwd: rootDir,
    absolute: true,
  });

  if (testFiles.length === 0) {
    console.error('No test files found.');
    process.exit(1);
  }

  console.log(`Analyzing coverage overlap for ${testFiles.length} test suite(s)...`);

  const results = await Promise.all(
    testFiles.map(async (testFile) => {
      const result = await analyzeSuite(testFile);
      console.log(
        `  done (${(result.elapsedMs / 1000).toFixed(1)}s)  ${path.relative(rootDir, testFile)}`,
      );
      return result;
    }),
  );

  const hasViolations = printReport(results);
  process.exit(hasViolations ? 1 : 0);
})();
