import papi, { logger } from '@papi/frontend';
import type { DraftProject, DraftStart, SessionEditArgs } from 'interlinearizer';
import type { NetworkEvents } from 'papi-shared-types';
import { useEvent } from 'platform-bible-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { HeardChange } from '../cache/pageClient';
import { WholeAnalysis } from '../cache/wholeAnalysis';
import type { SegmentationDispatch } from '../components/SegmentationStore';
import type { CommandReply } from '../types/command-reply';
import type { EditStep } from '../types/edit-step';
import { isGlossRetagCounts } from '../utils/retag-glosses';
import type {
  ProjectApi,
  ProjectViewOptions,
  DraftCopyResult,
  NewDraftConfig,
} from '../types/project-api';
import useLatestRef from './useLatestRef';
import useSessionPages from './useSessionPages';

/** The session open on the source, with what opening it answered. */
type OpenedSession = Readonly<{
  sessionId: string;
  readOnly: boolean;
  hasFreeTranslations: boolean;
  projectMissing: boolean;
  whole: WholeAnalysis;
}>;

const NO_WHOLE = new WholeAnalysis(async () => {
  /* v8 ignore next -- a stand-in that no read is asked of, used until a session opens */
  throw new Error('Interlinearizer: no session is open');
});

/** Whether `a` and `b` hold equal fields, their analysis aside. */
function sameEnvelope(a: DraftProject, b: DraftProject): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete('analysis');
  return [...keys].every((key) => {
    const [was, is] = [Reflect.get(a, key), Reflect.get(b, key)];
    return Object.is(was, is) || JSON.stringify(was) === JSON.stringify(is);
  });
}

/**
 * Keeps the draft of `sourceProjectId` in a session on the host. The session saves to
 * `saveTargetId`, or views the Paratext 9 import `importProjectId` instead. It closes on unmount,
 * and when the source, the import, or the import's version changes. New and Open have the host
 * start the draft over, then open a fresh session, which has nothing to undo. Undo, redo, discards
 * and boundary edits are commands to the session.
 */
