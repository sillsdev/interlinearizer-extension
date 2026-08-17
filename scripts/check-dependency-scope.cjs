const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Cross-checks `package.json` against paranext-extension-template's and against
 * `.github/dependabot.yml`, enforcing the rule the Dependabot config states in its header: a
 * package belongs on the allow list if, and only if, it is absent from the template's
 * `package.json`. Exits non-zero on any violation.
 *
 * When this clone's history does not reach the merged template commit, the check skips itself
 * locally and fails in CI — a shallow clone should not block a lint run, but it must not quietly
 * disable the check either.
 */

const REPO_ROOT = path.join(__dirname, '..');
const OUR_MANIFEST_PATH = path.join(REPO_ROOT, 'package.json');
const DEPENDABOT_CONFIG_PATH = path.join(REPO_ROOT, '.github', 'dependabot.yml');

/**
 * The template commit this repo has merged. README's update instructions move it in the same commit
 * that merges the template, which is also what puts it in this repo's history.
 *
 * Holding the comparison to a fixed commit rather than the template's moving head is what lets a
 * range difference mean "this extension moved the range": the template bumps its own ranges between
 * merges, and those bumps are for the next merge to adopt rather than a lint failure in the
 * meantime.
 */
const MERGED_TEMPLATE_COMMIT = '5f44a9d8e18908374962a482f74d2cc76270f91c';

const SHORT_COMMIT = MERGED_TEMPLATE_COMMIT.slice(0, 7);
const DEEPEN_HISTORY_HINT = 'git fetch --unshallow';

/**
 * A baseline left behind by a template merge reads that merge's own bumps as this extension's, so
 * every violation comes out inverted and advises undoing the merge. Nothing in the manifests tells
 * that case from real drift, so every failure carries the possibility.
 */
const STALE_BASELINE_HINT = `If these came in with a template merge, move MERGED_TEMPLATE_COMMIT in ${path.basename(__filename)} to the template commit that merge brought in, rather than acting on the lines above.`;

/**
 * Version ranges this extension deliberately holds apart from the template's. Each entry records
 * both sides, so it covers that one divergence and no other: change either range and the entry
 * stops matching, which puts the pair back in front of a human.
 */
const RECORDED_RANGE_DIVERGENCES = [
  {
    name: '@tailwindcss/postcss',
    template: '^4.0.0',
    ours: '^4.3.0',
    reason:
      'Narrowed in 791ffd6 alongside the React 19 / Tailwind 4 upgrade. Every version it admits also satisfies the template range.',
  },
  {
    name: 'tailwindcss',
    template: '^4.0.0',
    ours: '^4.3.0',
    reason:
      'Narrowed in 791ffd6 alongside the React 19 / Tailwind 4 upgrade. Every version it admits also satisfies the template range.',
  },
];

/** Whether a version range resolves against a sibling checkout rather than the registry. */
function isFileDependency(range) {
  return range !== undefined && range.startsWith('file:');
}

/** Runtime and development dependencies merged, since Dependabot scopes both as one npm ecosystem. */
function collectDependencies(manifest) {
  return { ...manifest.dependencies, ...manifest.devDependencies };
}

/**
 * @returns {Record<string, string> | undefined} `undefined` when this clone's history does not
 *   reach {@link MERGED_TEMPLATE_COMMIT}, a shallow clone being the ordinary reason for that.
 */
