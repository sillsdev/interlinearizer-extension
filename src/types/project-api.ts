import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { PageClient } from '../cache/pageClient';
import type { WholeAnalysis } from '../cache/wholeAnalysis';
import type { SegmentationDispatch } from '../components/SegmentationStore';
import type { DraftContent, UseDraftProjectResult } from '../hooks/useDraftProject';
import type { UseSegmentPagesResult } from '../hooks/useSegmentPages';
import type { EditStep } from './edit-step';
import type { Settles } from '../utils/settles';

/** The handle that the WebView reads and edits a session through, on the host path. */
export type SessionView = Readonly<{
  sessionId: string;
  /** Whether the session is on a Paratext 9 import, which no edit may change. */
  readOnly: boolean;
  /** The session's whole draft, for its scope and the answers that span books. */
  whole: WholeAnalysis;
  /** The loaded book's segment list, as the session segments and serves it. */
  pages: UseSegmentPagesResult;
  /** Holds the loaded book's pages and sends the session's edits; absent until the first pages load. */
  client: PageClient | undefined;
  /** Whether any segment of the draft has a free translation, as of opening or the last discard. */
  hasFreeTranslations: boolean;
  /** Whether the session has read the whole text, so stale analysis covers the whole draft. */
  staleCoversDraft: boolean;
  /** The boundary edits, sent to the session. */
  boundaries: SegmentationDispatch;
  /** Makes `tag` the language that the session's edits are made in. */
  setAnalysisLanguage: (tag: string) => void;
}>;

/**
 * A draft and the moves through its history, kept by the WebView on one path and by a session on
 * the host path. On the host path, a move settles once the session has made it.
 */
export type ProjectApi = Omit<
  UseDraftProjectResult,
  'undo' | 'redo' | 'discardBook' | 'discardAll'
> & {
  /** Reverts the latest undo step; settles on the step undone, or `undefined` when there was none. */
  undo: () => Settles<EditStep | undefined>;
  /**
   * Reapplies the latest undone step; settles on the step redone, or `undefined` when there was
   * none.
   */
  redo: () => Settles<EditStep | undefined>;
  discardBook: (bookCode: string, saved?: DraftContent) => Settles<void>;
  discardAll: (saved?: DraftContent) => Settles<void>;
  /** The session that keeps the draft; absent on the WebView path. */
  session?: SessionView;
};

/** What the project is told about the view; only the host path reads it. */
export type ProjectViewOptions = Readonly<{
  /** The interlinear project that the draft saves to; absent when it saves to none. */
  saveTargetId: string | undefined;
  /** The Paratext 9 import that the view shows read-only, in place of the draft. */
  importProjectId: string | undefined;
  /** The book whose pages to serve; none until its text has loaded. */
  bookId: string | undefined;
  scrRef: SerializedVerseRef;
}>;
