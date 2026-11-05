const fs = require('fs');
const path = require('path');

/**
 * Writes `src/utils/case-folding.json`, the simple case folding table that both the WebView's and
 * the C# host's surface-form folds read, from the Unicode Character Database's `CaseFolding.txt`.
 *
 * Simple folding keeps the entries with status C (common) and S (simple), and leaves out F (full)
 * and T (Turkic). Bumping `UNICODE_VERSION` and rerunning this script is the one way to change the
 * table, so both sides always fold alike.
 */

const UNICODE_VERSION = '17.0.0';
const SOURCE_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/CaseFolding.txt`;
const OUTPUT_PATH = path.resolve(__dirname, '..', 'src', 'utils', 'case-folding.json');

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Fetching ${SOURCE_URL} failed: ${response.status}`);
  const text = await response.text();

  const folds = text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line !== '')
    .map((line) => line.split(';').map((field) => field.trim()))
    .filter(([, status]) => status === 'C' || status === 'S')
    .map(([code, , mapping]) => [parseInt(code, 16), parseInt(mapping, 16)]);

  // Written in Prettier's own layout, so formatting the repository leaves the file as generated
  const lines = folds.map(([from, to]) => `    [${from}, ${to}]`).join(',\n');
  fs.writeFileSync(
    OUTPUT_PATH,
    `{\n  "unicodeVersion": "${UNICODE_VERSION}",\n  "folds": [\n${lines}\n  ]\n}\n`,
  );
  console.log(`Wrote ${folds.length} folds from Unicode ${UNICODE_VERSION} to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
