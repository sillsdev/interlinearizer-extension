const fs = require('fs');
const path = require('path');

/**
 * Cross-platform script to delete temporary and cache paths. Run this if Platform.Bible is holding
 * on to outdated resources, such as localization strings, project data, or WebView ids.
 *
 * Warning: The `--core` flag deletes:
 *
 * - The `Electron` cache folder, which affect any other Electron apps
 * - `paranext-core/dev-appdata/`, which includes `installed-extensions/`
 *
 * Warning: The `--yalc` flag deletion includes:
 *
 * - `paranext-core/dev-packages/`, which makes the core re-install last minutes longer
 */

// Check command-line arguments

const hasAllFlag = process.argv.includes('--all');
const hasCoreFlag = process.argv.includes('--core');
const hasExtFlag = process.argv.includes('--ext');
const hasNpmFlag = process.argv.includes('--npm');
const hasTestFlag = process.argv.includes('--test');
const hasYalcFlag = process.argv.includes('--yalc');

function printUsageAndExit(code = 0) {
  console.info(
    'Usage: node delete-temp-files.cjs [--all] [--core] [--ext] [--npm] [--test] [--yalc]',
  );
  console.info('  --core          Delete Electron and core caches (Electron, dev-appdata)');
  console.info('  --ext           Delete extension builds (dist, src/temp-build)');
  console.info('  --npm           Delete extension package-lock.json and all node_modules');
  console.info('  --test          Delete extension test/lint-related files');
  console.info('  --yalc          Delete core yalc-related files');
  console.info('  --all           Delete all of the above');
  process.exit(code);
}

if (process.argv.length <= 2 || process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsageAndExit();
}

if (!hasAllFlag && !hasCoreFlag && !hasExtFlag && !hasNpmFlag && !hasTestFlag && !hasYalcFlag) {
  printUsageAndExit(1);
}

const shouldDeleteCore = hasAllFlag || hasCoreFlag;
const shouldDeleteExt = hasAllFlag || hasExtFlag;
const shouldDeleteNpm = hasAllFlag || hasNpmFlag;
const shouldDeleteTest = hasAllFlag || hasTestFlag;
const shouldDeleteYalc = hasAllFlag || hasYalcFlag;

// Define directory lists

const CORE_DIRS = [path.join(__dirname, '..', '..', 'paranext-core', 'dev-appdata')];

if (shouldDeleteCore) {
  // Determine Electron cache directory based on platform and add to `CORE_DIRS`
  let electronParent = '';

  /* eslint-disable no-nested-ternary */
  electronParent =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'linux'
        ? process.env.XDG_CONFIG_HOME
        : '';
  if (!electronParent && process.env.HOME) {
    electronParent =
      process.platform === 'linux'
        ? path.join(process.env.HOME, '.config')
        : process.platform === 'darwin'
          ? path.join(process.env.HOME, 'Library', 'Application Support')
          : '';
  }
  /* eslint-enable no-nested-ternary */

  if (electronParent) {
    CORE_DIRS.push(path.join(electronParent, 'Electron Cache'));
  }
}

const EXT_DIRS = [
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, '..', 'src', 'temp-build'),
];

const NPM_PATHS = [
  path.join(__dirname, '..', 'node_modules'),
  path.join(__dirname, '..', 'package-lock.json'),
];

if (shouldDeleteNpm) {
  // Recursively find `node_modules` folders in `paranext-core/` and add them to `NPM_PATHS`
  const corePath = path.join(__dirname, '..', '..', 'paranext-core');
  const SKIP_DIRS = new Set(['dev-appdata', 'dev-packages']);
  const findNodeModules = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries
      .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
      .forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === 'node_modules') {
          NPM_PATHS.push(fullPath);
        } else {
          findNodeModules(fullPath);
        }
      });
  };
  findNodeModules(corePath);
}

const TEST_PATHS = [
  path.join(__dirname, '..', 'coverage'),
  path.join(__dirname, '..', '.eslintcache'),
];

const YALC_PATHS = [
  path.join(__dirname, '..', '..', 'paranext-core', '.yalc'),
  path.join(__dirname, '..', '..', 'paranext-core', 'dev-packages'),
  path.join(__dirname, '..', '..', 'paranext-core', 'yalc.lock'),
];

/**
 * Delete a path if it exists
 *
 * @param {string} pathToDelete - The path to delete
 */
function deletePath(pathToDelete) {
  if (!pathToDelete) {
    console.log('⊘ Skipping empty path');
    return;
  }

  try {
    if (fs.existsSync(pathToDelete)) {
      fs.rmSync(pathToDelete, { recursive: true, force: true });
      console.log(`✓ ${pathToDelete} deleted`);
    } else {
      console.log(`⊘ ${pathToDelete} does not exist`);
    }
  } catch (error) {
    console.error(`✗ Failed to delete ${pathToDelete}:`, error.message);
  }
}

// Delete paths based on command-line flags

try {
  if (shouldDeleteCore) {
    console.log('Deleting core cache directories...');
    CORE_DIRS.forEach(deletePath);
  }

  if (shouldDeleteExt) {
    console.log('Deleting extension directories...');
    EXT_DIRS.forEach(deletePath);
  }

  if (shouldDeleteNpm) {
    console.log('Deleting node_modules and package-lock.json...');
    NPM_PATHS.forEach(deletePath);
  }

  if (shouldDeleteTest) {
    console.log('Deleting extension test- and lint-related files...');
    TEST_PATHS.forEach(deletePath);
  }

  if (shouldDeleteYalc) {
    console.log('Deleting core yalc-related files...');
    YALC_PATHS.forEach(deletePath);
  }

  console.log('Complete!');
  process.exit(0);
} catch (error) {
  console.error('Error during cleanup:', error);
  process.exit(1);
}
