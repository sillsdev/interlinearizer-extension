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
 * Checks that the host's re-anchor of `bookCode` gives what the WebView's `pass` made of `content`,
 * `reanchored`: the changes it applies bring the draft to `reanchored`, and the pass over only the
 * book's analysis, as the host reads it, makes the same changes. `pass` must stamp every run
 * alike.
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

  const bookAlone: DraftContent = {
    analysis: splitAnalysisByBook(content.analysis).get(bookCode) ?? emptyAnalysis(),
    segmentation: content.segmentation,
  };
  expect(changesOfReanchor(draftHolding(bookAlone), pass(bookAlone))).toEqual(changes);
}
