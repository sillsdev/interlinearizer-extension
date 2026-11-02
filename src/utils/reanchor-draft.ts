import type { DraftContent } from '../types/draft-content';
import type { BookPass } from '../types/book-pass';
import { missingBook } from './reanchor-analysis';
import { reanchorDraftToBook } from './reanchor-changes';

/** Builds the pass that re-anchors a draft's content to a book the project no longer has. */
export function reanchorDraftToMissingBook(bookCode: string): BookPass<DraftContent> {
  return reanchorDraftToBook(missingBook(bookCode));
}
