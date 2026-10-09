import { Canon } from '@sillsdev/scripture';
import { execSync } from 'child_process';
import path from 'path';
import { SOURCE_PROJECT_NAME } from '../../../perf/paths';
import { writeCapturedBook, writeCaptureMeta } from '../../../perf/usj-cache';
import { test } from '../../fixtures/cdp.fixture';
import { waitForAppAndInterlinearizerReady } from '../../fixtures/helpers';

test('capture the source project USJ', async ({ mainPage }) => {
  test.setTimeout(10 * 60_000);
  await waitForAppAndInterlinearizerReady(mainPage, { cdp: true });

  const projectId = await mainPage.evaluate(async (name) => {
    const projects = await window.papi.projectLookup.getMetadataForAllProjects();
    return projects.find((project) => project.name === name)?.id;
  }, SOURCE_PROJECT_NAME);
  if (!projectId) throw new Error(`No ${SOURCE_PROJECT_NAME} project is installed`);

  const { booksPresent, languageTag } = await mainPage.evaluate(async (id) => {
    const base = await window.papi.projectDataProviders.get('platform.base', id);
    return {
      booksPresent: await base.getSetting('platformScripture.booksPresent'),
      languageTag: await base.getSetting('platform.languageTag'),
    };
  }, projectId);
  if (typeof booksPresent !== 'string' || typeof languageTag !== 'string')
    throw new Error(`${SOURCE_PROJECT_NAME} reported no books or language`);

  const books = [...booksPresent]
    .map((flag, index) => (flag === '1' ? Canon.bookNumberToId(index + 1) : undefined))
    .filter((book): book is string => !!book);

  // One book per round-trip keeps each CDP message well under its size limit.
  await books.reduce(async (previous, book) => {
    await previous;
    const usj = await mainPage.evaluate(
      async ([id, bookCode]) => {
        const pdp = await window.papi.projectDataProviders.get('platformScripture.USJ_Book', id);
        return pdp.getBookUSJ({ book: bookCode, chapterNum: 1, verseNum: 1 });
      },
      [projectId, book] as const,
    );
    if (!usj) throw new Error(`${SOURCE_PROJECT_NAME} returned no USJ for ${book}`);
    writeCapturedBook(projectId, book, usj);
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
