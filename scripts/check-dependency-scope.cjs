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
 * When the template's `package.json` cannot be read, the check skips itself locally and fails in CI
 * — a missing template remote should not block a lint run, but it must not quietly disable the
 * check either.
 */

const REPO_ROOT = path.join(__dirname, '..');
const OUR_MANIFEST_PATH = path.join(REPO_ROOT, 'package.json');
const DEPENDABOT_CONFIG_PATH = path.join(REPO_ROOT, '.github', 'dependabot.yml');
const TEMPLATE_MANIFEST_PATH = path.join(
  REPO_ROOT,
  '..',
  'paranext-extension-template',
  'package.json',
);
const TEMPLATE_GIT_REF = 'template/main';
const ADD_TEMPLATE_REMOTE_HINT =
  'git remote add template https://github.com/paranext/paranext-extension-template && git fetch template';

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
 * @returns {{ source: string; dependencies: Record<string, string> } | undefined} `undefined` when
 *   neither the sibling checkout nor the template remote-tracking branch is available.
 */
function readTemplateDependencies() {
  if (fs.existsSync(TEMPLATE_MANIFEST_PATH)) {
    return {
      source: TEMPLATE_MANIFEST_PATH,
      dependencies: collectDependencies(
        JSON.parse(fs.readFileSync(TEMPLATE_MANIFEST_PATH, 'utf8')),
      ),
    };
  }

  try {
    const manifest = execFileSync('git', ['show', `${TEMPLATE_GIT_REF}:package.json`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return {
      source: `\`git show ${TEMPLATE_GIT_REF}:package.json\``,
      dependencies: collectDependencies(JSON.parse(manifest)),
    };
  } catch {
    return undefined;
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
      `${name}: ${range} diverges from the template's ${template[name]} — sync it, or record the divergence in ${path.basename(__filename)}`,
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

const template = readTemplateDependencies();

if (!template) {
  const message = `Cannot read the template's package.json — looked in ${TEMPLATE_MANIFEST_PATH} and \`${TEMPLATE_GIT_REF}\`.`;
  if (process.env.CI) {
    console.error(`✗ ${message}`);
    process.exit(1);
  }
  console.log(`⊘ ${message}`);
  console.log(`  To run this check locally: ${ADD_TEMPLATE_REMOTE_HINT}`);
  process.exit(0);
}

const ours = collectDependencies(JSON.parse(fs.readFileSync(OUR_MANIFEST_PATH, 'utf8')));
const violations = findViolations(ours, template.dependencies, readNpmScope());

console.log(`Comparing package.json against ${template.source}`);

const templateOnly = Object.keys(template.dependencies).filter((name) => !(name in ours));
if (templateOnly.length > 0) {
  console.log(
    `⊘ In the template but not here, which is expected between template merges: ${templateOnly.join(', ')}`,
  );
}

if (violations.length > 0) {
  violations.forEach((violation) => console.error(`✗ ${violation}`));
  process.exit(1);
}

console.log('✓ Dependabot scope matches the packages this extension adds to the template');
process.exit(0);
