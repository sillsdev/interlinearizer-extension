const fs = require('fs');
const path = require('path');

/** Cross-platform script to delete temporary and cache directories */

// Define directory lists
const CORE_DIRS = [
  () => path.join(process.env.APPDATA || '', 'Electron'),
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
  // Handle functions that generate paths (e.g., for environment variables)
  const resolvedPath = typeof dirPath === 'function' ? dirPath() : dirPath;

  if (!resolvedPath) {
    console.log('⊘ Path could not be resolved');
    return;
  }

  try {
    if (fs.existsSync(resolvedPath)) {
      fs.rmSync(resolvedPath, { recursive: true, force: true });
      console.log(`✓ Deleted ${resolvedPath}`);
    } else {
      console.log(`⊘ ${resolvedPath} does not exist`);
    }
  } catch (error) {
    console.error(`✗ Failed to delete ${resolvedPath}:`, error.message);
  }
}

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
