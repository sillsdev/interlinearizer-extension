/// <reference types="jest" />

import type { DraftProject } from 'interlinearizer';
import type { DraftContent } from '../hooks/useDraftProject';
import { emptyAnalysis, emptyDraft } from '../types/empty-factories';
import { splitAnalysisByBook } from '../utils/analysis-book';
import { applyChangeSet } from '../utils/change-set';
import { changesOfReanchor } from '../utils/reanchor-changes';
import type { BookPass } from '../utils/undo-history';

function draftHolding({ analysis, segmentation }: DraftContent): DraftProject {
  return { ...emptyDraft('src'), analysis, ...(segmentation && { segmentation }) };
}

/**
 * Checks that the host's re-anchor of a book gives what the WebView's pass made. The changes the
 * host applies bring the draft to what the pass made. A pass over only the book's links, as the
 * host reads them, makes the same changes.
 *
 * @param content - The draft content the pass ran over.
 * @param bookCode - The book re-anchored.
 * @param pass - The WebView's pass over the book. It must stamp every run alike.
 * @param reanchored - What `pass` made of `content`.
 */
export function expectHostReanchorParity(
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
