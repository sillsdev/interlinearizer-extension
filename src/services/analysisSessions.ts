import type {
  AnalysisChange,
  Book,
  ChangeId,
  SegmentationDelta,
  SessionAnalysisChange,
} from 'interlinearizer';
import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';
import { ReadOnlyAnalysisError } from '../types/read-only-analysis-error';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import type { CommandReply } from '../types/command-reply';
import type { EditStep } from '../types/edit-step';
import { booksMissingFrom } from '../utils/analysis-book';
import { isEmptyChangeSet, mergeChangeSets } from '../utils/change-set';
import { analysisHasFreeTranslations } from '../utils/free-translations';
import { missingBook } from '../utils/reanchor-draft';
import { isEmptyDelta, segmentationForBook } from '../utils/segmentation';
import {
  booksResegmented,
  describeChange,
  describeScriptureEdit,
  type AppliedChange,
} from './analysisChanges';
import { assertApprovalRule } from './commands/approvalRule';
import { ChangeBuffer } from './commands/changeBuffer';
import { settleAll } from './draftRepository';
import { EditHistory, type EditOptions, type HistoryMove } from './editHistory';
import { reanchorRestored, reanchorStoredBook } from './reanchorPasses';
import { readTouchedPoolBuckets } from './sessionPages';

/** BCP 47 tag for a language that cannot be determined. */
export const UNDETERMINED_LANGUAGE = 'und';

/**
 * What a session opens: a source project's draft, paired with the interlinear project it saves to
 * when it has one, or a Paratext 9 import on its own.
 */
export type SessionScope =
  | {
      kind: 'draft';
      sourceProjectId: string;
      /** The interlinear project the draft saves to; absent when it has none. */
      interlinearProjectId?: string;
    }
  | { kind: 'pt9Import'; sourceProjectId: string; interlinearProjectId: string };

/** What opening a session tells its caller. */
export type OpenedSession = {
  /** Addresses the session in every later call. */
  sessionId: string;
  /** Whether the session refuses edits, as it does for a Paratext 9 import. */
  readOnly: boolean;
  /** Whether any segment of the opened analysis had a free translation when it opened. */
  hasFreeTranslations: boolean;
};

/** How a session applies an edit. */
export type SessionEditOptions = {
  /** As {@link EditOptions}; given as a function, it is read from the session in the edit's turn. */
  unsavedMark?: EditOptions['unsavedMark'] | ((session: Session) => EditOptions['unsavedMark']);
  changeId?: ChangeId;
  /**
   * The step to record the edit as, which an undo or redo of the edit hands back. A function reads
   * the step from the changes that the edit applies.
   */
  step?: EditStep | ((changes: ChangeSet) => EditStep | undefined);
};

/** What an edit command returns besides what it stages. */
export type EditOutcome = {
  /** The books to re-anchor the draft to, with the staged changes in place. */
  reanchorTo?: readonly Book[];
  /** Whether any segment of the draft that a discard leaves has a free translation. */
  hasFreeTranslations?: boolean;
  /** The token analyses that clearing glosses left empty, and so removed. */
  emptiedAnalysisIds?: string[];
};

/** What a session answers an edit with. */
export type EditReply = CommandReply &
  Pick<EditOutcome, 'hasFreeTranslations' | 'emptiedAnalysisIds'>;

/** An open session, as seen by the commands sent to it. */
export type Session = {
  readonly id: string;
  /** Changes only when the project that the draft saves to changes. */
  scope: SessionScope;
  readonly repository: AnalysisRepository;
  /** Every edit to the session's analysis is applied through it, so that undo can revert each one. */
  readonly history: EditHistory;
  /** BCP 47 tag of the language that glosses are read and written in. */
  analysisLanguage: string;
};

