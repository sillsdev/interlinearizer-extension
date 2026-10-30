const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Zips `dist/` into `release/` as one `<name>_<version>_<system>.zip` per operating system. Each
 * zip leaves out the other systems' C# hosts, because Platform.Bible unpacks every file of a new
 * zip before it activates extensions.
 *
 * Fails if `dist/` lacks a host that one of the zips needs.
 */

const REPO_ROOT = path.join(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'dist');
const STAGING_ROOT = path.join(REPO_ROOT, 'temp-build', 'zip-platforms');
const ZIP_BUILD = require.resolve('zip-build/lib/index.js');
const RUNTIME_IDENTIFIERS_BY_SYSTEM = {
  windows: ['win-x64'],
  linux: ['linux-x64'],
  macos: ['osx-x64', 'osx-arm64'],
};

const builtHosts = fs.readdirSync(path.join(DIST, 'c-sharp'));
const missing = Object.values(RUNTIME_IDENTIFIERS_BY_SYSTEM)
  .flat()
  .filter((rid) => !builtHosts.includes(rid));
if (missing.length > 0) {
  console.error(`dist/c-sharp has no C# host for ${missing.join(', ')}; run npm run build:c-sharp`);
  process.exit(1);
}

Object.entries(RUNTIME_IDENTIFIERS_BY_SYSTEM).forEach(([system, rids]) => {
  const staging = path.join(STAGING_ROOT, system);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(DIST, staging, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(path.join(DIST, 'c-sharp'), source).split(path.sep);
      return relative[0] === '..' || relative[0] === '' || rids.includes(relative[0]);
    },
  });
  execFileSync(
    process.execPath,
    [
      ZIP_BUILD,
      path.relative(REPO_ROOT, staging),
      'release',
      '--template',
      `%NAME%_%VERSION%_${system}.%EXT%`,
      '--override',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
});
fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
