// Renders mockup.html to the PNGs committed beside it.
// Run from the repo root: node docs/mockups/issue-130-morph-type-help/screenshot.mjs
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

const VARIANTS = [
  ['variant-a', 'a-inline-expand'],
  ['variant-b', 'b-hover-card'],
  ['variant-c', 'c-side-drawer'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto(pathToFileURL(join(dir, 'mockup.html')).href);

for (const theme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  const suffix = theme === 'dark' ? '-dark' : '';
  for (const [id, name] of VARIANTS) {
    await page.locator(`#${id}`).screenshot({ path: join(dir, `${name}${suffix}.png`) });
  }
}

await page.emulateMedia({ colorScheme: 'light' });
await page.evaluate(() => document.documentElement.classList.remove('dark'));
await page.screenshot({ path: join(dir, 'all-variants.png'), fullPage: true });

await browser.close();
