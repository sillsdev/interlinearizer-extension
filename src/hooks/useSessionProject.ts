import papi, { logger } from '@papi/frontend';
import type { DraftProject, SessionEditArgs } from 'interlinearizer';
import type { NetworkEvents } from 'papi-shared-types';
import { useEvent } from 'platform-bible-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
import { WholeAnalysis } from '../cache/wholeAnalysis';
import type { SegmentationDispatch } from '../components/SegmentationStore';
import type { CommandReply } from '../types/command-reply';
import type { EditStep } from '../types/edit-step';
import { emptyAnalysis } from '../types/empty-factories';
import type { ProjectApi, ProjectViewOptions } from '../types/project-api';
import type { DraftCopyResult, NewDraftConfig, OpenableProject } from './useDraftProject';
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

/**
 * Keeps the draft of `sourceProjectId` in a session on the host. The session saves to
 * `saveTargetId`, or views the Paratext 9 import `importProjectId` instead. It closes on unmount,
 * and when the source or the import changes. New and Open write the draft they start and open a
 * fresh session, which has nothing to undo. Undo, redo, discards and boundary edits are commands to
 * the session.
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
  const [history, setHistory] = useState({ canUndo: false, canRedo: false, revision: 0 });
  const historyRef = useRef(history);
  historyRef.current = history;
  const revisionListeners = useRef(new Set<() => void>());
  const [hasFreeTranslations, setHasFreeTranslations] = useState(false);
  const [readStatus, setReadStatus] = useState<TextReadStatus>();

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
        setHistory((was) => ({ canUndo: false, canRedo: false, revision: was.revision + 1 }));
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
  }, [sourceProjectId, importProjectId, openCount]);

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
  const draft = useSyncExternalStore(
    useCallback((listener: () => void) => whole.subscribe(listener), [whole]),
    () => whole.draft,
  );
  const pages = useSessionPages({ sessionId, bookId, scrRef });
  const { client } = pages;

  /** Fetches how far the session's read of the whole text has progressed. */
  const readTextStatus = useCallback(() => {
    if (sessionId === undefined) return;
    papi.commands
      .sendCommand('interlinearizer.getTextReadStatus', { sessionId })
      .then((json) => setReadStatus(JSON.parse(json)))
      .catch((e) => logger.warn('Interlinearizer: could not read the whole-text status', e));
  }, [sessionId]);
  useEffect(readTextStatus, [readTextStatus]);

  const analysisChangedEvent = useMemo(
    () => papi.network.getNetworkEvent('interlinearizer.onAnalysisChanged'),
    [],
  );
  useEvent(
    analysisChangedEvent,
    useCallback(
      (change: NetworkEvents['interlinearizer.onAnalysisChanged']) => {
        if (!('sessionId' in change) || change.sessionId !== sessionId) return;
        whole
          .refresh()
          .catch((e) => logger.warn('Interlinearizer: could not read the draft again', e));
        readTextStatus();
      },
      [sessionId, whole, readTextStatus],
    ),
  );

  /** Notes what a reply says is left to undo and redo, telling each history listener. */
  const takeReply = useCallback((reply: CommandReply | undefined) => {
    setHistory((was) => ({
      canUndo: reply ? reply.canUndo : false,
      canRedo: reply ? reply.canRedo : was.canRedo,
      revision: was.revision + 1,
    }));
    if (reply && 'hasFreeTranslations' in reply && typeof reply.hasFreeTranslations === 'boolean')
      setHasFreeTranslations(reply.hasFreeTranslations);
  }, []);
  useEffect(() => client?.subscribeReplies(takeReply), [client, takeReply]);
  useEffect(() => revisionListeners.current.forEach((listener) => listener()), [history.revision]);

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
      const reply = await sendEdit(command, (args) => papi.commands.sendCommand(command, args));
      if (!reply) takeReply(undefined);
      return reply?.step;
    },
    [sendEdit, takeReply],
  );

  /** Writes `next` as the stored draft, then opens a fresh session on whatever draft is stored. */
  const startOver = useCallback(
    async (next: DraftProject) => {
      try {
        if (sessionId !== undefined)
          await papi.commands.sendCommand('interlinearizer.closeSession', { sessionId });
        await papi.commands.sendCommand(
          'interlinearizer.saveDraft',
          sourceProjectId,
          JSON.stringify(next),
        );
      } catch (e) {
        logger.error(`Interlinearizer: failed to start the draft of ${sourceProjectId} over`, e);
      }
      setOpenCount((count) => count + 1);
    },
    [sessionId, sourceProjectId],
  );

  const loadFromProject = useCallback(
    (project: OpenableProject) => {
      startOver({
        sourceProjectId,
        modelVersion: CURRENT_MODEL_VERSION,
        analysisLanguages: project.analysisLanguages,
        ...(project.targetProjectId !== undefined && { targetProjectId: project.targetProjectId }),
        ...(project.segmentation !== undefined && { segmentation: project.segmentation }),
        analysis: project.analysis,
        dirty: false,
      });
    },
    [startOver, sourceProjectId],
  );

  const newDraft = useCallback(
    (config: NewDraftConfig) => {
      startOver({
        sourceProjectId,
        modelVersion: CURRENT_MODEL_VERSION,
        analysisLanguages: config.analysisLanguages,
        ...(config.suggestedName !== undefined && { suggestedName: config.suggestedName }),
        ...(config.suggestedDescription !== undefined && {
          suggestedDescription: config.suggestedDescription,
        }),
        analysis: emptyAnalysis(),
        dirty: false,
      });
    },
    [startOver, sourceProjectId],
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
      if (await sendEdit('discard changes', call)) setDraftVersion((version) => version + 1);
    },
    [sendEdit],
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

  // The segmentation version, bumped whenever the draft's boundaries change, as a boundary edit
  // bumps it on the WebView path.
  const segmentationKey = JSON.stringify(draft?.segmentation ?? {});
  const segmentation = useRef({ key: segmentationKey, version: 0 });
  if (segmentation.current.key !== segmentationKey)
    segmentation.current = { key: segmentationKey, version: segmentation.current.version + 1 };

  const staleCoversDraft =
    !!readStatus &&
    readStatus.booksRead === readStatus.bookCount &&
    readStatus.failedBookIds.length === 0;

  return {
    isDraftLoading: !opened || !draft,
    draft,
    draftVersion,
    segmentationVersion: segmentation.current.version,
    dirty: draft?.dirty ?? false,
    getDraftSnapshot: () => whole.draft,
    isSaving,
    commitDraft,
    autosaveAnalysis: ignore,
    autosaveSegmentation: ignore,
    loadFromProject,
    newDraft,
    discardBook: (bookCode) =>
      discard((args) =>
        papi.commands.sendCommand('interlinearizer.discardBook', { ...args, bookCode }),
      ),
    discardAll: () =>
      discard((args) => papi.commands.sendCommand('interlinearizer.discardAll', args)),
    detachFromProject,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    getHistoryRevision: () => historyRef.current.revision,
    subscribeToHistoryRevisions: (listener) => {
      revisionListeners.current.add(listener);
      return () => revisionListeners.current.delete(listener);
    },
    undo: () => move('interlinearizer.undoEdit'),
    redo: () => move('interlinearizer.redoEdit'),
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
