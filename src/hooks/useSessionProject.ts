import papi, { logger } from '@papi/frontend';
import type { DraftProject, DraftStart, SessionEditArgs } from 'interlinearizer';
import type { NetworkEvents } from 'papi-shared-types';
import { useEvent } from 'platform-bible-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { WholeAnalysis } from '../cache/wholeAnalysis';
import type { SegmentationDispatch } from '../components/SegmentationStore';
import type { CommandReply } from '../types/command-reply';
import type { EditStep } from '../types/edit-step';
import type { ProjectApi, ProjectViewOptions } from '../types/project-api';
import type { DraftCopyResult, NewDraftConfig } from './useDraftProject';
import useSessionPages from './useSessionPages';

/** The session open on the source, with what opening it answered. */
type OpenedSession = Readonly<{
  sessionId: string;
  readOnly: boolean;
  hasFreeTranslations: boolean;
  whole: WholeAnalysis;
}>;

/** How far the session's read of the whole text has progressed, as `getTextReadStatus` answers. */
type TextReadStatus = Readonly<{ booksRead: number; bookCount: number; failedBookIds: string[] }>;

const NO_WHOLE = new WholeAnalysis(async () => {
  /* v8 ignore next -- a stand-in that no read is asked of, used until a session opens */
  throw new Error('Interlinearizer: no session is open');
});

/* v8 ignore next -- stands in for WebView-path members that do nothing on the host path */
const ignore = () => {};

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
 * and when the source or the import changes. New and Open have the host start the draft over, then
 * open a fresh session, which has nothing to undo. Undo, redo, discards and boundary edits are
 * commands to the session.
 */
