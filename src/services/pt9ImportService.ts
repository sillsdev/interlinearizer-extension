import papi, { logger } from '@papi/backend';
import type { ExecutionToken } from '@papi/core';
import type { Book } from 'interlinearizer';
import { extractBookFromUsj } from 'parsers/papi/usjBookExtractor';
import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import { convertPt9Project, Pt9ImportReport } from '../converters/pt9';
import * as projectStorage from './projectStorage';

/** The outcome of one import run, returned to the caller as the command's JSON payload. */
export interface Pt9ImportResult {
  /**
   * `imported` when a conversion ran and its outcome was persisted. `staleKept` when the source's
   * interlinear files have disappeared while an earlier import exists: the stored import is left
   * untouched rather than replaced with nothing, and only an explicit delete removes it.
   */
  outcome: 'imported' | 'staleKept';

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
 * projectInterface, rebuilds the text layer for every book it references from the project's USJ,
 * converts, and persists the outcome as the source's single frozen import project - created on
 * first run, replaced wholesale on later runs. The stored name and description are the fixed
 * localized values, resolved at import time.
 *
 * A book the source project has no USJ for is skipped and counted in the report rather than failing
 * the import.
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
  const fileHashes = await pt9Pdp.getPt9InterlinearManifest();

  if (Object.keys(fileHashes).length === 0) {
    const existing = await projectStorage.getPt9ImportForSource(token, sourceProjectId);
    if (existing) {
      logger.warn(
        `Interlinearizer: project ${sourceProjectId} has no Paratext 9 interlinear files; keeping the stored import ${existing.id} unchanged`,
      );
      return { outcome: 'staleKept', projectId: existing.id };
    }
    throw new Error(`Project ${sourceProjectId} has no Paratext 9 interlinear data to import`);
  }

  const data = await pt9Pdp.getPt9InterlinearData();

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
        return [tokenizeBook(extractBookFromUsj(usj, writingSystem))];
      }),
    )
  ).flat();

  const importedAt = new Date().toISOString();
  const { analysis, analysisLanguages, report } = convertPt9Project({ data, books, importedAt });

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
