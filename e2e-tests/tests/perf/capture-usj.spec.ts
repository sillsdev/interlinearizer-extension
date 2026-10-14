import { Canon } from '@sillsdev/scripture';
import { execSync } from 'child_process';
import path from 'path';
import { SOURCE_PROJECT_NAME } from '../../../perf/paths';
import { clearCaptureMeta, writeCapturedBook, writeCaptureMeta } from '../../../perf/usj-cache';
import { test } from '../../fixtures/cdp.fixture';
import { waitForAppAndInterlinearizerReady } from '../../fixtures/helpers';
import { sourceProjectId } from './view-driver';

test('capture the source project USJ', async ({ mainPage }) => {
  test.setTimeout(10 * 60_000);
  await waitForAppAndInterlinearizerReady(mainPage, { cdp: true });

  const projectId = await sourceProjectId(mainPage);

  const { booksPresent, languageTag } = await mainPage.evaluate(async (id) => {
    const base = await window.papi.projectDataProviders.get('platform.base', id);
    return {
      booksPresent: await base.getSetting('platformScripture.booksPresent'),
      languageTag: await base.getSetting('platform.languageTag'),
    };
  }, projectId);
  if (typeof booksPresent !== 'string' || typeof languageTag !== 'string')
    throw new Error(`${SOURCE_PROJECT_NAME} reported no books or language`);

  const listed = [...booksPresent]
    .map((flag, index) => (flag === '1' ? Canon.bookNumberToId(index + 1) : undefined))
    .filter((book): book is string => !!book);

  clearCaptureMeta(projectId);
  // One book per round-trip keeps each CDP message well under its size limit.
  const books: string[] = [];
  await listed.reduce(async (previous, book) => {
    await previous;
    const usj = await mainPage.evaluate(
      async ([id, bookCode]) => {
        const pdp = await window.papi.projectDataProviders.get('platformScripture.USJ_Book', id);
        return pdp.getBookUSJ({ book: bookCode, chapterNum: 1, verseNum: 1 }).catch((e) => {
          // A book its settings list but its files lack.
          if (String(e?.message ?? e).includes('not found in project')) return undefined;
          throw e;
        });
      },
      [projectId, book] as const,
    );
    if (!usj) {
      console.warn(`${SOURCE_PROJECT_NAME} lists ${book} but has no text for it; skipping it`);
      return;
    }
    writeCapturedBook(projectId, book, usj);
    books.push(book);
  }, Promise.resolve());

  writeCaptureMeta({
    projectId,
    projectName: SOURCE_PROJECT_NAME,
    languageTag,
    books,
    capturedAt: new Date().toISOString(),
    coreCommit: execSync('git rev-parse HEAD', {
      cwd: path.resolve(__dirname, '../../../../paranext-core'),
    })
      .toString()
      .trim(),
  });
});