/** What sessions reach projects and storage through. */
export interface SessionHost {
  /**
   * The summary of `interlinearProjectId` among `sourceProjectId`'s interlinear projects, or
   * `undefined` when the source has none by that id.
   */
  findProject(
    sourceProjectId: string,
    interlinearProjectId: string,
  ): Promise<InterlinearProjectSummary | undefined>;
  /**
   * The source project's draft repository. Every handle for a source reaches the same repository,
   * one call at a time.
   */
  openDraftRepository(sourceProjectId: string): AnalysisRepository;
  /** Releases the source project's draft repository once the calls already queued on it settle. */
  releaseDraftRepository(sourceProjectId: string): Promise<void>;
  /** A read-only repository over the Paratext 9 import `interlinearProjectId`. */
  openPt9ImportRepository(interlinearProjectId: string): AnalysisRepository;
  /** The platform's interface languages, most preferred first. */
  getInterfaceLanguages(): Promise<string[]>;
  /** Starts reading the source project's whole text afresh, without waiting on the read. */
  startTextRead(sourceProjectId: string): Promise<void>;
  /** Ends the source project's whole-text read. */
  stopTextRead(sourceProjectId: string): Promise<void>;
  /**
   * The source project's book as `segmentation` segments it, or `undefined` when the host holds no
   * tokenized copy of the book. Reads nothing.
   */
  heldBook(
    sourceProjectId: string,
    bookId: string,
    segmentation: SegmentationDelta | undefined,
  ): Book | undefined;
  /** Tells listeners what a change to a session's analysis touched. */
  reportChange(change: SessionAnalysisChange): void;
}

/** How many of a session's latest replies it keeps, to answer an edit sent again. */
const KEPT_REPLIES = 16;

/**
 * Describes what an applied change touched, reading each book as segmented by the boundaries that
 * the change leaves.
 */
async function describeApplied(
  host: SessionHost,
  session: Session,
  applied: AppliedChange,
): Promise<AnalysisChange> {
  const { segmentation } = await session.repository.getScope();
  const { sourceProjectId } = session.scope;
  return describeChange(session.repository, applied, (bookId) =>
    host.heldBook(sourceProjectId, bookId, segmentationForBook(segmentation, bookId)),
  );
}

/** Reports `change` unless it touched nothing. */
function report(host: SessionHost, session: Session, change: AnalysisChange, changeId: string) {
  if (change.books.length === 0 && change.analysisIds.length === 0 && change.queries.length === 0)
    return;
  host.reportChange({ sessionId: session.id, changeId, ...change });
}

/**
 * Returns what an applied change touched, and reports that unless the change touched nothing. Reads
 * each book as segmented by the boundaries that the change leaves.
 */
async function reportApplied(
  host: SessionHost,
  session: Session,
  applied: AppliedChange,
  changeId: string,
): Promise<AnalysisChange> {
  const change = await describeApplied(host, session, applied);
  report(host, session, change, changeId);
  return change;
}

/** Replies to an applied change, reporting what it touched. */
async function replyTo(
  host: SessionHost,
  session: Session,
  applied: AppliedChange,
  changeId: string,
): Promise<CommandReply> {
  const { books } = await reportApplied(host, session, applied, changeId);
  const pool = await readTouchedPoolBuckets(session.repository, applied);
  return {
    changeId,
    changes: applied.changes,
    ...pool,
    resegmentedBooks: booksResegmented(applied),
    staleTranslationBooks: books
      .filter(({ staleTranslations }) => staleTranslations)
      .map(({ bookId }) => bookId),
    canUndo: session.history.canUndo,
    canRedo: session.history.canRedo,
  };
}

/**
 * Re-anchors the session's draft to `book`, reporting what the pass changed, or adding it to
 * `unreported` when given. The pass is recorded in the session's history only when the draft linked
 * into the book or held boundary edits in it, so an undo or redo re-anchors only those books.
 */
async function reanchorNow(
  host: SessionHost,
  session: Session,
  book: Book,
  unreported?: AnalysisChange[],
): Promise<void> {
  const { heldAnalysis, applied } = await reanchorStoredBook(session.repository, book);
  if (heldAnalysis) session.history.recordPass(book);
  if (!applied) return;
  const change = await describeApplied(host, session, applied);
  if (unreported) unreported.push(change);
  else report(host, session, change, crypto.randomUUID());
}

/**
 * Applies an edit's staged changes as one undo step, re-anchored to `reanchorTo`.
 *
 * @throws As {@link AnalysisSessions.edit} does.
 */
