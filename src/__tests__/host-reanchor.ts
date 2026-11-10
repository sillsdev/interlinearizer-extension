/// <reference types="jest" />

import type { DraftProject } from 'interlinearizer';
import type { DraftContent } from '../types/draft-content';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { splitAnalysisByBook } from '../utils/analysis-book';
import { applyChangeSet } from '../utils/change-set';
import { changesOfReanchor } from '../utils/reanchor-changes';
import type { BookPass } from '../types/book-pass';

function draftHolding({ analysis, segmentation }: DraftContent): DraftProject {
  return { ...emptyDraft('src'), analysis, ...(segmentation && { segmentation }) };
}

/**
 * Checks that the changes the host stages for a re-anchor pass bring the draft to what the pass
 * made, and that a pass over only the book's links, as the host reads them, stages the same
 * changes.
 *
 * @param content - The draft content the pass ran over.
 * @param bookCode - The book re-anchored.
 * @param pass - The pass over the book. It must stamp every run alike.
 * @param reanchored - What `pass` made of `content`.
 */
export function expectHostReanchor(
  content: DraftContent,
  bookCode: string,
  pass: BookPass<DraftContent>,
  reanchored: DraftContent,
): void {
  const draft = draftHolding(content);
  const changes = changesOfReanchor(draft, reanchored);
  const applied = changes ? applyChangeSet(draft, changes).draft : draft;
  expect(applied.analysis).toEqual(reanchored.analysis);
  expect(applied.segmentation).toEqual(reanchored.segmentation);

  // As the host reads a book: its links, and the segment analyses they reference.
  const inBook = splitAnalysisByBook(content.analysis).get(bookCode) ?? emptyAnalysis();
  const bookAlone: DraftContent = {
    analysis: {
      ...emptyAnalysis(),
      tokenAnalysisLinks: inBook.tokenAnalysisLinks,
      phraseAnalysisLinks: inBook.phraseAnalysisLinks,
      segmentAnalysisLinks: inBook.segmentAnalysisLinks,
      segmentAnalyses: inBook.segmentAnalyses,
    },
    segmentation: content.segmentation,
  };
  expect(changesOfReanchor(draftHolding(bookAlone), pass(bookAlone))).toEqual(changes);
}
