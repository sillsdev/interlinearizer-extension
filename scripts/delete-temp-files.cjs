const fs = require('fs');
const path = require('path');

/**
 * Cross-platform script to delete temporary and cache paths. Run this if Platform.Bible is holding
 * on to outdated resources, such as localization strings, project data, or WebView ids.
 *
 * Warning: The `--build` flag deletes:
 *
 * - All core extension builds, which makes the next core:start last minutes longer
 *
 * Warning: The `--core` flag deletes:
 *
 * - The `Electron` cache folder, which affect any other Electron apps
 * - `paranext-core/dev-appdata/`, which includes `installed-extensions/`
 *
 * Warning: The `--yalc` flag deletion includes:
 *
 * - `paranext-core/dev-packages/`, which makes the next core:install last minutes longer
 */

// Check command-line arguments

const allFlag = process.argv.includes('--all');
const buildFlag = process.argv.includes('--build');
const coreFlag = process.argv.includes('--core');
const extFlag = process.argv.includes('--ext');
const npmFlag = process.argv.includes('--npm');
const testFlag = process.argv.includes('--test');
const yalcFlag = process.argv.includes('--yalc');

/**
 * Print usage information and exit the process.
 *
 * @param {number} [code=0] - Exit code to pass to `process.exit`. Default is `0`
 */
function printUsageAndExit(code = 0) {
  console.info(
    'Usage: node delete-temp-files.cjs [--all] [--build] [--core] [--ext] [--npm] [--test] [--yalc]',
  );
  console.info('  --build         Delete core build files');
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

if (!allFlag && !buildFlag && !coreFlag && !extFlag && !npmFlag && !testFlag && !yalcFlag) {
  printUsageAndExit(1);
}

const shouldDeleteBuild = allFlag || buildFlag;
const shouldDeleteCore = allFlag || coreFlag;
const shouldDeleteExt = allFlag || extFlag;
const shouldDeleteNpm = allFlag || npmFlag;
const shouldDeleteTest = allFlag || testFlag;
const shouldDeleteYalc = allFlag || yalcFlag;

// Define directory lists

const EXT_DIR_PATH = path.join(__dirname, '..');
const CORE_DIR_PATH = path.join(EXT_DIR_PATH, '..', 'paranext-core');
const SKIP_DIRS = new Set(['.yalc', 'dev-appdata', 'dev-packages', 'lib', 'node_modules']);

const BUILD_PATHS = [];
if (shouldDeleteBuild) {
  // Add core build output subdirectories to `BUILD_PATHS`
  BUILD_PATHS.push(...findNamed(CORE_DIR_PATH, 'dist', SKIP_DIRS));
  BUILD_PATHS.push(...findNamed(CORE_DIR_PATH, 'temp-build', SKIP_DIRS));
}

const CORE_PATHS = [path.join(CORE_DIR_PATH, 'dev-appdata')];
if (shouldDeleteCore) {
  // Determine Electron cache directory based on platform and add to `CORE_PATHS`
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
    CORE_PATHS.push(path.join(electronParent, 'Electron'));
  }
}

const EXT_PATHS = [path.join(EXT_DIR_PATH, 'dist'), path.join(EXT_DIR_PATH, 'src', 'temp-build')];

const NPM_PATHS = [
  path.join(EXT_DIR_PATH, 'node_modules'),
  path.join(EXT_DIR_PATH, 'package-lock.json'),
];
if (shouldDeleteNpm) {
  // Find core `node_modules` subdirectories and add them to `NPM_PATHS`
  NPM_PATHS.push(...findNamed(CORE_DIR_PATH, 'node_modules', SKIP_DIRS));
}

const TEST_PATHS = [path.join(EXT_DIR_PATH, 'coverage'), path.join(EXT_DIR_PATH, '.eslintcache')];

const YALC_PATHS = [
  path.join(CORE_DIR_PATH, '.yalc'),
  path.join(CORE_DIR_PATH, 'dev-packages'),
  path.join(CORE_DIR_PATH, 'yalc.lock'),
];

/**
 * Recursively find all entries named `target` inside `corePath`, skipping `skipDirs`.
 *
 * @param {string} corePath - Root directory to search
 * @param {string} target - Name of the entry to collect
 * @param {Set<string>} skipDirs - Directory names to skip entirely
 * @returns {string[]} Absolute paths of every matching directory found
 */
function findNamed(corePath, target, skipDirs) {
  let entries;
  try {
    entries = fs.readdirSync(corePath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name === target || (entry.isDirectory() && !skipDirs.has(entry.name)))
    .flatMap((entry) => {
      const fullPath = path.join(corePath, entry.name);
      return entry.name === target ? [fullPath] : findNamed(fullPath, target, skipDirs);
    });
}

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
  if (shouldDeleteBuild) {
    console.log('Deleting core build directories...');
    BUILD_PATHS.forEach(deletePath);
  }

  if (shouldDeleteCore) {
    console.log('Deleting core cache directories...');
    CORE_PATHS.forEach(deletePath);
  }

  if (shouldDeleteExt) {
    console.log('Deleting extension directories...');
    EXT_PATHS.forEach(deletePath);
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
