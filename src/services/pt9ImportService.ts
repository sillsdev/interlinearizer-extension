import papi, { logger } from '@papi/backend';
import type { ExecutionToken } from '@papi/core';
import type { Book } from 'interlinearizer';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { convertPt9Project, Pt9ImportReport, Pt9UnreadableFile } from '../converters/pt9';
import { readPt9InterlinearData, type Pt9InterlinearReadFile } from './pt9DataReader';
import * as projectStorage from './projectStorage';

/** The outcome of one import run, returned to the caller as the command's JSON payload. */
export interface Pt9ImportResult {
  /**
   * `imported` when a conversion ran and its outcome was persisted. `staleKept` when the source's
   * interlinear files have disappeared while an earlier import exists: the stored import is left
   * untouched rather than replaced with nothing, and only an explicit delete removes it.
   */
  outcome: 'imported' | 'staleKept';

  /**
   * Why the stored import was kept, so the caller can name the cause instead of reporting every
   * case as missing files. Absent when `outcome` is `imported`.
   */
  staleReason?: 'sourceEmpty' | 'allFilesTooLarge' | 'noGlossLanguage';

  /**
   * The files no read could take on, present only with `allFilesTooLarge`. Carried on its own
   * rather than inside a report: no conversion ran, so every count a report holds would be zero.
   */
  filesTooLargeToRead?: Pt9UnreadableFile[];

  /** The id of the created, replaced, or kept import project. */
  projectId: string;

  /** The conversion's report; absent when no conversion ran (`staleKept`). */
  report?: Pt9ImportReport;
}

/**
 * Whether the source has no interlinearizer state stored at all - no draft and no projects. The
 * first open of such a source offers converting its Paratext 9 interlinear data, once the WebView's
 * own probe confirms the source serves any. Any failure answers false: the offer is a convenience,
 * and a real problem surfaces through the import itself when the user runs one.
 */
export async function hasNoInterlinearizerState(
  token: ExecutionToken,
  sourceProjectId: string,
): Promise<boolean> {
  try {
    if (await projectStorage.hasDraft(token, sourceProjectId)) return false;
    return (await projectStorage.getProjectsForSource(token, sourceProjectId)).length === 0;
  } catch (e) {
    logger.warn('Interlinearizer: Paratext 9 convert-offer state check failed; not offering', e);
    return false;
  }
}

/**
 * Resolves the writing system tag for the source project's text, falling back to `und` when the
 * project setting is unavailable.
 */
async function getWritingSystem(sourceProjectId: string): Promise<string> {
  const basePdp = await papi.projectDataProviders.get('platform.base', sourceProjectId);
  const languageTag = await basePdp.getSetting('platform.languageTag');
  return typeof languageTag === 'string' && languageTag !== '' ? languageTag : 'und';
}

/**
 * Imports the source project's Paratext 9 interlinear data into the extension's model, serving both
 * first import and sync: fetches the parsed data through the read-only Pt9Interlinear
 * projectInterface in groups that fit what one response may carry, so a project of any size
 * imports, leaving out only files too large to retrieve at all, rebuilds the text layer for every
 * book it references from the project's USJ, converts, and persists the outcome as the source's
 * single frozen import project - created on first run, replaced wholesale on later runs. The stored
 * name and description are the fixed localized values, resolved at import time.
 *
 * A book the source project has no USJ for is skipped and counted in the report rather than failing
 * the import. A book that repeats a verse marker imports without that marker's text.
 *
 * @throws {Error} If the source project has no Paratext 9 interlinear data and no earlier import
 *   exists - nothing is created for an empty source.
 * @throws If the platform cannot read or parse the project's interlinear files, the conversion
 *   rejects the input, or persistence fails. Nothing has been written unless persistence itself
 *   failed.
 */
