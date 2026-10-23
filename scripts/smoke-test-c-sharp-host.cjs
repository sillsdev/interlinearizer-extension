const { spawnSync } = require('child_process');
const path = require('path');

/**
 * Checks that the C# host published for this machine starts on it: its bundled .NET runtime loads
 * and its own code runs. With no Platform.Bible running, a healthy host reports that it could not
 * connect and exits with code 1. Publish it first with `npm run build:c-sharp -- <identifier>`.
 */

const RUNTIME_IDENTIFIERS = {
  'win32 x64': 'win-x64',
  'linux x64': 'linux-x64',
  'darwin x64': 'osx-x64',
  'darwin arm64': 'osx-arm64',
};

const rid = RUNTIME_IDENTIFIERS[`${process.platform} ${process.arch}`];
if (!rid) {
  console.error(`No C# host build for ${process.platform} on ${process.arch}`);
  process.exit(1);
}
const executable = path.join(
  __dirname,
  '..',
  'c-sharp',
  'publish',
  rid,
  process.platform === 'win32' ? 'InterlinearizerHost.exe' : 'InterlinearizerHost',
);

const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 60_000 });
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
console.log(output);
if (result.error) {
  console.error(`The C# host for ${rid} could not start: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 1 || !output.includes('Could not connect to Platform.Bible')) {
  console.error(`The C# host for ${rid} did not run its own code (exit code ${result.status}).`);
  process.exit(1);
}
console.log(`The C# host for ${rid} starts.`);
