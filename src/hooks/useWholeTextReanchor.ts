import type { Book, DraftProject } from 'interlinearizer';
import { useCallback, useState } from 'react';
import { booksLinkedIn } from '../utils/analysis-book';
import { reanchorDraftToBook, reanchorDraftToMissingBook } from '../utils/reanchor-draft';
import type { BookPass } from '../utils/undo-history';
import type { DraftContent } from './useDraftProject';
import useLatestRef from './useLatestRef';

/** Arguments for {@link useWholeTextReanchor}. */
export interface UseWholeTextReanchorArgs {
  /** The book the view has loaded, which re-anchors to its own live text rather than to a reading. */
  loadedBookCode: string | undefined;
  /** Whether an import is shown in place of the draft, which is then left as it is. */
  isImportView: boolean;
  /** Whether the draft is still loading, before which there is nothing to re-anchor. */
  isDraftLoading: boolean;
  /** Bumped whenever the draft is replaced wholesale. */
  draftVersion: number;
  getDraftSnapshot: () => DraftProject | undefined;
  reanchorBook: (bookCode: string, pass: BookPass<DraftContent>) => void;
}

/** What {@link useWholeTextReanchor} hands back, for a whole-text read to drive. */
export interface WholeTextReanchor {
  /**
   * Draft version the whole-text read re-anchors, `undefined` while loading or showing an import;
   * each change reads the text again.
   */
  readKey: number | undefined;
  /**
   * As the whole text is read, re-anchors the draft to each book it links into, except the loaded
   * book, which re-anchors to its live text.
   */
  onBookRead: (book: Book) => void;
  /**
   * Once the whole text is read, stales the draft's approvals in books the text lacks and records
   * the draft as fully re-anchored.
   */
  onTextRead: (bookIds: readonly string[]) => void;
  /** Whether every book has been re-anchored for the current draft, rather than only those opened. */
  staleCoversDraft: boolean;
}

/** Re-anchors the draft to every book of the source text each time the whole text is read. */
export default function useWholeTextReanchor({
  loadedBookCode,
  isImportView,
  isDraftLoading,
  draftVersion,
  getDraftSnapshot,
  reanchorBook,
}: UseWholeTextReanchorArgs): WholeTextReanchor {
  const loadedBookCodeRef = useLatestRef(loadedBookCode);
  const readKey = isImportView || isDraftLoading ? undefined : draftVersion;
  const readKeyRef = useLatestRef(readKey);

  /** The draft version every book was last re-anchored for. */
  const [textReanchoredFor, setTextReanchoredFor] = useState<number>();
  const staleCoversDraft = readKey !== undefined && textReanchoredFor === readKey;

  const onBookRead = useCallback(
    (read: Book) => {
      if (read.bookRef === loadedBookCodeRef.current) return;
      const analysis = readKeyRef.current === undefined ? undefined : getDraftSnapshot()?.analysis;
      if (!analysis || !booksLinkedIn(analysis).has(read.bookRef)) return;
      reanchorBook(read.bookRef, reanchorDraftToBook(read));
    },
    [getDraftSnapshot, reanchorBook, loadedBookCodeRef, readKeyRef],
  );

  const onTextRead = useCallback(
    (bookIds: readonly string[]) => {
      const target = readKeyRef.current;
      const analysis = target === undefined ? undefined : getDraftSnapshot()?.analysis;
      if (!analysis) return;
      const present = new Set(bookIds);
      booksLinkedIn(analysis).forEach((bookCode) => {
        if (!present.has(bookCode)) reanchorBook(bookCode, reanchorDraftToMissingBook(bookCode));
      });
      setTextReanchoredFor(target);
    },
    [getDraftSnapshot, reanchorBook, readKeyRef],
  );

  return { readKey, onBookRead, onTextRead, staleCoversDraft };
}
