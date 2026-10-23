const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Publishes the C# host, with its own .NET runtime, into `c-sharp/publish/<runtime identifier>/`,
 * where the webpack build picks it up. Publishes every runtime identifier Platform.Bible ships for
 * unless some are named as arguments, e.g. `npm run build:c-sharp -- win-x64`.
 *
 * Publish macOS builds on macOS: the .NET SDK code-signs the executable only there, and macOS on
 * Apple silicon will not run one that is unsigned.
 */

const REPO_ROOT = path.join(__dirname, '..');
const PROJECT = path.join(REPO_ROOT, 'c-sharp', 'InterlinearizerHost');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'c-sharp', 'publish');
const ALL_RUNTIME_IDENTIFIERS = ['win-x64', 'linux-x64', 'osx-x64', 'osx-arm64'];

const requested = process.argv.slice(2);
const unknown = requested.filter((rid) => !ALL_RUNTIME_IDENTIFIERS.includes(rid));
if (unknown.length > 0) {
  console.error(`Unknown runtime identifier: ${unknown.join(', ')}`);
  console.error(`Choose from: ${ALL_RUNTIME_IDENTIFIERS.join(', ')}`);
  process.exit(1);
}
const runtimeIdentifiers = requested.length > 0 ? requested : ALL_RUNTIME_IDENTIFIERS;

runtimeIdentifiers.forEach((rid) => {
  const output = path.join(OUTPUT_ROOT, rid);
  // A stale file from an earlier publish would otherwise ship beside the new ones.
  fs.rmSync(output, { recursive: true, force: true });
  console.log(`Publishing the C# host for ${rid}`);
  execFileSync(
    'dotnet',
    ['publish', PROJECT, '--configuration', 'Release', '--runtime', rid, '--output', output],
    { stdio: 'inherit' },
  );
});
