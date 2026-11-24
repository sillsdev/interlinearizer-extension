import type {
  ChangeId,
  InterlinearProject,
  ReadonlyBook,
  RemovalPreviewRequest,
  TokenSnapshot,
} from 'interlinearizer';
import type { CommandHandlers } from 'papi-shared-types';
import type { AnalysisSessions, EditOutcome, Session } from './analysisSessions';
import type * as bookService from './bookService';
import * as boundaryCommands from './commands/boundaryCommands';
import * as catalogCommands from './commands/catalogCommands';
import { ChangeBuffer } from './commands/changeBuffer';
import * as discardCommands from './commands/discardCommands';
import * as freeTranslationCommands from './commands/freeTranslationCommands';
import * as languageCommands from './commands/languageCommands';
import * as morphemeCommands from './commands/morphemeCommands';
import * as phraseCommands from './commands/phraseCommands';
import * as staleCommands from './commands/staleCommands';
import * as tokenCommands from './commands/tokenCommands';
import type { EditOptions } from './editHistory';
import { catalogStepOf, deletionStepOf, phraseStartOf } from './editSteps';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only for its doc links
import type { CommandReply } from '../types/command-reply';
import type { EditStep, StepSummary } from '../types/edit-step';
import { bookOfRef } from '../utils/analysis-book';
import { bookIndexesOf } from '../utils/book-indexes';
import { readEditOutcome, type AnalysisEditOutcome } from '../utils/edit-outcome';
import { perfTime, perfTimeAsync } from '../utils/perf-marks';
import { missingBook } from '../utils/reanchor-analysis';

/** The one argument that the command `C` takes. */
type ArgsOf<C extends keyof CommandHandlers> = Parameters<CommandHandlers[C]>[0];

/**
 * The session an edit is sent to, the change id it is sent under, and the step to record it as. A
 * command may set the step while it stages, once it has read what the step names.
 */
type EditTarget = {
  sessionId: string;
  changeId?: ChangeId;
  step?: EditStep;
};

/** What the session edit handlers reach beyond the sessions' analysis. */
export type SessionEditHost = Readonly<{
  sessions: AnalysisSessions;
  logger: Readonly<{ error: (message: string, error: unknown) => void }>;
  getSegmentedBook: typeof bookService.getSegmentedBook;
  getVerseBook: typeof bookService.getVerseBook;
  /** The stored interlinear project with this id, or `undefined` when none is stored. */
  getProject: (interlinearProjectId: string) => Promise<InterlinearProject | undefined>;
}>;

/**
 * The handlers of the commands that edit a session's analysis, or preview an edit, keyed by command
 * name.
 */
