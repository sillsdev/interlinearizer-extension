const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { fail } = require('./report-failure.cjs');

/**
 * Cross-checks `package.json` against paranext-extension-template's and against
 * `.github/dependabot.yml`, enforcing the rule the Dependabot config states in its header: a
 * package belongs on the allow list if, and only if, it is absent from the template's
 * `package.json`. Exits non-zero on any violation.
 */

const REPO_ROOT = path.join(__dirname, '..');
const OUR_MANIFEST_PATH = path.join(REPO_ROOT, 'package.json');
const DEPENDABOT_CONFIG_PATH = path.join(REPO_ROOT, '.github', 'dependabot.yml');

/**
 * The template's `package.json` as of the commit this repo has merged, copied in verbatim. README's
 * update instructions refresh it in the same commit that merges the template.
 *
 * Holding the comparison to a fixed template state rather than the template's moving head is what
 * lets a range difference mean "this extension moved the range": the template bumps its own ranges
 * between merges, and those bumps are for the next merge to adopt rather than a lint failure in the
 * meantime.
 *
 * The baseline is a copy because it cannot be a git reference. A template update reaches `main`
 * squashed as readily as merged — #204 did — and a squash leaves the template's own commits
 * unreachable from this repo, so resolving a commit id would fail on every build once an update
 * lands that way. A copy also puts each move of the baseline in a reviewable diff.
 */
const MERGED_TEMPLATE_MANIFEST_PATH = path.join(__dirname, 'merged-template-package.json');

/**
 * The commit {@link MERGED_TEMPLATE_MANIFEST_PATH} was copied from, recorded so that output names a
 * template state a reader can go and look at. Nothing resolves it — the copy beside it is what this
 * check reads — so nothing here would catch the two disagreeing. `npm run template:baseline` writes
 * both, which is what keeps them in step; set this by hand only to repair a refresh that went
 * wrong.
 */
const MERGED_TEMPLATE_COMMIT = 'c2a2f07ce9faf1674340fba64e069f2e58a0eb09';

const SHORT_COMMIT = MERGED_TEMPLATE_COMMIT.slice(0, 7);

/**
 * A baseline left behind by a template merge reads that merge's own bumps as this extension's, so
 * every violation comes out inverted and advises undoing the merge. Nothing in the manifests tells
 * that case from real drift, so every failure carries the possibility.
 */
const STALE_BASELINE_HINT = `If these came in with a template merge, refresh ${path.basename(MERGED_TEMPLATE_MANIFEST_PATH)} from the template commit that merge brought in, rather than acting on the lines above. Run npm run template:baseline while template/main still points at that commit.`;

const UNREADABLE_BASELINE_HINT =
  'A template merge leaves conflict markers in this copy as readily as in any other file. Resolve them by hand, or run npm run template:baseline while template/main still points at the commit that merge brought in, which rewrites the copy outright.';

const UNREADABLE_MANIFEST_HINT =
  'Every npm command reads this file, so the rest of the toolchain is down alongside this check until it is readable again.';

const UNREADABLE_DEPENDABOT_CONFIG_HINT =
  'The allow and ignore lists this check holds package.json to live in that file, so there is nothing to check until it is readable.';

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

/**
 * The manifest's dependency sections merged, since Dependabot scopes them as one npm ecosystem.
 * `overrides` stays out: it pins transitive versions rather than naming packages this extension
 * depends on, so the allow-list rule has nothing to say about it.
 */
function collectDependencies(manifest) {
  return { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
}

/**
 * @throws When the manifest is missing or is not JSON, naming the file — the baseline copy collects
 *   conflict markers on a template merge as readily as any other file does.
 */
function readDependencies(manifestPath) {
  try {
    return collectDependencies(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  } catch (error) {
    throw new Error(`Could not read ${path.relative(REPO_ROOT, manifestPath)}: ${error.message}`);
  }
}

/**
 * The dependency names the npm ecosystem entry allows and ignores.
 *
 * @throws When the config is missing or is not YAML, and when it declares no npm ecosystem, which
 *   would otherwise read as an empty scope that passes every check.
 */
function readNpmScope() {
  const configPath = path.relative(REPO_ROOT, DEPENDABOT_CONFIG_PATH);

  let config;
  try {
    config = yaml.load(fs.readFileSync(DEPENDABOT_CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${configPath}: ${error.message}`);
  }

  const npmEntry = config?.updates?.find((entry) => entry['package-ecosystem'] === 'npm');
  if (!npmEntry) throw new Error(`No npm ecosystem entry in ${configPath}`);

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

/**
 * Runs `read`, reporting whatever it throws as a failure with a way out of it. Left to Node's
 * default handler, the same message arrives buried in a stack trace and carrying no hint at all.
 */
function readOrFail(read, hint) {
  try {
    return read();
  } catch (error) {
    fail(error.message, hint);
  }
}

const templateDependencies = readOrFail(
  () => readDependencies(MERGED_TEMPLATE_MANIFEST_PATH),
  UNREADABLE_BASELINE_HINT,
);
const ours = readOrFail(() => readDependencies(OUR_MANIFEST_PATH), UNREADABLE_MANIFEST_HINT);
const scope = readOrFail(readNpmScope, UNREADABLE_DEPENDABOT_CONFIG_HINT);

const violations = findViolations(ours, templateDependencies, scope);

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
