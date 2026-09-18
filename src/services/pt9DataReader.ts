import { logger } from '@papi/backend';
import type {
  IPt9InterlinearProjectDataProvider,
  Pt9InterlinearProjectData,
} from 'platform-scripture';

/**
 * The one method of the Paratext 9 interlinear projectInterface this reader drives, picked from the
 * projectInterface's own type rather than restated. A test can still supply a plain object, while a
 * change to the platform's signature surfaces here instead of being absorbed by a look-alike.
 */
export type Pt9InterlinearReadSource = Pick<
  IPt9InterlinearProjectDataProvider,
  'getPt9InterlinearData'
>;

/** One interlinear file to read, and the size a read is measured against. */
export interface Pt9InterlinearReadFile {
  /** The file's manifest key, which is what a read's selector names. */
  path: string;
  /** The file's size on disk, as the manifest reports it. */
  sizeBytes: number;
}

/**
 * Groups files into the fewest reads that each stay within `maxReadBytes`.
 *
 * Greedy in the order given: a file joins the current group unless it would carry that group past
 * the ceiling, which starts a new one. Order within a group does not matter, since a read serves
 * every file its selector names.
 *
 * A file larger than the ceiling on its own cannot be retrieved by any grouping and is the caller's
 * to exclude; one reaching here sits alone in a group and fails that read.
 */
export function groupPt9ReadsByCeiling(
  files: readonly Pt9InterlinearReadFile[],
  maxReadBytes: number,
): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  files.forEach((file) => {
    if (current.length > 0 && currentBytes + file.sizeBytes > maxReadBytes) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file.path);
    currentBytes += file.sizeBytes;
  });
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Reads a project's whole Paratext 9 interlinear payload as one value, in as few reads as the
 * ceiling allows.
 *
 * The platform bounds how much a single response may carry, and a project's interlinear files can
 * exceed that in total while no single file comes close. Grouping by summed size keeps every
 * response inside the bound whatever the project holds, so a project's size stops deciding whether
 * it can be imported, and a project that fits is read in one request.
 *
 * Groups are read one after another rather than together: the reads are served by one process
 * parsing XML, so issuing them concurrently would multiply that process's peak memory by the number
 * in flight for no gain in the total time spent parsing.
 *
 * The assembled value is indistinguishable from what a single unbounded read would return, so
 * conversion keeps seeing the whole project at once and the cross-book decisions it makes - which
 * of two files claiming the same book and gloss language wins, which analyses merge, which stored
 * word analyses are already accounted for by a cluster - are unaffected.
 *
 * `setups` and `hasAssociatedLexicalProject` come from project settings rather than from the files,
 * so every response repeats them and the first response's copy is kept.
 *
 * @param source - The project's Paratext 9 interlinear projectInterface.
 * @param files - Every file to read, with the size the manifest reports for it. Reading none yields
 *   an empty payload without issuing a request.
 * @param maxReadBytes - The most on-disk bytes one read may take on, as the manifest reports it.
 * @throws Whatever a read throws, unchanged: one unreadable file fails the whole import rather than
 *   producing a payload that silently omits a book.
 */
export async function readPt9InterlinearData(
  source: Pt9InterlinearReadSource,
  files: readonly Pt9InterlinearReadFile[],
  maxReadBytes: number,
): Promise<Pt9InterlinearProjectData> {
  const assembled: Pt9InterlinearProjectData = {
    setups: [],
    books: [],
    lexicon: undefined,
    wordAnalyses: [],
    hasAssociatedLexicalProject: false,
  };
  const groups = groupPt9ReadsByCeiling(files, maxReadBytes);
  if (groups.length === 0) return assembled;

  let settingsDerivedTaken = false;
  // `for` rather than `reduce` over promises: each read must finish before the next is issued.
  // eslint-disable-next-line no-restricted-syntax
  for (const paths of groups) {
    // eslint-disable-next-line no-await-in-loop
    const part = await source.getPt9InterlinearData({ paths });

    if (!settingsDerivedTaken) {
      assembled.setups = part.setups;
      assembled.hasAssociatedLexicalProject = part.hasAssociatedLexicalProject;
      settingsDerivedTaken = true;
    }

    // Appended one at a time rather than spread: a response's entries become call arguments under
    // a spread, and a project's stored word analyses can run to six figures, which exceeds the
    // argument limit and throws where nothing about the failure mentions size.
    part.books.forEach((book) => assembled.books.push(book));
    part.wordAnalyses.forEach((parse) => assembled.wordAnalyses.push(parse));
    // A project has at most one lexicon file, so at most one response carries a lexicon.
    if (part.lexicon !== undefined) assembled.lexicon = part.lexicon;
  }

  logger.debug(
    `Interlinearizer: read ${files.length} Paratext 9 interlinear file(s) in ${groups.length} request(s); ${assembled.books.length} book(s), ${assembled.wordAnalyses.length} stored word analysis entries, lexicon ${assembled.lexicon === undefined ? 'absent' : 'present'}`,
  );
  return assembled;
}
