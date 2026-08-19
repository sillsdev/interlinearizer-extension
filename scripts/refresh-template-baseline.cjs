const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fail } = require('./report-failure.cjs');

/**
 * Copies the template's `package.json` over the baseline `npm run lint:dependencies` compares
 * against, and records the commit it came from in {@link CHECK_SCRIPT_PATH}. README's update
 * instructions run this in the same commit that merges the template.
 *
 * Writing both is what holds them together. The copy is what the check reads and the commit is only
 * what its output names, so nothing downstream would notice them disagreeing: a refresh that moved
 * one and left the other would leave every run naming a template state it had not compared
 * against.
 */

const REPO_ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'merged-template-package.json');
const CHECK_SCRIPT_PATH = path.join(__dirname, 'check-dependency-scope.cjs');

/** The template state to copy from — a remote-tracking ref, so it moves only on `git fetch`. */
const TEMPLATE_REF = 'template/main';

/**
 * The recorded commit's assignment in {@link CHECK_SCRIPT_PATH}, matched whole so the rewrite cannot
 * land on another hex run in the file — substituting in the wrong place is the one failure this
 * script would still report as a success. The id is matched at either git object-format width, so
 * what one run writes the next can still find.
 */
const RECORDED_COMMIT_ASSIGNMENT = /^(const MERGED_TEMPLATE_COMMIT = ')([0-9a-f]{40,64})(';)/m;

/**
 * Writes one half of the refresh, reporting a failure as the state it leaves behind. Left to Node's
 * default handler it arrives as a stack trace, which says that a write failed but not which half of
 * the pair had already landed — the one disagreement nothing downstream reports.
 */
function writeOrFail(filePath, contents, hint) {
  try {
    fs.writeFileSync(filePath, contents);
  } catch (error) {
    fail(`Could not write ${path.relative(REPO_ROOT, filePath)}: ${error.message}`, hint);
  }
}

/**
 * Runs git in the repo root and returns its stdout.
 *
 * @throws When git exits non-zero, carrying git's own stderr as the message.
 */
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(error.stderr?.trim() || error.message);
  }
}

let commit;
try {
  commit = git('rev-parse', '--verify', TEMPLATE_REF).trim();
} catch (error) {
  fail(
    `Could not resolve ${TEMPLATE_REF}: ${error.message}`,
    'Adding the template remote is a one-time step after cloning, and its refs need fetching before a merge. README\'s "To update this extension from the template" section has both commands.',
  );
}

const shortCommit = commit.slice(0, 7);

let manifest;
try {
  manifest = git('show', `${commit}:package.json`);
} catch (error) {
  fail(
    `Could not read package.json from ${TEMPLATE_REF} at ${shortCommit}: ${error.message}`,
    `A commit carrying no package.json is not a template commit, so check where the last fetch left ${TEMPLATE_REF}.`,
  );
}

let checkScript;
try {
  checkScript = fs.readFileSync(CHECK_SCRIPT_PATH, 'utf8');
} catch (error) {
  fail(
    `Could not read ${path.relative(REPO_ROOT, CHECK_SCRIPT_PATH)}: ${error.message}`,
    'The baseline and the commit recorded beside it are refreshed together, so this needs both files in place.',
  );
}

const recordedAssignment = checkScript.match(RECORDED_COMMIT_ASSIGNMENT);
if (!recordedAssignment)
  fail(
    `Found no MERGED_TEMPLATE_COMMIT assignment to rewrite in ${path.relative(REPO_ROOT, CHECK_SCRIPT_PATH)}`,
    "The rewrite expects that constant to be a commit id assigned on one line, as in `const MERGED_TEMPLATE_COMMIT = '…';`. Restore that shape, or teach this script the new one.",
  );

// Ordering is load-bearing: every read above has to succeed before either write below happens, so a
// read that fails leaves the baseline and the recorded commit as they were, and as each other. The
// writes cannot be given that same guarantee.
writeOrFail(
  BASELINE_PATH,
  manifest,
  'Nothing was written, so the baseline and the recorded commit are still as they were and still in step. Re-running once the write can succeed is the whole repair.',
);
writeOrFail(
  CHECK_SCRIPT_PATH,
  checkScript.replace(RECORDED_COMMIT_ASSIGNMENT, `$1${commit}$3`),
  `Half of the refresh landed: ${path.relative(REPO_ROOT, BASELINE_PATH)} now holds the package.json from ${shortCommit}, while MERGED_TEMPLATE_COMMIT still records ${recordedAssignment[2].slice(0, 7)}. Re-run once the write can succeed, or check out ${path.relative(REPO_ROOT, BASELINE_PATH)} again to put the pair back in step.`,
);

console.log(
  `✓ Copied package.json from ${TEMPLATE_REF} at ${shortCommit} into ${path.relative(REPO_ROOT, BASELINE_PATH)}`,
);
console.log(
  `✓ Recorded ${shortCommit} as MERGED_TEMPLATE_COMMIT in ${path.relative(REPO_ROOT, CHECK_SCRIPT_PATH)}`,
);
