import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { DraftProject } from 'interlinearizer';
import type { PageClient } from '../cache/pageClient';
import type { WholeAnalysis } from '../cache/wholeAnalysis';
import type { SegmentationDispatch } from '../components/SegmentationStore';
import type { EditStep } from './edit-step';
import type { SegmentPagesLoad } from './segment-pages';

/**
 * Whether a copy of the draft into a project landed, `'partial'` when it left part of the draft
 * out.
 */
export type DraftCopyResult = boolean | 'partial';

/** Configuration for starting a fresh, empty draft via {@link ProjectApi.newDraft}. */
export type NewDraftConfig = {
  /** BCP 47 tags for the gloss / annotation languages the new draft should use. */
  analysisLanguages: string[];
  /** Name typed in the New dialog, retained to prefill Save As; omitted when left blank. */
  suggestedName?: string;
  /** Description typed in the New dialog, retained to prefill Save As; omitted when left blank. */
  suggestedDescription?: string;
};

/** The handle that the WebView reads and edits a session through. */
export type SessionView = Readonly<{
  sessionId: string;
  /** Whether the session is on a Paratext 9 import, which no edit may change. */
  readOnly: boolean;
  /** The session's whole draft, for its scope and the answers that span books. */
  whole: WholeAnalysis;
  /** The loaded book's segment list, as the session segments and serves it. */
  pages: SegmentPagesLoad;
  /** Holds the loaded book's pages and sends the session's edits; absent until the first pages load. */
  client: PageClient | undefined;
  /** Whether any segment of the draft has a free translation, as of opening or the last discard. */
  hasFreeTranslations: boolean;
  /** The boundary edits, sent to the session. */
  boundaries: SegmentationDispatch;
  /** Makes `tag` the language that the session's edits are made in. */
  setAnalysisLanguage: (tag: string) => void;
}>;

/** A draft kept by a session, and the moves through its history. Each move settles once made. */
export type ProjectApi = {
  /** True until the session has opened and its draft has been read. */
  isDraftLoading: boolean;
  /** The draft as last read from the session, or `undefined` until the first read. */
  draft: DraftProject | undefined;
  /** Bumped each time the draft is replaced wholesale: New, Open, Discard, or an undo of one. */
  draftVersion: number;
  /** Bumped each time the draft's segment boundaries change. */
  segmentationVersion: number;
  /** Whether the draft has diverged from the project it saves to. */
  dirty: boolean;
  /** Returns the draft as of the moment of the call; `undefined` before the first read. */
  getDraftSnapshot: () => DraftProject | undefined;
  /** True while {@link ProjectApi.commitDraft} runs. */
  isSaving: boolean;
  /**
   * Saves the draft to a project, passing the draft and the id of the session that keeps it to
   * `copy`, which copies the stored draft into a project and resolves whether the copy landed. When
   * the copy landed whole, the draft is marked synced; a partial copy leaves it unsaved. Resolves
   * whether the copy landed, or `false` without copying when no draft has loaded or another save is
   * in flight.
   *
   * @throws Whatever `copy` throws; the draft stays dirty.
   * @throws If the draft cannot be read again once the copy lands.
   */
  commitDraft: (
    copy: (snapshot: DraftProject, sessionId: string) => Promise<DraftCopyResult>,
  ) => Promise<boolean>;
  /**
   * Replaces the draft with a working copy of the stored project `projectId`'s analysis and config,
   * the "Open" flow. Settles once the draft is stored, and rejects when the project can't be read
   * or the draft can't be stored.
   */
  loadFromProject: (projectId: string) => Promise<void>;
  /**
   * Starts a fresh, empty draft for the current source, the "New" flow. Settles once the draft is
   * stored, and rejects when it can't be.
   */
  newDraft: (config: NewDraftConfig) => Promise<void>;
  /**
   * Discards one book's unsaved changes, by 3-letter book code, restoring the book as the draft's
   * project holds it.
   *
   * @throws If the session refuses or fails the discard.
   */
  discardBook: (bookCode: string) => Promise<void>;
  /**
   * Discards every unsaved change to the draft, restoring what the draft's project holds.
   *
   * @throws If the session refuses or fails the discard.
   */
  discardAll: () => Promise<void>;
  /** Records that the project the draft saves to was deleted. */
  detachFromProject: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  /** Reads the history's revision, which changes whenever a step is recorded, undone, or redone. */
  getHistoryRevision: () => number;
  /**
   * Registers `listener` to hear each change of the history's revision, without re-rendering.
   *
   * @returns A function that unregisters the listener.
   */
  subscribeToHistoryRevisions: (listener: () => void) => () => void;
  /** Reverts the latest undo step; settles on the step undone, or `undefined` when there was none. */
  undo: () => Promise<EditStep | undefined>;
  /**
   * Reapplies the latest undone step; settles on the step redone, or `undefined` when there was
   * none.
   */
  redo: () => Promise<EditStep | undefined>;
  /** The session that keeps the draft; absent until it opens. */
  session?: SessionView;
};

/** What the project is told about the view. */
export type ProjectViewOptions = Readonly<{
  /** The interlinear project that the draft saves to; absent when it saves to none. */
  saveTargetId: string | undefined;
  /** The Paratext 9 import that the view shows read-only, in place of the draft. */
  importProjectId: string | undefined;
  /** The import's `updatedAt`, which a sync moves; absent with no import. */
  importVersion: string | undefined;
  /** The book whose pages to serve; none until its text has loaded. */
  bookId: string | undefined;
  scrRef: SerializedVerseRef;
  /**
   * Called when a session opens on a project that the source does not have, if the view still names
   * that project. The session views the draft instead, which saves to no project.
   */
  onProjectMissing?: () => void;
}>;