async function applyStaged(
  session: Session,
  buffer: ChangeBuffer,
  staged: ChangeSet,
  reanchorTo: void | readonly Book[],
  options: Pick<EditOptions, 'unsavedMark'> & Pick<SessionEditOptions, 'step'>,
): Promise<AppliedChange & { step?: EditStep }> {
  await assertApprovalRule(buffer, session.repository);
  const scope = staged.scope ?? (await session.repository.getScope());
  if (scope.analysisLanguages.length === 0) {
    staged.scope = { ...scope, analysisLanguages: [session.analysisLanguage] };
  }
  const reanchored =
    reanchorTo && reanchorTo.length > 0
      ? await reanchorRestored(session.repository)(staged, reanchorTo)
      : undefined;
  const changes = reanchored ? mergeChangeSets(staged, reanchored) : staged;
  const { unsavedMark } = options;
  const step = typeof options.step === 'function' ? options.step(changes) : options.step;
  const inverse = await session.history.apply(changes, { unsavedMark, step });
  return { changes, inverse, ...(step && { step }) };
}

/** Runs `step`, calling `markApplied` when the session's history applied anything meanwhile. */
async function noticingApplies<T>(
  session: Session,
  markApplied: () => void,
  step: () => Promise<T>,
): Promise<T> {
  const before = session.history.applied;
  try {
    return await step();
  } finally {
    if (session.history.applied !== before) markApplied();
  }
}

type OpenSession = {
  session: Session;
  /** Settles once every command sent to the session so far has settled; never rejects. */
  queue: Promise<unknown>;
  /** Settles once the session is closed; set from the moment a close is sent. */
  closed?: Promise<void>;
  /**
   * The latest replies, by change id, oldest first. A reply that rejects before its change applied
   * anything is dropped.
   */
  replies: Map<string, Promise<EditReply | undefined>>;
  /** What each pass to a book's edited text changed, by book, until the edit is reported. */
  editPasses: Map<string, AnalysisChange[]>;
};

/**
 * The open sessions, at most one per source project. Each runs the commands sent to it one at a
 * time, in the order they were sent.
 */
export class AnalysisSessions {
  private readonly host: SessionHost;

  private readonly sessions = new Map<string, OpenSession>();

  private readonly sessionsBySource = new Map<string, OpenSession>();

  /**
   * Each source project's opens and closes, chained so an open never interleaves with the close of
   * the session it replaces.
   */
  private readonly lifecycles = new Map<string, Promise<unknown>>();

  private queuedPasses = 0;

  constructor(host: SessionHost) {
    this.host = host;
  }

  /**
   * Opens a session read-only on `interlinearProjectId` when it names a Paratext 9 import,
   * otherwise on the source project's draft, which saves to `interlinearProjectId` when given.
   * Opening closes the source's earlier session, if any. The new session starts on what storage
   * holds, with nothing to undo. Its first command waits while the repository builds its indexes.
   * Opening also starts a fresh read of the source's whole text, which lasts until the session
   * closes.
   *
   * The session starts on the opened draft's first analysis language. When the draft lists none, it
   * starts on the platform's first interface language, or {@link UNDETERMINED_LANGUAGE} when the
   * platform lists none either.
   *
   * @throws {Error} If the source project has no interlinear project `interlinearProjectId`.
   * @throws Whatever finding the project or loading the scope's analysis throws; the source is left
   *   with no session.
   */
  open(sourceProjectId: string, interlinearProjectId?: string): Promise<OpenedSession> {
    return this.onLifecycle(sourceProjectId, async () => {
      const replaced = this.sessionsBySource.get(sourceProjectId);
      if (replaced) await this.closeNow(replaced);

      const scope = await this.resolveScope(sourceProjectId, interlinearProjectId);
      const repository =
        scope.kind === 'pt9Import'
          ? this.host.openPt9ImportRepository(scope.interlinearProjectId)
          : this.host.openDraftRepository(sourceProjectId);
      const { draft: opened } = await repository.exportAll();
      const session: Session = {
        id: crypto.randomUUID(),
        scope,
        repository,
        history: new EditHistory(repository, reanchorRestored(repository)),
        analysisLanguage:
          opened.analysisLanguages[0] ??
          ((await this.host.getInterfaceLanguages())[0] || UNDETERMINED_LANGUAGE),
      };
      const entry: OpenSession = {
        session,
        queue: Promise.resolve(),
        replies: new Map(),
        editPasses: new Map(),
      };
      this.sessions.set(session.id, entry);
      this.sessionsBySource.set(sourceProjectId, entry);
      // Builds the indexes ahead of the first command; the next lookup retries a failed build.
      this.run(session.id, () => repository.getScope()).catch(() => {});
      await this.host.startTextRead(sourceProjectId);
      return {
        sessionId: session.id,
        readOnly: repository.capabilities.readOnly,
        hasFreeTranslations: analysisHasFreeTranslations(opened.analysis),
      };
    });
  }

