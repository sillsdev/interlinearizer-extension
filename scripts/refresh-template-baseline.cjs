const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Copies the template's `package.json` over the baseline `npm run lint:dependencies` compares
 * against, and reports the template commit the copy came from. README's update instructions run
 * this in the same commit that merges the template.
 */

const REPO_ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'merged-template-package.json');

/** The template state to copy from — a remote-tracking ref, so it moves only on `git fetch`. */
const TEMPLATE_REF = 'template/main';

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
  console.error(`✗ Could not resolve ${TEMPLATE_REF}: ${error.message}`);
  console.error(
    'ℹ Adding the template remote is a one-time step after cloning, and its refs need fetching before a merge. README\'s "To update this extension from the template" section has both commands.',
  );
  process.exit(1);
}

// Ordering is load-bearing: nothing touches the baseline until both git calls have succeeded, and
// the copy comes from the same commit reported below.
const manifest = git('show', `${commit}:package.json`);
fs.writeFileSync(BASELINE_PATH, manifest);

console.log(
  `✓ Copied package.json from ${TEMPLATE_REF} at ${commit.slice(0, 7)} into ${path.relative(REPO_ROOT, BASELINE_PATH)}`,
);
console.log(`ℹ Set MERGED_TEMPLATE_COMMIT in check-dependency-scope.cjs to ${commit}`);