export function sessionEditHandlers({
  sessions,
  logger,
  getSegmentedBook,
  getVerseBook,
  getProject,
}: SessionEditHost) {
  /**
   * Runs `command` as one edit of a session's analysis.
   *
   * @returns A JSON string of the {@link CommandReply}.
   * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
   *   logged before rethrowing.
   */
  async function runSessionEdit(
    target: EditTarget,
    intent: string,
    command: (buffer: ChangeBuffer, session: Session) => Promise<void | EditOutcome>,
  ): Promise<string> {
    const { sessionId, changeId } = target;
    try {
      return await perfTimeAsync(
        intent,
        async () => {
          const reply = await sessions.edit(sessionId, intent, command, {
            changeId,
            step: () => target.step,
          });
          return perfTime(`${intent}:serialize`, () => JSON.stringify(reply));
        },
        { startedAt: performance.timeOrigin + performance.now() },
      );
    } catch (e) {
      logger.error(`Interlinearizer: failed to ${intent} in session ${sessionId}`, e);
      throw e;
    }
  }

  /** Fresh ids for the records an edit may make, and the time the edit lands. */
  function editStamp() {
    return {
      analysisId: crypto.randomUUID(),
      linkId: crypto.randomUUID(),
      forkId: crypto.randomUUID(),
      now: new Date().toISOString(),
    };
  }

  /**
   * Where the catalog edit staged in `buffer` left `analysisId`, given the analysis that the edit
   * says holds its content afterward.
   */
  async function catalogOutcomeOf(
    buffer: ChangeBuffer,
    analysisId: string,
    survivingAnalysisId: string | undefined,
    analysisLanguage: string,
  ): Promise<AnalysisEditOutcome> {
    const ids =
      survivingAnalysisId === undefined ? [analysisId] : [analysisId, survivingAnalysisId];
    const tokenAnalysisLinks =
      survivingAnalysisId === undefined
        ? []
        : (await buffer.findLinksToAnalyses([survivingAnalysisId])).tokenAnalysisLinks;
    return readEditOutcome(
      { tokenAnalyses: await buffer.getTokenAnalyses(ids), tokenAnalysisLinks },
      survivingAnalysisId,
      analysisId,
      analysisLanguage,
    );
  }

  /**
   * Runs a catalog edit aimed at `analysisId`. The edit stages its changes and resolves to the
   * analysis that holds the edited content afterward. The undo step is placed at that analysis.
   *
   * @returns A JSON string of the {@link CommandReply}, with `outcome`: where the edit left its
   *   record.
   * @throws As {@link runSessionEdit} does.
   */
  function runCatalogEdit(
    target: EditTarget,
    intent: string,
    kind: Parameters<typeof catalogStepOf>[1],
    analysisId: string,
    edit: (buffer: ChangeBuffer, session: Session) => Promise<string | undefined>,
  ): Promise<string> {
    return runSessionEdit(target, intent, async (buffer, session) => {
      const stepOf = await catalogStepOf(buffer, kind, analysisId);
      const survivor = await edit(buffer, session);
      target.step = stepOf(survivor);
      return {
        outcome: await catalogOutcomeOf(buffer, analysisId, survivor, session.analysisLanguage),
      };
    });
  }

  function writeGloss({
    sessionId,
    tokenRef,
    surfaceText,
    value,
    changeId,
  }: ArgsOf<'interlinearizer.writeGloss'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: tokenRef } },
      'writeGloss',
      (buffer, session) =>
        tokenCommands.writeGloss(buffer, {
          ...editStamp(),
          tokenRef,
          surfaceText,
          value,
          analysisLanguage: session.analysisLanguage,
        }),
    );
  }

  function approveAnalysisForToken({
    sessionId,
    tokenRef,
    surfaceText,
    analysisId,
    changeId,
  }: ArgsOf<'interlinearizer.approveAnalysisForToken'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: tokenRef } },
      'approveAnalysisForToken',
      (buffer) =>
        tokenCommands.approveAnalysisForToken(buffer, {
          ...editStamp(),
          tokenRef,
          surfaceText,
          analysisId,
        }),
    );
  }

  function writeMorphemes({
    sessionId,
    tokenRef,
    surfaceText,
    forms,
    writingSystem,
    changeId,
  }: ArgsOf<'interlinearizer.writeMorphemes'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: tokenRef } },
      'writeMorphemes',
      (buffer) =>
        morphemeCommands.writeMorphemes(buffer, {
          ...editStamp(),
          tokenRef,
          surfaceText,
          writingSystem,
          morphemes: forms.map((form) => ({ id: crypto.randomUUID(), form })),
        }),
    );
  }

  function deleteMorphemes({
    sessionId,
    tokenRef,
    changeId,
  }: ArgsOf<'interlinearizer.deleteMorphemes'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: tokenRef } },
      'deleteMorphemes',
      (buffer) => morphemeCommands.deleteMorphemes(buffer, { ...editStamp(), tokenRef }),
    );
  }

  function writeMorphemeGloss({
    sessionId,
    tokenRef,
    morphemeId,
    value,
    changeId,
  }: ArgsOf<'interlinearizer.writeMorphemeGloss'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: tokenRef } },
      'writeMorphemeGloss',
      (buffer, session) =>
        morphemeCommands.writeMorphemeGloss(buffer, {
          ...editStamp(),
          tokenRef,
          morphemeId,
          value,
          analysisLanguage: session.analysisLanguage,
        }),
    );
  }

  function discardStaleAnalysis({
    sessionId,
    analysisId,
    tokenRef,
    changeId,
  }: ArgsOf<'interlinearizer.discardStaleAnalysis'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId },
      'discardStaleAnalysis',
      stageDiscardStaleAnalysis({ analysisId, tokenRef }),
    );
  }

  function reapplyStaleAnalysis({
    sessionId,
    analysisId,
    staleTokenRef,
    tokenRef,
    surfaceText,
    changeId,
  }: ArgsOf<'interlinearizer.reapplyStaleAnalysis'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId },
      'reapplyStaleAnalysis',
      stageReapplyStaleAnalysis({ analysisId, staleTokenRef, tokenRef, surfaceText }),
    );
  }

  function keepStaleFreeTranslation({
    sessionId,
    analysisId,
    segmentId,
    surfaceText,
    changeId,
  }: ArgsOf<'interlinearizer.keepStaleFreeTranslation'>): Promise<string> {
    return runSessionEdit({ sessionId, changeId }, 'keepStaleFreeTranslation', (buffer) =>
      staleCommands.keepStaleFreeTranslation(buffer, {
        analysisId,
        segmentId,
        surfaceText,
        now: editStamp().now,
      }),
    );
  }

  function discardStaleFreeTranslation({
    sessionId,
    analysisId,
    changeId,
  }: ArgsOf<'interlinearizer.discardStaleFreeTranslation'>): Promise<string> {
    return runSessionEdit({ sessionId, changeId }, 'discardStaleFreeTranslation', (buffer) =>
      staleCommands.discardStaleFreeTranslation(buffer, { analysisId }),
    );
  }

  function writeAnalysisGloss({
    sessionId,
    analysisId,
    value,
    changeId,
  }: ArgsOf<'interlinearizer.writeAnalysisGloss'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'writeAnalysisGloss',
      'catalogEdit',
      analysisId,
      (buffer, session) =>
        catalogCommands.writeAnalysisGloss(buffer, {
          analysisId,
          value,
          analysisLanguage: session.analysisLanguage,
          now: editStamp().now,
        }),
    );
  }

  function clearAnalysisGlosses({
    sessionId,
    analysisIds,
    changeId,
  }: ArgsOf<'interlinearizer.clearAnalysisGlosses'>): Promise<string> {
    const step = {
      summary: { kind: 'catalogClearGlossChecked', count: analysisIds.length },
    } as const;
    const stage = stageClearAnalysisGlosses({ analysisIds });
    return runSessionEdit(
      { sessionId, changeId, step },
      'clearAnalysisGlosses',
      async (buffer, session) => ({ emptiedAnalysisIds: await stage(buffer, session) }),
    );
  }

  function writeAnalysisMorphemes({
    sessionId,
    analysisId,
    forms,
    writingSystem,
    changeId,
  }: ArgsOf<'interlinearizer.writeAnalysisMorphemes'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'writeAnalysisMorphemes',
      'catalogEdit',
      analysisId,
      (buffer) =>
        catalogCommands.writeAnalysisMorphemes(buffer, {
          analysisId,
          morphemes: forms.map((form) => ({ id: crypto.randomUUID(), form })),
          writingSystem,
          now: editStamp().now,
        }),
    );
  }

  function confirmAnalysisMorphemes({
    sessionId,
    analysisId,
    tokenRef,
    changeId,
  }: ArgsOf<'interlinearizer.confirmAnalysisMorphemes'>): Promise<string> {
    const target: EditTarget = { sessionId, changeId };
    return runSessionEdit(target, 'confirmAnalysisMorphemes', async (buffer) => {
      target.step = tokenRef
        ? { location: tokenRef }
        : (await catalogStepOf(buffer, 'catalogEdit', analysisId))(analysisId);
      await catalogCommands.confirmAnalysisMorphemes(buffer, { analysisId, now: editStamp().now });
    });
  }

  function writeAnalysisMorphemeGloss({
    sessionId,
    analysisId,
    morphemeId,
    value,
    changeId,
  }: ArgsOf<'interlinearizer.writeAnalysisMorphemeGloss'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'writeAnalysisMorphemeGloss',
      'catalogEdit',
      analysisId,
      (buffer, session) =>
        catalogCommands.writeAnalysisMorphemeGloss(buffer, {
          analysisId,
          morphemeId,
          value,
          analysisLanguage: session.analysisLanguage,
          now: editStamp().now,
        }),
    );
  }

  function linkAnalysisSense({
    sessionId,
    analysisId,
    senseRef,
    changeId,
  }: ArgsOf<'interlinearizer.linkAnalysisSense'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'linkAnalysisSense',
      'catalogLinkSense',
      analysisId,
      (buffer) =>
        catalogCommands.linkAnalysisSense(buffer, {
          analysisId,
          senseRef,
          now: editStamp().now,
        }),
    );
  }

  function unlinkAnalysisSense({
    sessionId,
    analysisId,
    keepGloss,
    changeId,
  }: ArgsOf<'interlinearizer.unlinkAnalysisSense'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'unlinkAnalysisSense',
      'catalogUnlinkSense',
      analysisId,
      (buffer, session) =>
        catalogCommands.unlinkAnalysisSense(buffer, {
          analysisId,
          keepGloss,
          analysisLanguage: session.analysisLanguage,
          now: editStamp().now,
        }),
    );
  }

  function linkAnalysisMorphemeSense({
    sessionId,
    analysisId,
    morphemeId,
    entryRef,
    senseRef,
    changeId,
  }: ArgsOf<'interlinearizer.linkAnalysisMorphemeSense'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'linkAnalysisMorphemeSense',
      'catalogLinkSense',
      analysisId,
      (buffer) =>
        catalogCommands.linkAnalysisMorphemeSense(buffer, {
          analysisId,
          morphemeId,
          entryRef,
          senseRef,
          now: editStamp().now,
        }),
    );
  }

  function unlinkAnalysisMorphemeSense({
    sessionId,
    analysisId,
    morphemeId,
    keepGloss,
    changeId,
  }: ArgsOf<'interlinearizer.unlinkAnalysisMorphemeSense'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'unlinkAnalysisMorphemeSense',
      'catalogUnlinkSense',
      analysisId,
      (buffer, session) =>
        catalogCommands.unlinkAnalysisMorphemeSense(buffer, {
          analysisId,
          morphemeId,
          keepGloss,
          analysisLanguage: session.analysisLanguage,
          now: editStamp().now,
        }),
    );
  }

  function adoptAnalysisSenseGloss({
    sessionId,
    analysisId,
    value,
    changeId,
  }: ArgsOf<'interlinearizer.adoptAnalysisSenseGloss'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'adoptAnalysisSenseGloss',
      'catalogAdoptGloss',
      analysisId,
      (buffer, session) =>
        catalogCommands.adoptAnalysisSenseGloss(buffer, {
          analysisId,
          value,
          analysisLanguage: session.analysisLanguage,
          now: editStamp().now,
        }),
    );
  }

  function adoptAnalysisMorphemeSenseGloss({
    sessionId,
    analysisId,
    morphemeId,
    value,
    changeId,
  }: ArgsOf<'interlinearizer.adoptAnalysisMorphemeSenseGloss'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'adoptAnalysisMorphemeSenseGloss',
      'catalogAdoptGloss',
      analysisId,
      (buffer, session) =>
        catalogCommands.adoptAnalysisMorphemeSenseGloss(buffer, {
          analysisId,
          morphemeId,
          value,
          analysisLanguage: session.analysisLanguage,
          now: editStamp().now,
        }),
    );
  }

  function deleteAnalyses({
    sessionId,
    analysisIds,
    changeId,
  }: ArgsOf<'interlinearizer.deleteAnalyses'>): Promise<string> {
    const target: EditTarget = { sessionId, changeId };
    return runSessionEdit(target, 'deleteAnalyses', async (buffer, session) => {
      target.step = await deletionStepOf(buffer, session.repository, analysisIds);
      await catalogCommands.deleteAnalyses(buffer, { analysisIds });
    });
  }

  function mergeAnalysesInto({
    sessionId,
    survivorAnalysisId,
    mergedAnalysisIds,
    content,
    changeId,
  }: ArgsOf<'interlinearizer.mergeAnalysesInto'>): Promise<string> {
    return runCatalogEdit(
      { sessionId, changeId },
      'mergeAnalysesInto',
      'catalogMerge',
      survivorAnalysisId,
      (buffer, session) =>
        catalogCommands.mergeAnalysesInto(buffer, {
          survivorAnalysisId,
          mergedAnalysisIds,
          content,
          analysisLanguage: session.analysisLanguage,
          now: editStamp().now,
        }),
    );
  }

  /**
   * Refuses a phrase occurrence with no tokens; the analysis index files a phrase by the book of
   * its first token.
   *
   * @throws If `tokens` is empty.
   */
  function assertTokenRun(tokens: readonly TokenSnapshot[]): void {
    if (tokens.length === 0) throw new Error('Interlinearizer: a phrase needs at least one token');
  }

  /**
   * What `read` serves for the session's source project and the book that `tokenRef` falls in.
   *
   * @throws If the project has no text for that book, or `read` throws.
   */
  async function readBookOf<T>(
    session: Session,
    tokenRef: string,
    read: (sourceProjectId: string, bookId: string) => Promise<T | undefined>,
  ): Promise<T> {
    const bookId = bookOfRef(tokenRef);
    const { sourceProjectId } = session.scope;
    const found = await read(sourceProjectId, bookId);
    if (found === undefined) {
      throw new Error(`Interlinearizer: project ${sourceProjectId} has no text for book ${bookId}`);
    }
    return found;
  }

  /**
   * Refuses a phrase occurrence over `tokens` unless they lie within one segment of the text, as
   * the staged boundaries segment it.
   *
   * @throws If the tokens span segments or name a token the text lacks, the project has no text for
   *   the first token's book, or the book cannot be read or tokenized.
   */
  async function assertOneSegment(
    buffer: ChangeBuffer,
    session: Session,
    tokens: readonly TokenSnapshot[],
  ): Promise<void> {
    const { segmentation } = await buffer.getScope();
    const { segments } = await readBookOf(session, tokens[0].tokenRef, (sourceProjectId, bookId) =>
      getSegmentedBook(sourceProjectId, bookId, segmentation),
    );
    const { tokenSegmentMap } = bookIndexesOf(segments);
    const segmentIds = new Set(tokens.map(({ tokenRef }) => tokenSegmentMap.get(tokenRef)));
    if (segmentIds.size > 1 || segmentIds.has(undefined)) {
      throw new Error("Interlinearizer: a phrase's tokens must lie within one segment of the text");
    }
  }

  function createPhrase({
    sessionId,
    tokens,
    changeId,
  }: ArgsOf<'interlinearizer.createPhrase'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: tokens[0]?.tokenRef } },
      'createPhrase',
      async (buffer, session) => {
        assertTokenRun(tokens);
        await assertOneSegment(buffer, session, tokens);
        await phraseCommands.createPhrase(buffer, { ...editStamp(), tokens });
      },
    );
  }

  function updatePhrase({
    sessionId,
    phraseId,
    tokens,
    changeId,
  }: ArgsOf<'interlinearizer.updatePhrase'>): Promise<string> {
    const target: EditTarget = { sessionId, changeId };
    return runSessionEdit(target, 'updatePhrase', async (buffer, session) => {
      target.step =
        tokens.length > 0
          ? { location: tokens[0].tokenRef }
          : await phraseStartOf(buffer, phraseId);
      if (tokens.length > 0) await assertOneSegment(buffer, session, tokens);
      await phraseCommands.updatePhrase(buffer, { ...editStamp(), phraseId, tokens });
    });
  }

  function deletePhrase({
    sessionId,
    phraseId,
    changeId,
  }: ArgsOf<'interlinearizer.deletePhrase'>): Promise<string> {
    const target: EditTarget = { sessionId, changeId };
    return runSessionEdit(target, 'deletePhrase', async (buffer) => {
      target.step = await phraseStartOf(buffer, phraseId);
      await phraseCommands.deletePhrase(buffer, { phraseId });
    });
  }

  function mergePhrases({
    sessionId,
    targetPhraseId,
    tokens,
    absorbedPhraseId,
    changeId,
  }: ArgsOf<'interlinearizer.mergePhrases'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: tokens[0]?.tokenRef } },
      'mergePhrases',
      async (buffer, session) => {
        assertTokenRun(tokens);
        await assertOneSegment(buffer, session, tokens);
        await phraseCommands.mergePhrases(buffer, {
          ...editStamp(),
          targetPhraseId,
          tokens,
          absorbedPhraseId,
        });
      },
    );
  }

  function writePhraseGloss({
    sessionId,
    phraseId,
    value,
    changeId,
  }: ArgsOf<'interlinearizer.writePhraseGloss'>): Promise<string> {
    const target: EditTarget = { sessionId, changeId };
    return runSessionEdit(target, 'writePhraseGloss', async (buffer, session) => {
      target.step = await phraseStartOf(buffer, phraseId);
      await phraseCommands.writePhraseGloss(buffer, {
        ...editStamp(),
        phraseId,
        value,
        analysisLanguage: session.analysisLanguage,
      });
    });
  }

  function approvePhrase({
    sessionId,
    phraseId,
    changeId,
  }: ArgsOf<'interlinearizer.approvePhrase'>): Promise<string> {
    const target: EditTarget = { sessionId, changeId };
    return runSessionEdit(target, 'approvePhrase', async (buffer, session) => {
      target.step = await phraseStartOf(buffer, phraseId);
      const [link] = await buffer.getPhraseAnalysisLinks([phraseId]);
      if (link && link.status !== 'approved') await assertOneSegment(buffer, session, link.tokens);
      await phraseCommands.approvePhrase(buffer, { ...editStamp(), phraseId });
    });
  }

  /**
   * The book `tokenRef` falls in, read from the session's source project and tokenized one segment
   * per verse.
   *
   * @throws If the project has no text for that book, or the book cannot be read or tokenized.
   */
  function verseBookOf(session: Session, tokenRef: string): Promise<ReadonlyBook> {
    return readBookOf(session, tokenRef, getVerseBook);
  }

  function splitPhrase({
    sessionId,
    phraseId,
    splitAfterTokenRef,
    changeId,
  }: ArgsOf<'interlinearizer.splitPhrase'>): Promise<string> {
    const target: EditTarget = { sessionId, changeId };
    return runSessionEdit(target, 'splitPhrase', async (buffer, session) => {
      target.step = await phraseStartOf(buffer, phraseId);
      const verseBook = await verseBookOf(session, splitAfterTokenRef);
      await phraseCommands.splitPhrase(buffer, {
        ...editStamp(),
        phraseId,
        splitAfterTokenRef,
        tokenDocOrder: bookIndexesOf(verseBook.segments).tokenDocOrder,
      });
    });
  }

  function writeSegmentFreeTranslation({
    sessionId,
    segmentId,
    surfaceText,
    value,
    adoptStaleAnalysisId,
    changeId,
  }: ArgsOf<'interlinearizer.writeSegmentFreeTranslation'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: segmentId } },
      'writeSegmentFreeTranslation',
      (buffer, session) =>
        freeTranslationCommands.writeSegmentFreeTranslation(buffer, {
          ...editStamp(),
          segmentId,
          surfaceText,
          value,
          analysisLanguage: session.analysisLanguage,
          adoptStaleAnalysisId,
        }),
    );
  }

  /** The time a boundary edit lands, and a maker of fresh ids for the records it may make. */
  function boundaryEditStamp() {
    return { now: new Date().toISOString(), newId: () => crypto.randomUUID() };
  }

  function mergeSegments({
    sessionId,
    secondSegmentStartRef,
    changeId,
  }: ArgsOf<'interlinearizer.mergeSegments'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: secondSegmentStartRef } },
      'mergeSegments',
      async (buffer, session) => {
        const verseBook = await verseBookOf(session, secondSegmentStartRef);
        await boundaryCommands.mergeSegments(buffer, { verseBook, secondSegmentStartRef });
        return { reanchorTo: [verseBook] };
      },
    );
  }

  function splitSegment({
    sessionId,
    tokenRef,
    changeId,
  }: ArgsOf<'interlinearizer.splitSegment'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: tokenRef } },
      'splitSegment',
      async (buffer, session) => {
        const verseBook = await verseBookOf(session, tokenRef);
        await boundaryCommands.splitSegment(buffer, {
          ...boundaryEditStamp(),
          verseBook,
          tokenRef,
        });
        return { reanchorTo: [verseBook] };
      },
    );
  }

  function moveBoundary({
    sessionId,
    fromRef,
    toRef,
    changeId,
  }: ArgsOf<'interlinearizer.moveBoundary'>): Promise<string> {
    return runSessionEdit(
      { sessionId, changeId, step: { location: toRef } },
      'moveBoundary',
      async (buffer, session) => {
        const verseBook = await verseBookOf(session, toRef);
        await boundaryCommands.moveBoundary(buffer, {
          ...boundaryEditStamp(),
          verseBook,
          fromRef,
          toRef,
        });
        return { reanchorTo: [verseBook] };
      },
    );
  }

  /**
   * The project that the session's draft saves to, as a discard restores it, or `undefined` when
   * the draft has none.
   *
   * @throws If the project is not stored, or reading it fails.
   */
  async function savedContentOf(
    session: Session,
  ): Promise<discardCommands.SavedProject | undefined> {
    const { interlinearProjectId } = session.scope;
    if (interlinearProjectId === undefined) return undefined;
    const project = await getProject(interlinearProjectId);
    if (!project) {
      throw new Error(`Interlinearizer: interlinear project ${interlinearProjectId} is not stored`);
    }
    const { analysis, segmentation, analysisLanguages } = project;
    return { analysis, segmentation, analysisLanguages };
  }

  async function changeAnalysisLanguages({
    sessionId,
    analysisLanguages,
    retag,
    deleteTextOf,
    changeId,
  }: ArgsOf<'interlinearizer.changeAnalysisLanguages'>): Promise<string> {
    const intent = 'changeAnalysisLanguages';
    try {
      if (analysisLanguages.length === 0)
        throw new Error('Interlinearizer: a draft needs an analysis language');
      if (retag && retag.from === retag.to)
        throw new Error(`Interlinearizer: glosses cannot move from ${retag.to} to itself`);
      if (retag && deleteTextOf !== undefined)
        throw new Error('Interlinearizer: a language change either moves text or deletes it');
      const target: EditTarget = { sessionId, changeId };
      const reply = await sessions.edit(
        sessionId,
        intent,
        async (buffer, session) => {
          const draft = await session.repository.getWholeDraft();
          const { unreadableBooks } = await session.repository.getDraftState();
          // A book that can't be read would keep the text this change moves or deletes.
          if ((retag || deleteTextOf !== undefined) && unreadableBooks.length > 0)
            throw new Error(
              `Interlinearizer: cannot move or delete language text while ${unreadableBooks.join(', ')} cannot be read`,
            );
          const outcome = await languageCommands.changeAnalysisLanguages(buffer, draft.analysis, {
            analysisLanguages,
            retag,
            deleteTextOf,
            now: editStamp().now,
          });
          const { glossRetag, deletedText } = outcome;
          let summary: StepSummary = { kind: 'changeAnalysisLanguages' };
          if (retag && glossRetag)
            summary = {
              kind: 'retagGlosses',
              from: retag.from,
              to: retag.to,
              words: glossRetag.words,
              morphemes: glossRetag.morphemes,
              freeTranslations: glossRetag.freeTranslations,
            };
          else if (deleteTextOf !== undefined && deletedText)
            summary = { kind: 'deleteLanguageText', tag: deleteTextOf, ...deletedText };
          target.step = { summary };
          return glossRetag || deletedText ? outcome : undefined;
        },
        { changeId, step: () => target.step },
      );
      return JSON.stringify(reply);
    } catch (e) {
      logger.error(`Interlinearizer: failed to ${intent} in session ${sessionId}`, e);
      throw e;
    }
  }

  async function countLanguageText({
    sessionId,
  }: ArgsOf<'interlinearizer.countLanguageText'>): Promise<string> {
    try {
      const counts = await sessions.run(sessionId, (session) =>
        session.repository.countTextByTag(),
      );
      return JSON.stringify(counts);
    } catch (e) {
      logger.error(`Interlinearizer: failed to count language text in session ${sessionId}`, e);
      throw e;
    }
  }

  /**
   * Runs an unsaved-change discard as one edit of a session's analysis, re-anchoring each book it
   * rewrites to the book's current text. A book the text lacks has its links go stale.
   *
   * @param target - The session whose draft the discard edits, and the change id it is sent under.
   * @param intent - Names the discard.
   * @param stage - Stages the discard over the stored draft, given the saved project's content.
   * @param unsavedMark - How the discard leaves the draft's unsaved mark, given whether the draft
   *   saves to a project.
   * @returns A JSON string of the {@link CommandReply}, with `hasFreeTranslations`: whether any
   *   segment of the draft the discard leaves has a free translation.
   * @throws If the saved project cannot be read, the session is read-only or not open, or the edit
   *   is refused or fails. The error is logged before rethrowing.
   */
  async function runDiscard(
    { sessionId, changeId, step }: EditTarget,
    intent: string,
    stage: (
      buffer: ChangeBuffer,
      reader: discardCommands.DiscardReader,
      saved: discardCommands.SavedProject | undefined,
    ) => Promise<discardCommands.DiscardOutcome>,
    unsavedMark: (savesToProject: boolean) => EditOptions['unsavedMark'],
  ): Promise<string> {
    try {
      const reply = await sessions.edit(
        sessionId,
        intent,
        async (buffer, session) => {
          const saved = await savedContentOf(session);
          const outcome = await stage(buffer, session.repository, saved);
          const { sourceProjectId } = session.scope;
          const reanchorTo = await Promise.all(
            outcome.changedBooks.map(
              async (bookCode) =>
                (await getVerseBook(sourceProjectId, bookCode)) ?? missingBook(bookCode),
            ),
          );
          return { reanchorTo, reportsFreeTranslations: true };
        },
        {
          unsavedMark: ({ scope }) => unsavedMark(scope.interlinearProjectId !== undefined),
          changeId,
          step,
        },
      );
      /* v8 ignore next 2 -- defensive: only a discard reusing another command's change id gets no flag */
      if (reply.hasFreeTranslations === undefined)
        throw new Error(`Interlinearizer: change ${changeId} was not a discard`);
      return JSON.stringify(reply);
    } catch (e) {
      logger.error(`Interlinearizer: failed to ${intent} in session ${sessionId}`, e);
      throw e;
    }
  }

  function discardBook({
    sessionId,
    bookCode,
    changeId,
  }: ArgsOf<'interlinearizer.discardBook'>): Promise<string> {
    return runDiscard(
      { sessionId, changeId, step: { summary: { kind: 'discardBook', book: bookCode } } },
      'discardBook',
      (buffer, reader, saved) => discardCommands.discardBook(buffer, reader, bookCode, saved),
      (savesToProject) => (savesToProject ? 'keep' : undefined),
    );
  }

  function discardAll({
    sessionId,
    changeId,
  }: ArgsOf<'interlinearizer.discardAll'>): Promise<string> {
    return runDiscard(
      { sessionId, changeId, step: { summary: { kind: 'discardAll' } } },
      'discardAll',
      discardCommands.discardAll,
      () => 'clear',
    );
  }

  /**
   * Stages clearing the session's analysis-language gloss of each analysis in `analysisIds`. The
   * returned function resolves to the ids of the token analyses that the clear empties.
   */
  function stageClearAnalysisGlosses({ analysisIds }: { analysisIds: string[] }) {
    return (buffer: ChangeBuffer, session: Session) =>
      catalogCommands.clearAnalysisGlosses(buffer, {
        analysisIds,
        analysisLanguage: session.analysisLanguage,
        now: editStamp().now,
      });
  }

  function stageDiscardStaleAnalysis(args: { analysisId: string; tokenRef: string }) {
    return (buffer: ChangeBuffer) => staleCommands.discardStaleAnalysis(buffer, args);
  }

  /** Stages approving the stale analysis `analysisId` at `tokenRef`. */
  function stageReapplyStaleAnalysis(args: {
    analysisId: string;
    staleTokenRef: string;
    tokenRef: string;
    surfaceText: string;
  }) {
    return (buffer: ChangeBuffer) => {
      const { analysisId: copyId, linkId, now } = editStamp();
      return staleCommands.reapplyStaleAnalysis(buffer, { ...args, copyId, linkId, now });
    };
  }

  /**
   * Stages the command that a removal preview names.
   *
   * @throws {Error} If the request names an intent that can't be previewed.
   */
  function stageRemovals(
    request: RemovalPreviewRequest,
  ): (buffer: ChangeBuffer, session: Session) => Promise<unknown> {
    switch (request.intent) {
      case 'clearAnalysisGlosses':
        return stageClearAnalysisGlosses(request);
      case 'discardStaleAnalysis':
        return stageDiscardStaleAnalysis(request);
      case 'reapplyStaleAnalysis':
        return stageReapplyStaleAnalysis(request);
      default:
        throw new Error(
          `Interlinearizer: cannot preview the removals of ${JSON.stringify(request)}`,
        );
    }
  }

  async function previewRemovals({
    sessionId,
    request,
  }: ArgsOf<'interlinearizer.previewRemovals'>): Promise<string> {
    try {
      const changes = await sessions.preview(sessionId, request.intent, stageRemovals(request));
      return JSON.stringify(changes.tokenAnalyses?.deletes ?? []);
    } catch (e) {
      logger.error(`Interlinearizer: failed to preview removals in session ${sessionId}`, e);
      throw e;
    }
  }

  async function previewBreakdownEdit({
    sessionId,
    tokenRef,
  }: ArgsOf<'interlinearizer.previewBreakdownEdit'>): Promise<string> {
    try {
      return JSON.stringify(
        await sessions.run(sessionId, (session) =>
          morphemeCommands.previewBreakdownEdit(new ChangeBuffer(session.repository), tokenRef),
        ),
      );
    } catch (e) {
      logger.error(
        `Interlinearizer: failed to preview a breakdown edit in session ${sessionId}`,
        e,
      );
      throw e;
    }
  }

  return {
    'interlinearizer.writeGloss': writeGloss,
    'interlinearizer.approveAnalysisForToken': approveAnalysisForToken,
    'interlinearizer.writeMorphemes': writeMorphemes,
    'interlinearizer.deleteMorphemes': deleteMorphemes,
    'interlinearizer.writeMorphemeGloss': writeMorphemeGloss,
    'interlinearizer.discardStaleAnalysis': discardStaleAnalysis,
    'interlinearizer.reapplyStaleAnalysis': reapplyStaleAnalysis,
    'interlinearizer.keepStaleFreeTranslation': keepStaleFreeTranslation,
    'interlinearizer.discardStaleFreeTranslation': discardStaleFreeTranslation,
    'interlinearizer.writeAnalysisGloss': writeAnalysisGloss,
    'interlinearizer.clearAnalysisGlosses': clearAnalysisGlosses,
    'interlinearizer.writeAnalysisMorphemes': writeAnalysisMorphemes,
    'interlinearizer.confirmAnalysisMorphemes': confirmAnalysisMorphemes,
    'interlinearizer.writeAnalysisMorphemeGloss': writeAnalysisMorphemeGloss,
    'interlinearizer.linkAnalysisSense': linkAnalysisSense,
    'interlinearizer.unlinkAnalysisSense': unlinkAnalysisSense,
    'interlinearizer.linkAnalysisMorphemeSense': linkAnalysisMorphemeSense,
    'interlinearizer.unlinkAnalysisMorphemeSense': unlinkAnalysisMorphemeSense,
    'interlinearizer.adoptAnalysisSenseGloss': adoptAnalysisSenseGloss,
    'interlinearizer.adoptAnalysisMorphemeSenseGloss': adoptAnalysisMorphemeSenseGloss,
    'interlinearizer.deleteAnalyses': deleteAnalyses,
    'interlinearizer.mergeAnalysesInto': mergeAnalysesInto,
    'interlinearizer.createPhrase': createPhrase,
    'interlinearizer.updatePhrase': updatePhrase,
    'interlinearizer.deletePhrase': deletePhrase,
    'interlinearizer.mergePhrases': mergePhrases,
    'interlinearizer.writePhraseGloss': writePhraseGloss,
    'interlinearizer.approvePhrase': approvePhrase,
    'interlinearizer.splitPhrase': splitPhrase,
    'interlinearizer.writeSegmentFreeTranslation': writeSegmentFreeTranslation,
    'interlinearizer.mergeSegments': mergeSegments,
    'interlinearizer.splitSegment': splitSegment,
    'interlinearizer.moveBoundary': moveBoundary,
    'interlinearizer.discardBook': discardBook,
    'interlinearizer.discardAll': discardAll,
    'interlinearizer.changeAnalysisLanguages': changeAnalysisLanguages,
    'interlinearizer.countLanguageText': countLanguageText,
    'interlinearizer.previewRemovals': previewRemovals,
    'interlinearizer.previewBreakdownEdit': previewBreakdownEdit,
  } satisfies Partial<CommandHandlers>;
}