  /**
   * Closes the session, refusing every command sent to it from now on. Resolves once the commands
   * sent before have settled and its repository is released. Closing a session that is not open
   * does nothing.
   */
  close(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return Promise.resolve();
    entry.closed ??= this.onLifecycle(entry.session.scope.sourceProjectId, () =>
      this.closeNow(entry),
    );
    return entry.closed;
  }

  /**
   * Closes every session, including any whose open is still underway. Settles after every close has
   * settled.
   *
   * @throws Whatever a failing close throws.
   */
  async closeAll(): Promise<void> {
    await Promise.all(this.lifecycles.values());
    await settleAll([...this.sessions.keys()].map((sessionId) => this.close(sessionId)));
  }

  /**
   * Sets the language that the session's glosses are read and written in, unchecked against the
   * languages its draft lists. A read-only session takes it too, since it changes nothing stored.
   *
   * @throws {Error} If the session is not open.
   */
  setAnalysisLanguage(sessionId: string, analysisLanguage: string): Promise<void> {
    return this.run(sessionId, async (session) => {
      session.analysisLanguage = analysisLanguage;
    });
  }

  /**
   * Runs `command` on the session once every command sent to it before has settled.
   *
   * @throws {Error} If the session is not open.
   * @throws Whatever `command` throws; later commands still run.
   */
  run<T>(sessionId: string, command: (session: Session) => Promise<T>): Promise<T> {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.closed) {
      return Promise.reject(new Error(`Interlinearizer: no session ${sessionId} is open`));
    }
    const result = entry.queue.then(() => command(entry.session));
    entry.queue = result.catch(() => {});
    return result;
  }

  /**
   * Runs `edit` as {@link run} does, refusing it on a read-only session without running it.
   *
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {Error} If the session is not open.
   * @throws Whatever `edit` throws; later commands still run.
   */
  runEdit<T>(sessionId: string, edit: (session: Session) => Promise<T>): Promise<T> {
    if (this.sessions.get(sessionId)?.session.repository.capabilities.readOnly) {
      return Promise.reject(
        new ReadOnlyAnalysisError(`Interlinearizer: session ${sessionId} is read-only`),
      );
    }
    return this.run(sessionId, edit);
  }

  /**
   * Runs `command` as one edit of the session's analysis, in the session's turn. What it stages
   * applies as one undo step, marking the draft unsaved unless `options` says otherwise. A command
   * staging nothing applies nothing. When the draft lists no analysis languages, the step adds the
   * session's analysis language.
   *
   * When `command` returns books to re-anchor to, the step also re-anchors the draft, as the staged
   * changes leave it, to each book's text in turn.
   *
   * Reports what the changes touched. An edit sent again under a change id that the session has
   * applied gets that edit's reply, or its error, and applies nothing.
   *
   * @returns The changes applied, naming `intent`, with the pool buckets they touched, the step
   *   they were recorded as, and what else `command` returns besides the books to re-anchor to.
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {ApprovalRuleError} If the changes would give a token or segment a second approved
   *   link, or put a token in a second approved phrase; nothing is applied.
   * @throws {Error} If the session is not open.
   * @throws Whatever the command, reading the draft, or applying its changes throws; nothing is
   *   applied.
   * @throws Whatever reading the touched pool buckets or describing the change throws; the changes
   *   stay applied.
   * @throws Whatever marking the draft saved throws; the changes stay applied.
   */
  async edit(
    sessionId: string,
    intent: string,
    command: (buffer: ChangeBuffer, session: Session) => Promise<void | EditOutcome>,
    options?: SessionEditOptions,
  ): Promise<EditReply> {
    const { changeId = crypto.randomUUID(), unsavedMark, step } = options ?? {};
    const reply = await this.once(sessionId, changeId, (markApplied) =>
      this.runEdit(sessionId, (session) =>
        noticingApplies(session, markApplied, async (): Promise<EditReply> => {
          const editOptions = {
            unsavedMark: typeof unsavedMark === 'function' ? unsavedMark(session) : unsavedMark,
            step,
          };
          const buffer = new ChangeBuffer(session.repository);
          const { reanchorTo, ...extra } = (await command(buffer, session)) ?? {};
          const staged = buffer.toChangeSet(intent);
          if (!isEmptyChangeSet(staged)) {
            const applied = await applyStaged(session, buffer, staged, reanchorTo, editOptions);
            const answered = await replyTo(this.host, session, applied, changeId);
            return { ...answered, ...(applied.step && { step: applied.step }), ...extra };
          }
          if (editOptions.unsavedMark === 'clear') await session.history.markRestoredClean();
          return {
            changeId,
            changes: staged,
            poolBuckets: {},
            poolAnalyses: [],
            resegmentedBooks: [],
            staleTranslationBooks: [],
            canUndo: session.history.canUndo,
            canRedo: session.history.canRedo,
            ...extra,
          };
        }),
      ),
    );
    /* v8 ignore next -- defensive: only a caller reusing the change id of an empty undo gets none */
    if (!reply) throw new Error(`Interlinearizer: change ${changeId} was not an edit`);
    return reply;
  }

  /**
   * Stages `command` in the session's turn and reports what it would change, applying nothing. A
   * read-only session answers too.
   *
   * @returns The changes `command` staged, naming `intent`.
   * @throws {Error} If the session is not open.
   * @throws Whatever the command throws.
   */
  preview(
    sessionId: string,
    intent: string,
    command: (buffer: ChangeBuffer, session: Session) => Promise<unknown>,
  ): Promise<ChangeSet> {
    return this.run(sessionId, async (session) => {
      const buffer = new ChangeBuffer(session.repository);
      await command(buffer, session);
      return buffer.toChangeSet(intent);
    });
  }

  /**
   * Reverts the session's latest edit not yet undone, re-anchoring what it restores to the current
   * text of each book re-anchored since. Marks the draft saved when it restores content the draft
   * was saved with, and unsaved otherwise.
   *
   * Reports what the undo touched under `changeId`, named afresh when absent. An undo sent again
   * under a change id the session has applied gets that undo's reply, or its error, undoing nothing
   * more.
   *
   * @returns The changes that reverted the edit and re-anchored what the undo restored, with the
   *   pool buckets they touched, or `undefined` when there is none.
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {Error} If the session is not open.
   * @throws Whatever re-anchoring or applying the changes throws; nothing is applied, and the edit
   *   stays the next to undo.
   * @throws Whatever reading the touched pool buckets or describing the change throws; the undo
   *   stays applied.
   * @throws Whatever marking the draft saved throws; the undo stays applied.
   */
  undo(
    sessionId: string,
    changeId: string = crypto.randomUUID(),
  ): Promise<CommandReply | undefined> {
    return this.moveThroughHistory(sessionId, changeId, (history) => history.undo());
  }

  /**
   * Redoes the session's latest undone edit, re-anchoring what it restores to the current text of
   * each book re-anchored since. Marks the draft saved when it restores content the draft was saved
   * with, and unsaved otherwise.
   *
   * Reports what the redo touched under `changeId`, named afresh when absent. A redo sent again
   * under a change id the session has applied gets that redo's reply, or its error, redoing nothing
   * more.
   *
   * @returns The changes that redid the edit and re-anchored what the redo restored, with the pool
   *   buckets they touched, or `undefined` when there is none.
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {Error} If the session is not open.
   * @throws Whatever re-anchoring or applying the changes throws; nothing is applied, and the edit
   *   stays the next to redo.
   * @throws Whatever reading the touched pool buckets or describing the change throws; the redo
   *   stays applied.
   * @throws Whatever marking the draft saved throws; the redo stays applied.
   */
  redo(
    sessionId: string,
    changeId: string = crypto.randomUUID(),
  ): Promise<CommandReply | undefined> {
    return this.moveThroughHistory(sessionId, changeId, (history) => history.redo());
  }

  /**
   * In the session's turn, sets the project that the session's draft saves to:
   * `interlinearProjectId`, or none when it is absent. What there is to undo is kept.
   *
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {Error} If the session is not open, the source project has no interlinear project
   *   `interlinearProjectId`, or that project is a Paratext 9 import; the target is left as it
   *   was.
   * @throws Whatever finding the project throws; the target is left as it was.
   */
  setSaveTarget(sessionId: string, interlinearProjectId: string | undefined): Promise<void> {
    return this.runEdit(sessionId, async (session) => {
      const scope = await this.resolveScope(session.scope.sourceProjectId, interlinearProjectId);
      if (scope.kind === 'pt9Import')
        throw new Error(
          `Interlinearizer: cannot save a draft to the Paratext 9 import ${interlinearProjectId}`,
        );
      session.scope = scope;
    });
  }

  /**
   * In the session's turn, leaves the session's draft with no project to save to, now that its
   * project is deleted. No state that the history holds counts as saved any more, and the draft is
   * marked unsaved. The exception is an empty, saved draft, which has nothing to lose and stays
   * saved.
   *
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {Error} If the session is not open.
   * @throws Whatever reading the draft or marking it unsaved throws.
   */
  detachFromProject(sessionId: string): Promise<void> {
    return this.runEdit(sessionId, async (session) => {
      session.scope = { kind: 'draft', sourceProjectId: session.scope.sourceProjectId };
      const { analysis, segmentation, dirty } = await session.repository.getWholeDraft();
      const empty =
        Object.values(analysis).every((records) => records.length === 0) &&
        isEmptyDelta(segmentation);
      session.history.forgetSaves(empty && !dirty);
      if (!empty && !dirty) await session.repository.apply({ intent: 'detachFromProject' });
    });
  }

  /** The id of the session open on the source project, or `undefined` when the source has none open. */
  sessionIdFor(sourceProjectId: string): string | undefined {
    return this.sessionsBySource.get(sourceProjectId)?.session.id;
  }

  /**
   * Re-anchors the draft of the source project's session to `book`'s current text, in the session's
   * turn and as no undo step. Where the draft links into the book or holds boundary edits in it,
   * what a later undo or redo restores is re-anchored to it too. A book the text lacks is passed as
   * a book with no segments. Does nothing when the source has no session open, or only a read-only
   * one. When `edited`, what the pass changes is reported with the edit to the book's text, by
   * {@link reportScriptureEdit}, rather than on its own.
   *
   * @throws Whatever reading the draft or applying the changes throws; nothing is applied.
   * @throws Whatever describing the applied changes throws; the changes stay applied.
   */
  reanchorBook(sourceProjectId: string, book: Book, edited = false): Promise<void> {
    return this.runOnWritable(sourceProjectId, ({ session, editPasses }) => {
      if (!edited) return reanchorNow(this.host, session, book);
      const unreported = editPasses.get(book.bookRef) ?? [];
      editPasses.set(book.bookRef, unreported);
      return reanchorNow(this.host, session, book, unreported);
    });
  }

  /**
   * Reports an edit to the source project's book through the session open on the source, in that
   * session's turn. The report names the book whole, along with what each pass to the edited text
   * changed. Does nothing when the source has no session open.
   *
   * @throws {Error} If the session is closing.
   */
  reportScriptureEdit(sourceProjectId: string, bookId: string): Promise<void> {
    const entry = this.sessionsBySource.get(sourceProjectId);
    if (!entry) return Promise.resolve();
    return this.run(entry.session.id, async (session) => {
      const passes = entry.editPasses.get(bookId) ?? [];
      entry.editPasses.delete(bookId);
      report(this.host, session, describeScriptureEdit(bookId, passes), crypto.randomUUID());
    });
  }

  /**
   * Re-anchors the draft of the source project's session, as {@link reanchorBook} does, to each book
   * the text lacks. A book the text lacks is a linked book that `textBookIds` does not list.
   *
   * @throws Whatever reading the draft or applying the changes throws; the books before stay
   *   re-anchored.
   */
  reanchorMissingBooks(sourceProjectId: string, textBookIds: readonly string[]): Promise<void> {
    return this.runOnWritable(sourceProjectId, async ({ session }) => {
      const missing = booksMissingFrom(await session.repository.findLinkedBooks(), textBookIds);
      await missing.reduce<Promise<void>>(
        (previous, bookCode) =>
          previous.then(() => reanchorNow(this.host, session, missingBook(bookCode))),
        Promise.resolve(),
      );
    });
  }

  /** How many re-anchor passes, across every session, are queued or running. */
  passesPending(): number {
    return this.queuedPasses;
  }

  /**
   * Settles once every command sent so far to the source project's session has settled, at once
   * when the source has no session open. Never rejects.
   */
  async settled(sourceProjectId: string): Promise<void> {
    await this.sessionsBySource.get(sourceProjectId)?.queue;
  }

  /** Moves through the session's history by `move`, as {@link undo} describes. */
  private moveThroughHistory(
    sessionId: string,
    changeId: string,
    move: (history: EditHistory) => Promise<HistoryMove | undefined>,
  ): Promise<CommandReply | undefined> {
    return this.once(sessionId, changeId, (markApplied) =>
      this.runEdit(sessionId, (session) =>
        noticingApplies(session, markApplied, async () => {
          const moved = await move(session.history);
          if (!moved) return undefined;
          const reply = await replyTo(this.host, session, moved, changeId);
          return moved.step ? { ...reply, step: moved.step } : reply;
        }),
      ),
    );
  }

  /**
   * Answers with the reply to `changeId`, running `send` only when the session keeps no reply to
   * that change id. Forgets a reply that rejects before `send` marks its change applied, so that
   * the change can be sent again. Keeps one that rejects after, so that sending it again applies
   * nothing.
   */
  private once<R extends EditReply | undefined>(
    sessionId: string,
    changeId: string,
    send: (markApplied: () => void) => Promise<R>,
  ): Promise<R | EditReply | undefined> {
    let applied = false;
    const entry = this.sessions.get(sessionId);
    const kept = entry?.replies.get(changeId);
    if (kept) return kept;
    const reply = send(() => {
      applied = true;
    });
    if (!entry) return reply;
    entry.replies.set(changeId, reply);
    if (entry.replies.size > KEPT_REPLIES) entry.replies.delete([...entry.replies.keys()][0]);
    reply.catch(() => {
      if (!applied && entry.replies.get(changeId) === reply) entry.replies.delete(changeId);
    });
    return reply;
  }

  /**
   * Runs the re-anchor pass `command` on the source project's session unless it has none open or
   * only a read-only one. The pass counts toward {@link passesPending} until it settles.
   */
  private runOnWritable(
    sourceProjectId: string,
    command: (entry: OpenSession) => Promise<void>,
  ): Promise<void> {
    const entry = this.sessionsBySource.get(sourceProjectId);
    if (!entry || entry.session.repository.capabilities.readOnly) return Promise.resolve();
    this.queuedPasses += 1;
    return this.run(entry.session.id, () => command(entry)).finally(() => {
      this.queuedPasses -= 1;
    });
  }

  /**
   * Resolves the scope for a session on the source project, paired with `interlinearProjectId` when
   * given.
   *
   * @throws {Error} If the source project has no interlinear project `interlinearProjectId`.
   */
  private async resolveScope(
    sourceProjectId: string,
    interlinearProjectId: string | undefined,
  ): Promise<SessionScope> {
    if (interlinearProjectId === undefined) return { kind: 'draft', sourceProjectId };
    const project = await this.host.findProject(sourceProjectId, interlinearProjectId);
    if (!project) {
      throw new Error(
        `Interlinearizer: source project ${sourceProjectId} has no interlinear project ${interlinearProjectId}`,
      );
    }
    return {
      kind: project.pt9Import ? 'pt9Import' : 'draft',
      sourceProjectId,
      interlinearProjectId,
    };
  }

  /**
   * Makes the session unreachable by id or source, then, once the commands sent to it have settled,
   * ends the source's whole-text read and, for a draft, releases its repository. A session that an
   * earlier step already closed is left alone, so its repository is released only once.
   */
  private async closeNow(entry: OpenSession): Promise<void> {
    const { id, scope } = entry.session;
    if (this.sessions.get(id) !== entry) return;
    this.sessions.delete(id);
    this.sessionsBySource.delete(scope.sourceProjectId);
    await entry.queue;
    await this.host.stopTextRead(scope.sourceProjectId);
    if (scope.kind === 'draft') await this.host.releaseDraftRepository(scope.sourceProjectId);
  }

  /** Runs `step` once every open and close of the source project enqueued before has settled. */
  private onLifecycle<T>(sourceProjectId: string, step: () => Promise<T>): Promise<T> {
    const result = (this.lifecycles.get(sourceProjectId) ?? Promise.resolve()).then(step);
    let settled: Promise<void>;
    const cleanup = () => {
      if (this.lifecycles.get(sourceProjectId) === settled) this.lifecycles.delete(sourceProjectId);
    };
    settled = result.then(cleanup, cleanup);
    this.lifecycles.set(sourceProjectId, settled);
    return result;
  }
}
