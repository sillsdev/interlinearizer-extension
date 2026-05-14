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
const hasYalcFlag = process.argv.includes('--yalc');

if (!hasAllFlag && !hasCoreFlag && !hasExtFlag && !hasNpmFlag && !hasYalcFlag) {
  console.error('Usage: node delete-temp-files.cjs [--all] [--core] [--ext] [--npm] [--yalc]');
  console.error('  --core          Delete Electron and core caches (Electron, dev-appdata)');
  console.error('  --ext           Delete extension directories (coverage, dist, src/temp-build)');
  console.error('  --npm           Delete both node_modules and extension package-lock.json');
  console.error('  --yalc          Delete core yalc-related files');
  console.error('  --all           Delete all of the above');
  process.exit(1);
}

const shouldDeleteCore = hasAllFlag || hasCoreFlag;
const shouldDeleteExt = hasAllFlag || hasExtFlag;
const shouldDeleteNpm = hasAllFlag || hasNpmFlag;
const shouldDeleteYalc = hasAllFlag || hasYalcFlag;

// Define directory lists

let electronParent = '';
if (shouldDeleteCore) {
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
}

const CORE_DIRS = [
  electronParent ? path.join(electronParent, 'Electron') : '',
  path.join(__dirname, '..', '..', 'paranext-core', 'dev-appdata'),
];

const EXT_DIRS = [
  path.join(__dirname, '..', 'coverage'),
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, '..', 'src', 'temp-build'),
];

const NPM_PATHS = [
  path.join(__dirname, '..', '..', 'paranext-core', 'node_modules'),
  path.join(__dirname, '..', 'node_modules'),
  path.join(__dirname, '..', 'package-lock.json'),
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
      console.log(`✓ Deleted ${pathToDelete}`);
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
