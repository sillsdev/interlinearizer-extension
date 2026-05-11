const fs = require('fs');
const path = require('path');

/**
 * Cross-platform script to delete temporary and cache directories. Run this if Platform.Bible is
 * holding on to outdated resources, such as localization strings, project data, or WebView ids.
 *
 * Warning: One directory deleted with the `--core` flag is `paranext-core/dev-appdata/`, which
 * includes `installed-extensions/`.
 */

// Define directory lists

let electronParent =
  process.platform === 'win32' ? process.env.APPDATA : process.env.XDG_CONFIG_HOME;
if (!electronParent && process.env.HOME) {
  electronParent =
    // eslint-disable-next-line no-nested-ternary
    process.platform === 'linux'
      ? path.join(process.env.HOME, '.config')
      : process.platform === 'darwin'
        ? path.join(process.env.HOME, 'Library', 'Application Support')
        : '';
}

const CORE_DIRS = [
  electronParent ? path.join(electronParent, 'Platform.Bible') : '',
  path.join(__dirname, '..', '..', 'paranext-core', 'dev-appdata'),
];

const EXT_DIRS = [
  path.join(__dirname, '..', 'coverage'),
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, '..', 'src', 'temp-build'),
];

/**
 * Delete a directory if it exists
 *
 * @param {string} dirPath - The directory path to delete
 */
function deleteDirectory(dirPath) {
  if (!dirPath) {
    console.log('⊘ Skipping empty path');
    return;
  }

  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`✓ Deleted ${dirPath}`);
    } else {
      console.log(`⊘ ${dirPath} does not exist`);
    }
  } catch (error) {
    console.error(`✗ Failed to delete ${dirPath}:`, error.message);
  }
}

// Delete directories based on command-line flags

try {
  const hasCoreFlag = process.argv.includes('--core');
  const hasExtFlag = process.argv.includes('--ext');

  if (!hasCoreFlag && !hasExtFlag) {
    console.error('Usage: node delete-temp-dirs.cjs [--core] [--ext]');
    console.error('  --core  Delete AppData and core cache directories (Electron, dev-appdata)');
    console.error('  --ext   Delete extension directories (coverage, dist, src/temp-build)');
    process.exit(1);
  }

  if (hasCoreFlag) {
    console.log('Deleting core cache directories...');
    CORE_DIRS.forEach(deleteDirectory);
  }

  if (hasExtFlag) {
    console.log('Deleting extension directories...');
    EXT_DIRS.forEach(deleteDirectory);
  }

  console.log('Complete!');
  process.exit(0);
} catch (error) {
  console.error('Error during cleanup:', error);
  process.exit(1);
}