function readMergedTemplateDependencies() {
  try {
    const manifest = execFileSync('git', ['show', `${MERGED_TEMPLATE_COMMIT}:package.json`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return collectDependencies(JSON.parse(manifest));
  } catch {
    return undefined;
  }
}

/**
 * Whether {@link MERGED_TEMPLATE_COMMIT} is one this repo has merged rather than one it is still
 * behind, which is what keeps the baseline honest: moving it forward without merging would silently
 * excuse the very drift this check exists to report.
 */
function isMergedIntoHead() {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', MERGED_TEMPLATE_COMMIT, 'HEAD'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The dependency names the npm ecosystem entry allows and ignores.
 *
 * @throws When the config declares no npm ecosystem, which would otherwise read as an empty scope
 *   that passes every check.
 */
function readNpmScope() {
  const config = yaml.load(fs.readFileSync(DEPENDABOT_CONFIG_PATH, 'utf8'));
  const npmEntry = config.updates.find((entry) => entry['package-ecosystem'] === 'npm');
  if (!npmEntry) throw new Error(`No npm ecosystem entry in ${DEPENDABOT_CONFIG_PATH}`);

  const dependencyNames = (entries) => (entries ?? []).map((entry) => entry['dependency-name']);
  return { allow: dependencyNames(npmEntry.allow), ignore: dependencyNames(npmEntry.ignore) };
}

/** @returns {string[]} One line per violation; empty when the scoping rule holds. */
function findViolations(ours, template, scope) {
  const violations = [];
  const recordedByName = new Map(RECORDED_RANGE_DIVERGENCES.map((entry) => [entry.name, entry]));

  RECORDED_RANGE_DIVERGENCES.forEach((recorded) => {
    if (ours[recorded.name] === recorded.ours && template[recorded.name] === recorded.template)
      return;
    violations.push(
      `${recorded.name}: recorded divergence is stale — it records template ${recorded.template} against ours ${recorded.ours} ("${recorded.reason}"), but the manifests now read template ${template[recorded.name] ?? '(absent)'} against ours ${ours[recorded.name] ?? '(absent)'}`,
    );
  });

  Object.entries(ours).forEach(([name, range]) => {
    if (recordedByName.has(name) || !(name in template) || template[name] === range) return;
    violations.push(
      `${name}: ${range} moved off the template's ${template[name]} — sync it back, or record the divergence in ${path.basename(__filename)}`,
    );
  });

  Object.entries(ours).forEach(([name, range]) => {
    if (name in template || isFileDependency(range) || scope.allow.includes(name)) return;
    violations.push(
      `${name}: absent from the template's package.json, so it needs a Dependabot allow entry to receive updates`,
    );
  });

  scope.allow.forEach((name) => {
    if (!(name in ours))
      violations.push(`${name}: on Dependabot's allow list but no longer in package.json`);
    else if (name in template)
      violations.push(
        `${name}: on Dependabot's allow list but the template owns it, so template merges will fight its updates`,
      );
  });

  Object.entries(ours).forEach(([name, range]) => {
    if (!isFileDependency(range) || scope.ignore.includes(name)) return;
    violations.push(
      `${name}: a file: dependency missing from Dependabot's ignore list, which aborts its file fetcher`,
    );
  });

  scope.ignore.forEach((name) => {
    if (isFileDependency(ours[name])) return;
    violations.push(
      `${name}: on Dependabot's ignore list, which exists for file: dependencies — an ignore entry with another purpose needs this check updated`,
    );
  });

  return violations;
}

const templateDependencies = readMergedTemplateDependencies();

if (!templateDependencies) {
  const message = `Cannot read the template's package.json at ${SHORT_COMMIT} — this clone's history does not reach it.`;
  if (process.env.CI) {
    console.error(`✗ ${message}`);
    process.exit(1);
  }
  console.log(`⊘ ${message}`);
  console.log(`  To run this check locally: ${DEEPEN_HISTORY_HINT}`);
  process.exit(0);
}

if (!isMergedIntoHead()) {
  console.error(
    `✗ ${SHORT_COMMIT} is recorded as the template commit this repo has merged, but it is not in this history. Move that commit only in the merge that adopts it — or run \`${DEEPEN_HISTORY_HINT}\` if this clone is simply too shallow to see the merge.`,
  );
  process.exit(1);
}

const ours = collectDependencies(JSON.parse(fs.readFileSync(OUR_MANIFEST_PATH, 'utf8')));
const violations = findViolations(ours, templateDependencies, readNpmScope());

console.log(
  `Comparing package.json against the template at ${SHORT_COMMIT}, the commit this repo has merged`,
);

const templateOnly = Object.keys(templateDependencies).filter((name) => !(name in ours));
if (templateOnly.length > 0) {
  console.log(
    `⊘ In that template commit but not here, so this extension has dropped them: ${templateOnly.join(', ')}`,
  );
}

if (violations.length > 0) {
  violations.forEach((violation) => console.error(`✗ ${violation}`));
  console.error(`ℹ ${STALE_BASELINE_HINT}`);
  process.exit(1);
}

console.log('✓ Dependabot scope matches the packages this extension adds to the template');
process.exit(0);