export default function useSessionProject(
  sourceProjectId: string,
  {
    saveTargetId,
    importProjectId,
    importVersion,
    bookId,
    scrRef,
    onProjectMissing,
  }: ProjectViewOptions,
): ProjectApi {
  const [opened, setOpened] = useState<OpenedSession>();
  /** Bumped to open a fresh session on the same project. */
  const [openCount, setOpenCount] = useState(0);
  const [draftVersion, setDraftVersion] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyFlags = useRef({ canUndo: false, canRedo: false });
  const historyRevision = useRef(0);
  const revisionListeners = useRef(new Set<() => void>());
  /** Notes a move through the history, and what it leaves to undo and redo. */
  const noteHistory = useCallback((flags: { canUndo?: boolean; canRedo?: boolean }) => {
    historyRevision.current += 1;
    revisionListeners.current.forEach((listener) => listener());
    // Unchanged flags set no state, so the view does not render again for them.
    const next = { ...historyFlags.current, ...flags };
    if (next.canUndo !== historyFlags.current.canUndo) setCanUndo(next.canUndo);
    if (next.canRedo !== historyFlags.current.canRedo) setCanRedo(next.canRedo);
    historyFlags.current = next;
  }, []);
  const [hasFreeTranslations, setHasFreeTranslations] = useState(false);
  const [isTextWanted, setIsTextWanted] = useState(false);

  /** The interlinear project that the open session was opened on, or was last told to save to. */
  const targetRef = useRef<string | undefined>(undefined);
  const saveTargetRef = useLatestRef(saveTargetId);
  const onProjectMissingRef = useLatestRef(onProjectMissing);
  /** The project the view names now, which New or Open may change while a session opens. */
  const namedProjectRef = useLatestRef(importProjectId ?? saveTargetId);

  useEffect(() => {
    let isCurrent = true;
    const saveTarget = importProjectId === undefined ? saveTargetRef.current : undefined;
    const interlinearProjectId = importProjectId ?? saveTarget;
    let sessionId: string | undefined;
    const opening = (async () => {
      try {
        const reply: Omit<OpenedSession, 'whole'> = JSON.parse(
          await papi.commands.sendCommand('interlinearizer.openSession', {
            sourceProjectId,
            ...(saveTarget !== undefined && { interlinearProjectId: saveTarget }),
            ...(importProjectId !== undefined && { importProjectId }),
          }),
        );
        ({ sessionId } = reply);
        const address = { sessionId };
        const whole = new WholeAnalysis(async () =>
          JSON.parse(await papi.commands.sendCommand('interlinearizer.getFullAnalysis', address)),
        );
        if (isCurrent) await whole.refresh();
        if (!isCurrent) return reply.sessionId;
        targetRef.current = interlinearProjectId;
        if (reply.projectMissing && namedProjectRef.current === interlinearProjectId)
          onProjectMissingRef.current?.();
        setOpened({ ...reply, whole });
        setHasFreeTranslations(reply.hasFreeTranslations);
        noteHistory({ canUndo: false, canRedo: false });
        setDraftVersion((version) => version + 1);
        return reply.sessionId;
      } catch (e) {
        // A view gone meanwhile has nowhere to show the failure. Its cleanup closes any session that
        // opened.
        if (isCurrent)
          logger.error(`Interlinearizer: failed to open a session on ${sourceProjectId}`, e);
        return sessionId;
      }
    })();
    return () => {
      isCurrent = false;
      setOpened(undefined);
      // Closed once opened, so a session still opening when the view moves on is not left open.
      opening
        .then((openedId) =>
          openedId === undefined
            ? undefined
            : papi.commands.sendCommand('interlinearizer.closeSession', { sessionId: openedId }),
        )
        .catch((e) => logger.error('Interlinearizer: failed to close a session', e));
    };
  }, [
    sourceProjectId,
    importProjectId,
    importVersion,
    openCount,
    noteHistory,
    saveTargetRef,
    onProjectMissingRef,
    namedProjectRef,
  ]);

  const sessionId = opened?.sessionId;
  const whole = opened?.whole ?? NO_WHOLE;

  // A draft's session follows the project that the draft saves to, keeping what there is to undo.
  useEffect(() => {
    if (!opened || opened.readOnly || targetRef.current === saveTargetId) return;
    targetRef.current = saveTargetId;
    papi.commands
      .sendCommand('interlinearizer.setSaveTarget', {
        sessionId: opened.sessionId,
        ...(saveTargetId !== undefined && { interlinearProjectId: saveTargetId }),
      })
      .catch((e) =>
        logger.error(`Interlinearizer: failed to save the draft to ${saveTargetId}`, e),
      );
  }, [opened, saveTargetId]);

  const detachFromProject = useCallback(async () => {
    /* v8 ignore next -- a project is deleted from a dialog over a view whose session has opened */
    if (sessionId === undefined) return;
    targetRef.current = undefined;
    try {
      await papi.commands.sendCommand('interlinearizer.detachFromProject', { sessionId });
      await whole.refresh();
    } catch (e) {
      logger.error('Interlinearizer: failed to detach the draft from its project', e);
    }
  }, [sessionId, whole]);
  // Re-renders only when the draft's envelope changes; its analysis is read at render.
  const envelope = useRef<DraftProject | undefined>(undefined);
  useSyncExternalStore(
    useCallback((listener: () => void) => whole.subscribe(listener), [whole]),
    () => {
      const next = whole.draft;
      if (!envelope.current || !next || !sameEnvelope(envelope.current, next))
        envelope.current = next;
      return envelope.current;
    },
  );
  const { draft } = whole;
  const pages = useSessionPages({ sessionId, bookId, scrRef });
  const { client } = pages;

  // Asking how far the read has got starts the session's read of the whole text. A failed start
  // clears the request, so that the next feature that wants the text asks again.
  useEffect(() => {
    if (sessionId === undefined || !isTextWanted) return;
    papi.commands.sendCommand('interlinearizer.getTextReadStatus', { sessionId }).catch((e) => {
      logger.warn("Interlinearizer: could not start reading the session's text", e);
      setIsTextWanted(false);
    });
  }, [sessionId, isTextWanted]);
  const requestTextRead = useCallback(() => setIsTextWanted(true), []);

  /** Fetches the whole draft again, logging a failure. */
  const refreshWhole = useCallback(() => {
    whole.refresh().catch((e) => logger.warn('Interlinearizer: could not read the draft again', e));
  }, [whole]);

  /**
   * Applies a reported change's re-anchor passes to the whole draft. Fetches the draft again for a
   * change that carries none.
   */
  const takeHeard = useCallback(
    ({ passChanges }: HeardChange) => {
      if (!passChanges) refreshWhole();
      else passChanges.forEach((changes) => whole.take(changes, 'kept'));
    },
    [whole, refreshWhole],
  );

  const analysisChangedEvent = useMemo(
    () => papi.network.getNetworkEvent('interlinearizer.onAnalysisChanged'),
    [],
  );
  useEvent(
    analysisChangedEvent,
    useCallback(
      (change: NetworkEvents['interlinearizer.onAnalysisChanged']) => {
        if (!('sessionId' in change) || change.sessionId !== sessionId) return;
        // With pages loaded, the client tells which changes its replies left out.
        if (!client) takeHeard(change);
      },
      [sessionId, client, takeHeard],
    ),
  );
  useEffect(() => client?.subscribeHeard(takeHeard), [client, takeHeard]);

  /**
   * Applies a reply's changes to the whole draft, with the reply's unsaved mark, and notes what the
   * reply says is left to undo and redo, telling each history listener.
   */
  const takeReply = useCallback(
    (reply: CommandReply) => {
      whole.take(reply.changes, reply.dirty);
      noteHistory({ canUndo: reply.canUndo, canRedo: reply.canRedo });
      if ('hasFreeTranslations' in reply && typeof reply.hasFreeTranslations === 'boolean')
        setHasFreeTranslations(reply.hasFreeTranslations);
    },
    [whole, noteHistory],
  );
  useEffect(() => client?.subscribeReplies(takeReply), [client, takeReply]);

  /**
   * Sends an edit through the client so that its reply lands in the pages.
   *
   * @throws If the pages' outline has not loaded yet, or whatever the edit's command throws.
   */
  const sendEditOrThrow = useCallback(
    async (
      call: (args: SessionEditArgs) => Promise<string | undefined>,
    ): Promise<CommandReply | undefined> => {
      /* v8 ignore next -- edits come only from a view whose pages have loaded */
      if (!client || sessionId === undefined) return undefined;
      return client.send(async (changeId) => {
        const reply = await call({ sessionId, changeId });
        return reply === undefined ? undefined : JSON.parse(reply);
      });
    },
    [client, sessionId],
  );

  /**
   * Sends an edit through the client so that its reply lands in the pages. A failure is logged and
   * resolves `undefined`.
   */
  const sendEdit = useCallback(
    async (
      failing: string,
      call: (args: SessionEditArgs) => Promise<string | undefined>,
    ): Promise<CommandReply | undefined> => {
      try {
        return await sendEditOrThrow(call);
      } catch (e) {
        logger.error(`Interlinearizer: failed to ${failing}`, e);
        return undefined;
      }
    },
    [sendEditOrThrow],
  );

  const move = useCallback(
    async (
      command: 'interlinearizer.undoEdit' | 'interlinearizer.redoEdit',
    ): Promise<EditStep | undefined> => {
      let movedNothing = false;
      const reply = await sendEdit(command, async (args) => {
        const json = await papi.commands.sendCommand(command, args);
        movedNothing = json === undefined;
        return json;
      });
      // A failed move leaves the flags as they were, because no reply came to report them.
      if (movedNothing) {
        const side = command === 'interlinearizer.undoEdit' ? 'canUndo' : 'canRedo';
        noteHistory({ [side]: false });
      }
      return reply?.step;
    },
    [sendEdit, noteHistory],
  );

  /**
   * Starts the stored draft over from `from`, then opens a fresh session on whatever draft is
   * stored.
   *
   * @throws If the host cannot start the draft over. The fresh session then opens on the draft
   *   stored before.
   */
  const startOver = useCallback(
    async (from: DraftStart) => {
      // Dropped first, so that a save target changed meanwhile goes to the fresh session.
      setOpened(undefined);
      try {
        await papi.commands.sendCommand('interlinearizer.startDraftOver', {
          sourceProjectId,
          from,
        });
      } finally {
        setOpenCount((count) => count + 1);
      }
    },
    [sourceProjectId],
  );

  const loadFromProject = useCallback(
    (interlinearProjectId: string) => startOver({ interlinearProjectId }),
    [startOver],
  );

  const newDraft = useCallback(
    (config: NewDraftConfig) =>
      startOver({
        analysisLanguages: config.analysisLanguages,
        ...(config.suggestedDescription !== undefined && {
          suggestedDescription: config.suggestedDescription,
        }),
      }),
    [startOver],
  );

  const commitDraft = useCallback(
    async (copy: (snapshot: DraftProject, sessionId: string) => Promise<DraftCopyResult>) => {
      const snapshot = whole.draft;
      /* v8 ignore next -- the whole draft is read only once the session has opened */
      if (!snapshot || isSaving || sessionId === undefined) return false;
      setIsSaving(true);
      try {
        const copied = await copy(snapshot, sessionId);
        await whole.refresh();
        return copied !== false;
      } finally {
        setIsSaving(false);
      }
    },
    [whole, isSaving, sessionId],
  );

  /**
   * Sends a discard, which replaces the draft's content wholesale.
   *
   * @throws If the pages' outline has not loaded yet, or whatever the discard's command throws.
   */
  const discard = useCallback(
    async (call: (args: SessionEditArgs) => Promise<string>) => {
      /* v8 ignore next -- a discard's command always replies */
      if (!(await sendEditOrThrow(call))) return;
      // The reply leaves out how the discard left the draft's unsaved mark.
      refreshWhole();
      setDraftVersion((version) => version + 1);
    },
    [sendEditOrThrow, refreshWhole],
  );

  const boundaries = useMemo<SegmentationDispatch>(
    () => ({
      merge: (secondSegmentStartRef) => {
        sendEdit('merge segments', (args) =>
          papi.commands.sendCommand('interlinearizer.mergeSegments', {
            ...args,
            secondSegmentStartRef,
          }),
        );
      },
      split: (tokenRef) => {
        sendEdit('split a segment', (args) =>
          papi.commands.sendCommand('interlinearizer.splitSegment', { ...args, tokenRef }),
        );
      },
      move: (fromRef, toRef) => {
        sendEdit('move a boundary', (args) =>
          papi.commands.sendCommand('interlinearizer.moveBoundary', { ...args, fromRef, toRef }),
        );
      },
    }),
    [sendEdit],
  );

  const setAnalysisLanguage = useCallback(
    (tag: string) => {
      /* v8 ignore next -- handed out only on the view of an open session */
      if (sessionId === undefined) return;
      papi.commands
        .sendCommand('interlinearizer.setAnalysisLanguage', { sessionId, analysisLanguage: tag })
        .catch((e) => logger.error(`Interlinearizer: failed to set the language to ${tag}`, e));
    },
    [sessionId],
  );

  const getDraftSnapshot = useCallback(() => whole.draft, [whole]);
  const discardBook = useCallback(
    (bookCode: string) =>
      discard((args) =>
        papi.commands.sendCommand('interlinearizer.discardBook', { ...args, bookCode }),
      ),
    [discard],
  );
  const discardAll = useCallback(
    () => discard((args) => papi.commands.sendCommand('interlinearizer.discardAll', args)),
    [discard],
  );

  /**
   * Gives the draft new analysis languages, primary first, as one undoable step. With `retagFrom`,
   * the step also moves the word and morpheme glosses under `retagFrom` to the new primary
   * language.
   *
   * @returns What moved, or `undefined` when no glosses were asked to move.
   * @throws If the pages' outline has not loaded yet, or whatever the edit's command throws.
   */
  const changeAnalysisLanguages = useCallback(
    async (analysisLanguages: string[], retagFrom?: string) => {
      const reply = await sendEditOrThrow((args) =>
        papi.commands.sendCommand('interlinearizer.changeAnalysisLanguages', {
          ...args,
          analysisLanguages,
          ...(retagFrom !== undefined && { retagFrom }),
        }),
      );
      // The reply leaves out how a change of languages alone left the draft's unsaved mark.
      refreshWhole();
      const glossRetag: unknown = reply && 'glossRetag' in reply ? reply.glossRetag : undefined;
      return isGlossRetagCounts(glossRetag) ? glossRetag : undefined;
    },
    [sendEditOrThrow, refreshWhole],
  );
  const getHistoryRevision = useCallback(() => historyRevision.current, []);
  const subscribeToHistoryRevisions = useCallback((listener: () => void) => {
    revisionListeners.current.add(listener);
    return () => revisionListeners.current.delete(listener);
  }, []);
  const undo = useCallback(() => move('interlinearizer.undoEdit'), [move]);
  const redo = useCallback(() => move('interlinearizer.redoEdit'), [move]);

  // The segmentation version, bumped whenever the draft's boundaries change.
  const segmentationKey = JSON.stringify(draft?.segmentation ?? {});
  const segmentation = useRef({ key: segmentationKey, version: 0 });
  if (segmentation.current.key !== segmentationKey)
    segmentation.current = { key: segmentationKey, version: segmentation.current.version + 1 };

  return {
    isDraftLoading: !opened || !draft,
    draft,
    draftVersion,
    segmentationVersion: segmentation.current.version,
    dirty: draft?.dirty ?? false,
    getDraftSnapshot,
    isSaving,
    commitDraft,
    loadFromProject,
    newDraft,
    discardBook,
    discardAll,
    changeAnalysisLanguages,
    detachFromProject,
    canUndo,
    canRedo,
    getHistoryRevision,
    subscribeToHistoryRevisions,
    undo,
    redo,
    session: opened && {
      sessionId: opened.sessionId,
      readOnly: opened.readOnly,
      whole,
      pages,
      client,
      hasFreeTranslations,
      requestTextRead,
      boundaries,
      setAnalysisLanguage,
    },
  };
}