export default function useSessionProject(
  sourceProjectId: string,
  _platformLanguage: string | undefined,
  { saveTargetId, importProjectId, bookId, scrRef }: ProjectViewOptions,
): ProjectApi {
  const [opened, setOpened] = useState<OpenedSession>();
  /** Bumped to open a fresh session on the same project, as New and Open do. */
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
  const [readStatus, setReadStatus] = useState<{ sessionId: string; status: TextReadStatus }>();
  const readStatusJson = useRef<string | undefined>(undefined);

  /** The interlinear project that the open session was opened on, or was last told to save to. */
  const targetRef = useRef<string | undefined>(undefined);
  const saveTargetRef = useRef(saveTargetId);
  saveTargetRef.current = saveTargetId;

  useEffect(() => {
    let isCurrent = true;
    const interlinearProjectId = importProjectId ?? saveTargetRef.current;
    let sessionId: string | undefined;
    const opening = (async () => {
      try {
        const reply: Omit<OpenedSession, 'whole'> = JSON.parse(
          await papi.commands.sendCommand('interlinearizer.openSession', {
            sourceProjectId,
            ...(interlinearProjectId !== undefined && { interlinearProjectId }),
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
  }, [sourceProjectId, importProjectId, openCount, noteHistory]);

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
  // Re-renders only when the draft's envelope changes; its analysis is read at render, as the
  // WebView path reads its draft.
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

  /** Fetches how far the session's read of the whole text has progressed. */
  const readTextStatus = useCallback(() => {
    if (sessionId === undefined) return;
    papi.commands
      .sendCommand('interlinearizer.getTextReadStatus', { sessionId })
      .then((json) => {
        const status: TextReadStatus = JSON.parse(json);
        const seen = readStatusJson.current;
        readStatusJson.current = `${sessionId}:${json}`;
        // An unchanged status sets no state, so the view does not render again for it.
        return seen === readStatusJson.current ? undefined : setReadStatus({ sessionId, status });
      })
      .catch((e) => logger.warn('Interlinearizer: could not read the whole-text status', e));
  }, [sessionId]);
  useEffect(readTextStatus, [readTextStatus]);

  const textReadEvent = useMemo(
    () => papi.network.getNetworkEvent('interlinearizer.onTextRead'),
    [],
  );
  useEvent(
    textReadEvent,
    useCallback(
      (read: NetworkEvents['interlinearizer.onTextRead']) => {
        if (read.sourceProjectId === sourceProjectId) readTextStatus();
      },
      [sourceProjectId, readTextStatus],
    ),
  );

  /** Fetches the whole draft again, logging a failure. */
  const refreshWhole = useCallback(() => {
    whole.refresh().catch((e) => logger.warn('Interlinearizer: could not read the draft again', e));
  }, [whole]);

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
        if (!client) refreshWhole();
        readTextStatus();
      },
      [sessionId, client, refreshWhole, readTextStatus],
    ),
  );
  useEffect(() => client?.subscribeHeard(refreshWhole), [client, refreshWhole]);

  /**
   * Applies a reply's changes to the whole draft, and notes what the reply says is left to undo and
   * redo, telling each history listener.
   */
  const takeReply = useCallback(
    (reply: CommandReply) => {
      whole.take(reply.changes);
      noteHistory({ canUndo: reply.canUndo, canRedo: reply.canRedo });
      if ('hasFreeTranslations' in reply && typeof reply.hasFreeTranslations === 'boolean')
        setHasFreeTranslations(reply.hasFreeTranslations);
    },
    [whole, noteHistory],
  );
  useEffect(() => client?.subscribeReplies(takeReply), [client, takeReply]);

  /**
   * Sends an edit through the client so that its reply lands in the pages. A failure is logged and
   * resolves `undefined`.
   */
  const sendEdit = useCallback(
    async (
      failing: string,
      call: (args: SessionEditArgs) => Promise<string | undefined>,
    ): Promise<CommandReply | undefined> => {
      /* v8 ignore next -- edits come only from a view whose pages have loaded */
      if (!client || sessionId === undefined) return undefined;
      try {
        return await client.send(async (changeId) => {
          const reply = await call({ sessionId, changeId });
          return reply === undefined ? undefined : JSON.parse(reply);
        });
      } catch (e) {
        logger.error(`Interlinearizer: failed to ${failing}`, e);
        return undefined;
      }
    },
    [client, sessionId],
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
      // The reply leaves out whether the move returned the draft to its saved state.
      if (reply) refreshWhole();
      // A failed move leaves the flags as they were, because no reply came to report them.
      if (movedNothing) {
        const side = command === 'interlinearizer.undoEdit' ? 'canUndo' : 'canRedo';
        noteHistory({ [side]: false });
      }
      return reply?.step;
    },
    [sendEdit, refreshWhole, noteHistory],
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
        ...(config.suggestedName !== undefined && { suggestedName: config.suggestedName }),
        ...(config.suggestedDescription !== undefined && {
          suggestedDescription: config.suggestedDescription,
        }),
      }),
    [startOver],
  );

  const commitDraft = useCallback(
    async (copy: (snapshot: DraftProject, sessionId?: string) => Promise<DraftCopyResult>) => {
      const snapshot = whole.draft;
      if (!snapshot || isSaving) return false;
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

  /** Sends a discard, which replaces the draft's content wholesale. */
  const discard = useCallback(
    async (call: (args: SessionEditArgs) => Promise<string>) => {
      if (!(await sendEdit('discard changes', call))) return;
      // The reply leaves out how the discard left the draft's unsaved mark.
      refreshWhole();
      setDraftVersion((version) => version + 1);
    },
    [sendEdit, refreshWhole],
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
  const getHistoryRevision = useCallback(() => historyRevision.current, []);
  const subscribeToHistoryRevisions = useCallback((listener: () => void) => {
    revisionListeners.current.add(listener);
    return () => revisionListeners.current.delete(listener);
  }, []);
  const undo = useCallback(() => move('interlinearizer.undoEdit'), [move]);
  const redo = useCallback(() => move('interlinearizer.redoEdit'), [move]);

  // The segmentation version, bumped whenever the draft's boundaries change, as a boundary edit
  // bumps it on the WebView path.
  const segmentationKey = JSON.stringify(draft?.segmentation ?? {});
  const segmentation = useRef({ key: segmentationKey, version: 0 });
  if (segmentation.current.key !== segmentationKey)
    segmentation.current = { key: segmentationKey, version: segmentation.current.version + 1 };

  const status = readStatus?.sessionId === sessionId ? readStatus?.status : undefined;
  const staleCoversDraft =
    !!status && status.booksRead === status.bookCount && status.failedBookIds.length === 0;

  return {
    isDraftLoading: !opened || !draft,
    draft,
    draftVersion,
    segmentationVersion: segmentation.current.version,
    dirty: draft?.dirty ?? false,
    getDraftSnapshot,
    isSaving,
    commitDraft,
    autosaveAnalysis: ignore,
    autosaveSegmentation: ignore,
    loadFromProject,
    newDraft,
    discardBook,
    discardAll,
    detachFromProject,
    canUndo,
    canRedo,
    getHistoryRevision,
    subscribeToHistoryRevisions,
    undo,
    redo,
    asOneStep: (action) => action(),
    // On the host path, the session re-anchors the draft. No analysis store is fed there.
    reanchorBook: ignore,
    /* v8 ignore next -- no analysis store subscribes on the host path */
    subscribeToAnalysisReplacements: () => ignore,
    session: opened && {
      sessionId: opened.sessionId,
      readOnly: opened.readOnly,
      whole,
      pages,
      client,
      hasFreeTranslations,
      staleCoversDraft,
      boundaries,
      setAnalysisLanguage,
    },
  };
}