export async function importPt9Project(
  token: ExecutionToken,
  sourceProjectId: string,
): Promise<Pt9ImportResult> {
  const pt9Pdp = await papi.projectDataProviders.get(
    'platformScripture.Pt9Interlinear',
    sourceProjectId,
  );
  const { maxReadBytes, files } = await pt9Pdp.getPt9InterlinearManifest();
  // The stored provenance is a path-to-hash map: change detection is all it is ever compared for,
  // and keeping it that shape means the probe can gain fields without migrating stored imports.
  const fileHashes = Object.fromEntries(
    Object.entries(files).map(([path, info]) => [path, info.hash]),
  );

  if (Object.keys(files).length === 0) {
    const existing = await projectStorage.getPt9ImportForSource(token, sourceProjectId);
    if (existing) {
      logger.warn(
        `Interlinearizer: project ${sourceProjectId} has no Paratext 9 interlinear files; keeping the stored import ${existing.id} unchanged`,
      );
      return { outcome: 'staleKept', staleReason: 'sourceEmpty', projectId: existing.id };
    }
    throw new Error(`Project ${sourceProjectId} has no Paratext 9 interlinear data to import`);
  }

  // No selection can retrieve a file larger than one read may take on. Such a file is left out
  // and named in the report rather than failing the whole import: the rest of the project is
  // still worth having, and the user is told which books are missing. The ceiling is read from
  // the platform rather than copied, so it cannot fall out of step with what is enforced.
  // One predicate decides both lists, so every file lands in exactly one of them. Written as two
  // comparisons they would both be false for a size or ceiling that is not a number, and the file
  // would be neither read nor reported.
  if (!Number.isFinite(maxReadBytes))
    throw new Error(
      `Project ${sourceProjectId} reported no usable Paratext 9 read ceiling: ${maxReadBytes}`,
    );
  const retrievable: Pt9InterlinearReadFile[] = [];
  const filesTooLargeToRead: Pt9UnreadableFile[] = [];
  Object.entries(files).forEach(([path, info]) => {
    if (info.sizeBytes <= maxReadBytes) retrievable.push({ path, sizeBytes: info.sizeBytes });
    else
      filesTooLargeToRead.push({
        path,
        bookId: info.bookId,
        glossLanguage: info.glossLanguage,
        sizeBytes: info.sizeBytes,
        maxResponseBytes: maxReadBytes,
      });
  });
  if (filesTooLargeToRead.length > 0) {
    logger.warn(
      `Interlinearizer: project ${sourceProjectId} has ${filesTooLargeToRead.length} interlinear file(s) too large to read; skipping ${filesTooLargeToRead
        .map((file) => (file.bookId ? `${file.bookId} (${file.glossLanguage})` : file.path))
        .join(', ')}`,
    );
  }

  // Nothing readable is not the same as nothing to import, and it must not replace a stored
  // import with an empty one: a replacement stamps every hash as current, so no later sync would
  // ever repair it.
  if (retrievable.length === 0) {
    const existing = await projectStorage.getPt9ImportForSource(token, sourceProjectId);
    if (existing) {
      logger.warn(
        `Interlinearizer: every interlinear file in project ${sourceProjectId} is too large to read; keeping the stored import ${existing.id} unchanged`,
      );
      return {
        outcome: 'staleKept',
        staleReason: 'allFilesTooLarge',
        filesTooLargeToRead,
        projectId: existing.id,
      };
    }
    throw new Error(
      `Project ${sourceProjectId} has no Paratext 9 interlinear file small enough to read`,
    );
  }

  const data = await readPt9InterlinearData(pt9Pdp, retrievable, maxReadBytes);

  const bookIds = [
    ...new Set(data.books.flatMap((book) => (book.bookId === undefined ? [] : [book.bookId]))),
  ];
  const writingSystem = await getWritingSystem(sourceProjectId);
  const usjPdp = await papi.projectDataProviders.get('platformScripture.USJ_Book', sourceProjectId);
  const books: Book[] = (
    await Promise.all(
      bookIds.map(async (bookId): Promise<Book[]> => {
        const usj = await usjPdp.getBookUSJ({ book: bookId, chapterNum: 1, verseNum: 1 });
        if (!usj) {
          logger.warn(
            `Interlinearizer: project ${sourceProjectId} has no USJ for book ${bookId}; its interlinear data is skipped`,
          );
          return [];
        }
        const book = tokenizeBook(extractBookFromUsj(usj, writingSystem));
        if (book.duplicateVerseIds.length > 0) {
          logger.warn(
            `Interlinearizer: book ${bookId} in project ${sourceProjectId} repeats ${book.duplicateVerseIds.length} verse marker(s); their text is excluded from the import: ${book.duplicateVerseIds.join(', ')}`,
          );
        }
        return [book];
      }),
    )
  ).flat();

  const importedAt = new Date().toISOString();
  const { analysis, analysisLanguages, report } = convertPt9Project({ data, books, importedAt });
  report.filesTooLargeToRead = filesTooLargeToRead;

  // A project record must carry at least one analysis language, and a conversion that produced no
  // language converted no book. Persisting it would replace a good import with one the metadata
  // editor cannot even save, so the stored import is kept instead.
  if (analysisLanguages.length === 0) {
    const existing = await projectStorage.getPt9ImportForSource(token, sourceProjectId);
    if (existing) {
      logger.warn(
        `Interlinearizer: project ${sourceProjectId} converted no gloss language; keeping the stored import ${existing.id} unchanged`,
      );
      return { outcome: 'staleKept', staleReason: 'noGlossLanguage', projectId: existing.id };
    }
    throw new Error(
      `Project ${sourceProjectId} has no Paratext 9 interlinear book that could be converted`,
    );
  }

  const [name, description] = await Promise.all([
    papi.localization.getLocalizedString({ localizeKey: '%interlinearizer_pt9Import_name%' }),
    papi.localization.getLocalizedString({
      localizeKey: '%interlinearizer_pt9Import_description%',
    }),
  ]);

  const project = await projectStorage.savePt9Import(
    token,
    sourceProjectId,
    name,
    description,
    analysisLanguages,
    analysis,
    { fileHashes, importedAt },
  );
  logger.info(
    `Interlinearizer: imported Paratext 9 interlinear data from ${sourceProjectId} into ${project.id}`,
  );
  return { outcome: 'imported', projectId: project.id, report };
}
