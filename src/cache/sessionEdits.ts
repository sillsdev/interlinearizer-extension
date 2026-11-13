import papi, { logger } from '@papi/frontend';
import type {
  MergedContent,
  PhraseAnalysisLink,
  RemovalPreviewRequest,
  SessionEditArgs,
  TokenSnapshot,
} from 'interlinearizer';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BreakdownPreview } from '../services/commands/morphemeCommands';
import type { CommandReply } from '../types/command-reply';
import type { AnalysisEditOutcome } from '../utils/edit-outcome';
import { perfMark } from '../utils/perf-marks';
import { usePageSession, useSessionEdit } from './pageHooks';

/**
 * Returns a function that sends a session edit without waiting on it, logging any failure under the
 * description `failing`.
 */
function useFireEdit(): (
  failing: string,
  call: (args: SessionEditArgs) => Promise<string | undefined>,
) => void {
  const edit = useSessionEdit();
  return useCallback(
    (failing, call) => {
      edit(call).catch((e) => logger.error(`Interlinearizer: failed to ${failing}`, e));
    },
    [edit],
  );
}

/** Writes a token's gloss in the session's language; a blank value clears it. */
export function useGlossCommand(): (tokenRef: string, surfaceText: string, value: string) => void {
  const fire = useFireEdit();
  return useCallback(
    (tokenRef, surfaceText, value) => {
      perfMark('gloss-commit');
      fire(`write the gloss of ${tokenRef}`, (args) =>
        papi.commands.sendCommand('interlinearizer.writeGloss', {
          ...args,
          tokenRef,
          surfaceText,
          value,
        }),
      );
    },
    [fire],
  );
}

/**
 * Returns a stable callback that approves an existing `TokenAnalysis` payload for a token, as
 * accepting a suggestion or promoting a candidate does. Persists immediately.
 *
 * The shared payload is never rewritten, so no other token's gloss changes.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useApproveAnalysisDispatch(): (
  tokenRef: string,
  surfaceText: string,
  analysisId: string,
) => void {
  const fire = useFireEdit();
  return useCallback(
    (tokenRef, surfaceText, analysisId) =>
      fire(`approve ${analysisId} for ${tokenRef}`, (args) =>
        papi.commands.sendCommand('interlinearizer.approveAnalysisForToken', {
          ...args,
          tokenRef,
          surfaceText,
          analysisId,
        }),
      ),
    [fire],
  );
}

/**
 * Returns a stable callback that keeps an analysis's stale breakdown as it stands, clearing the
 * mark for every token linked to it. Persists immediately, recording the optional `tokenRef` as the
 * place the confirmation was made at.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useConfirmMorphemesDispatch(): (analysisId: string, tokenRef?: string) => void {
  const fire = useFireEdit();
  return useCallback(
    (analysisId, tokenRef) =>
      fire(`confirm the breakdown of ${analysisId}`, (args) =>
        papi.commands.sendCommand('interlinearizer.confirmAnalysisMorphemes', {
          ...args,
          analysisId,
          ...(tokenRef !== undefined && { tokenRef }),
        }),
      ),
    [fire],
  );
}

/**
 * Returns a stable callback that replaces the morpheme breakdown on a token's approved
 * `TokenAnalysis`. Persists immediately. Other tokens that share the payload keep their breakdown.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useMorphemeBreakdownDispatch(): (
  tokenRef: string,
  surfaceText: string,
  forms: string[],
  writingSystem: string,
) => void {
  const fire = useFireEdit();
  return useCallback(
    (tokenRef, surfaceText, forms, writingSystem) =>
      fire(`write the breakdown of ${tokenRef}`, (args) =>
        papi.commands.sendCommand('interlinearizer.writeMorphemes', {
          ...args,
          tokenRef,
          surfaceText,
          forms,
          writingSystem,
        }),
      ),
    [fire],
  );
}

/**
 * Returns a stable callback that removes the morpheme breakdown from a token's approved
 * `TokenAnalysis`. Persists immediately. A record left with no other content is deleted.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useMorphemeDeleteDispatch(): (tokenRef: string) => void {
  const fire = useFireEdit();
  return useCallback(
    (tokenRef) =>
      fire(`remove the breakdown of ${tokenRef}`, (args) =>
        papi.commands.sendCommand('interlinearizer.deleteMorphemes', { ...args, tokenRef }),
      ),
    [fire],
  );
}

/**
 * Returns a stable callback that writes the gloss of one morpheme in a token's approved
 * `TokenAnalysis`. Persists immediately. Other tokens that share the payload keep their gloss.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useMorphemeGlossDispatch(): (
  tokenRef: string,
  morphemeId: string,
  value: string,
) => void {
  const fire = useFireEdit();
  return useCallback(
    (tokenRef, morphemeId, value) =>
      fire(`write the gloss of morpheme ${morphemeId}`, (args) =>
        papi.commands.sendCommand('interlinearizer.writeMorphemeGloss', {
          ...args,
          tokenRef,
          morphemeId,
          value,
        }),
      ),
    [fire],
  );
}

/**
 * Returns a stable callback that writes the gloss of a phrase occurrence, persisting it
 * immediately.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function usePhraseGlossDispatch(): (phraseId: string, value: string) => void {
  const fire = useFireEdit();
  return useCallback(
    (phraseId, value) =>
      fire(`write the gloss of phrase ${phraseId}`, (args) =>
        papi.commands.sendCommand('interlinearizer.writePhraseGloss', { ...args, phraseId, value }),
      ),
    [fire],
  );
}

/**
 * Returns stable callbacks for editing phrase occurrences. Each persists immediately.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function usePhraseDispatch(): {
  createPhrase: (tokens: TokenSnapshot[]) => void;
  updatePhrase: (phraseId: string, tokens: TokenSnapshot[]) => void;
  deletePhrase: (phraseId: string) => void;
  mergePhrases: (
    targetPhraseId: string,
    tokens: TokenSnapshot[],
    absorbedPhraseId: string | undefined,
  ) => void;
  splitPhrase: (phraseLink: PhraseAnalysisLink, splitAfterTokenRef: string) => void;
} {
  const fire = useFireEdit();
  return useMemo(
    () => ({
      createPhrase: (tokens) =>
        fire('create a phrase', (args) =>
          papi.commands.sendCommand('interlinearizer.createPhrase', { ...args, tokens }),
        ),
      updatePhrase: (phraseId, tokens) =>
        fire(`update phrase ${phraseId}`, (args) =>
          papi.commands.sendCommand('interlinearizer.updatePhrase', { ...args, phraseId, tokens }),
        ),
      deletePhrase: (phraseId) =>
        fire(`delete phrase ${phraseId}`, (args) =>
          papi.commands.sendCommand('interlinearizer.deletePhrase', { ...args, phraseId }),
        ),
      mergePhrases: (targetPhraseId, tokens, absorbedPhraseId) =>
        fire(`merge into phrase ${targetPhraseId}`, (args) =>
          papi.commands.sendCommand('interlinearizer.mergePhrases', {
            ...args,
            targetPhraseId,
            tokens,
            ...(absorbedPhraseId !== undefined && { absorbedPhraseId }),
          }),
        ),
      splitPhrase: ({ id: phraseId }, splitAfterTokenRef) =>
        fire(`split phrase ${phraseId}`, (args) =>
          papi.commands.sendCommand('interlinearizer.splitPhrase', {
            ...args,
            phraseId,
            splitAfterTokenRef,
          }),
        ),
    }),
    [fire],
  );
}

/**
 * Returns a stable callback that writes a segment's free translation, persisting it immediately. A
 * blank value clears the translation and may drop the now-empty `SegmentAnalysis` record.
 *
 * When the segment has no approved translation, the stale translation that `adoptStaleAnalysisId`
 * names, if given, is adopted as the one the value was typed over.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useSegmentFreeTranslationDispatch(): (
  segmentId: string,
  surfaceText: string,
  value: string,
  adoptStaleAnalysisId?: string,
) => void {
  const fire = useFireEdit();
  return useCallback(
    (segmentId, surfaceText, value, adoptStaleAnalysisId) =>
      fire(`write the free translation of ${segmentId}`, (args) =>
        papi.commands.sendCommand('interlinearizer.writeSegmentFreeTranslation', {
          ...args,
          segmentId,
          surfaceText,
          value,
          ...(adoptStaleAnalysisId !== undefined && { adoptStaleAnalysisId }),
        }),
      ),
    [fire],
  );
}

/**
 * Returns stable callbacks for reviewing stale free translations. Each persists immediately.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useStaleFreeTranslationDispatch(): {
  keep: (analysisId: string, segmentId: string, surfaceText: string) => void;
  discard: (analysisId: string) => void;
} {
  const fire = useFireEdit();
  return useMemo(
    () => ({
      keep: (analysisId, segmentId, surfaceText) =>
        fire(`keep stale free translation ${analysisId}`, (args) =>
          papi.commands.sendCommand('interlinearizer.keepStaleFreeTranslation', {
            ...args,
            analysisId,
            segmentId,
            surfaceText,
          }),
        ),
      discard: (analysisId) =>
        fire(`discard stale free translation ${analysisId}`, (args) =>
          papi.commands.sendCommand('interlinearizer.discardStaleFreeTranslation', {
            ...args,
            analysisId,
          }),
        ),
    }),
    [fire],
  );
}

/**
 * Returns stable callbacks for reviewing the places that analyses went stale at. Each persists
 * immediately.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useStaleLocationDispatch(): {
  discard: (analysisId: string, tokenRef: string) => void;
  reapply: (
    analysisId: string,
    staleTokenRef: string,
    tokenRef: string,
    surfaceText: string,
  ) => void;
} {
  const fire = useFireEdit();
  return useMemo(
    () => ({
      discard: (analysisId, tokenRef) =>
        fire(`discard ${analysisId} where it went stale`, (args) =>
          papi.commands.sendCommand('interlinearizer.discardStaleAnalysis', {
            ...args,
            analysisId,
            tokenRef,
          }),
        ),
      reapply: (analysisId, staleTokenRef, tokenRef, surfaceText) =>
        fire(`reapply ${analysisId} to ${tokenRef}`, (args) =>
          papi.commands.sendCommand('interlinearizer.reapplyStaleAnalysis', {
            ...args,
            analysisId,
            staleTokenRef,
            tokenRef,
            surfaceText,
          }),
        ),
    }),
    [fire],
  );
}

/** A catalog edit's reply, with what the host adds to it. */
type CatalogEditReply = CommandReply & {
  /** Where the edit left the record it was aimed at. */
  outcome?: AnalysisEditOutcome;
  /** The token analyses that a gloss clear left empty, and so removed. */
  emptiedAnalysisIds?: string[];
};

const EDITED: AnalysisEditOutcome = { kind: 'edited' };

/**
 * Returns stable callbacks for editing the analysis records that the catalog lists. Each edit
 * rewrites the record for every token linked to it.
 *
 * Each write reports where its reply says it left the record, so the caller can say when an edit
 * collapsed the row onto a sibling. An edit settles once it has applied.
 *
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useAnalysisRowDispatch(): {
  writeGloss: (analysisId: string, value: string) => Promise<AnalysisEditOutcome>;
  clearGlosses: (analysisIds: readonly string[]) => Promise<readonly string[]>;
  writeMorphemes: (
    analysisId: string,
    forms: readonly string[],
    writingSystem: string,
  ) => Promise<AnalysisEditOutcome>;
  writeMorphemeGloss: (
    analysisId: string,
    morphemeId: string,
    value: string,
  ) => Promise<AnalysisEditOutcome>;
  deleteAnalyses: (analysisIds: readonly string[]) => Promise<void>;
  mergeAll: (
    survivorAnalysisId: string,
    mergedAnalysisIds: readonly string[],
    content: MergedContent,
  ) => Promise<AnalysisEditOutcome>;
} {
  const edit = useSessionEdit();

  return useMemo(() => {
    /** Sends an edit, logging and rethrowing a failure. */
    const send = async (
      intent: string,
      call: (args: SessionEditArgs) => Promise<string | undefined>,
    ): Promise<CatalogEditReply | undefined> => {
      try {
        return await edit(call);
      } catch (e) {
        logger.error(`Interlinearizer: failed to ${intent}`, e);
        throw e;
      }
    };
    /** Where the edit that `reply` answers left its record; in place when no reply came. */
    const outcomeOf = (reply: CatalogEditReply | undefined): AnalysisEditOutcome =>
      reply?.outcome ?? EDITED;
    return {
      writeGloss: async (analysisId, value) =>
        outcomeOf(
          await send('writeAnalysisGloss', (args) =>
            papi.commands.sendCommand('interlinearizer.writeAnalysisGloss', {
              ...args,
              analysisId,
              value,
            }),
          ),
        ),
      clearGlosses: async (analysisIds) => {
        const reply = await send('clearAnalysisGlosses', (args) =>
          papi.commands.sendCommand('interlinearizer.clearAnalysisGlosses', {
            ...args,
            analysisIds: [...analysisIds],
          }),
        );
        return reply?.emptiedAnalysisIds ?? [];
      },
      writeMorphemes: async (analysisId, forms, writingSystem) =>
        outcomeOf(
          await send('writeAnalysisMorphemes', (args) =>
            papi.commands.sendCommand('interlinearizer.writeAnalysisMorphemes', {
              ...args,
              analysisId,
              forms: [...forms],
              writingSystem,
            }),
          ),
        ),
      writeMorphemeGloss: async (analysisId, morphemeId, value) =>
        outcomeOf(
          await send('writeAnalysisMorphemeGloss', (args) =>
            papi.commands.sendCommand('interlinearizer.writeAnalysisMorphemeGloss', {
              ...args,
              analysisId,
              morphemeId,
              value,
            }),
          ),
        ),
      deleteAnalyses: async (analysisIds) => {
        await send('deleteAnalyses', (args) =>
          papi.commands.sendCommand('interlinearizer.deleteAnalyses', {
            ...args,
            analysisIds: [...analysisIds],
          }),
        );
      },
      mergeAll: async (survivorAnalysisId, mergedAnalysisIds, content) =>
        outcomeOf(
          await send('mergeAnalysesInto', (args) =>
            papi.commands.sendCommand('interlinearizer.mergeAnalysesInto', {
              ...args,
              survivorAnalysisId,
              mergedAnalysisIds: [...mergedAnalysisIds],
              content,
            }),
          ),
        ),
    };
  }, [edit]);
}

/** Asks the session which token analyses an edit would remove, applying nothing. */
export function useRemovalPreviews(): {
  clearGlosses: (analysisIds: readonly string[]) => Promise<readonly string[]>;
  discardStale: (analysisId: string, tokenRef: string) => Promise<readonly string[]>;
  reapplyStale: (
    analysisId: string,
    staleTokenRef: string,
    tokenRef: string,
    surfaceText: string,
  ) => Promise<readonly string[]>;
} {
  const { sessionId } = usePageSession();
  return useMemo(() => {
    const preview = async (request: RemovalPreviewRequest): Promise<readonly string[]> =>
      JSON.parse(
        await papi.commands.sendCommand('interlinearizer.previewRemovals', { sessionId, request }),
      );
    return {
      clearGlosses: (analysisIds) =>
        preview({ intent: 'clearAnalysisGlosses', analysisIds: [...analysisIds] }),
      discardStale: (analysisId, tokenRef) =>
        preview({ intent: 'discardStaleAnalysis', analysisId, tokenRef }),
      reapplyStale: (analysisId, staleTokenRef, tokenRef, surfaceText) =>
        preview({
          intent: 'reapplyStaleAnalysis',
          analysisId,
          staleTokenRef,
          tokenRef,
          surfaceText,
        }),
    };
  }, [sessionId]);
}

/** What a breakdown edit is taken to do when the session cannot say: lose what a reset drops. */
const UNKNOWN_BREAKDOWN: BreakdownPreview = { solelyOwned: false, resetLosesAnnotation: true };

/**
 * Asks the session what a breakdown edit at `tokenRef` would do, each time `isOpen` turns on. A
 * failed ask is logged and answered as a reset that loses annotation.
 *
 * @returns The answer; `undefined` while `isOpen` is off, and until the answer arrives.
 * @throws When called outside a {@link PageClientProvider}.
 */
export function useBreakdownPreview(
  tokenRef: string,
  isOpen: boolean,
): BreakdownPreview | undefined {
  const { sessionId } = usePageSession();
  const [preview, setPreview] = useState<BreakdownPreview>();
  useEffect(() => {
    if (!isOpen) return undefined;
    let isCurrent = true;
    (async () => {
      let answer: BreakdownPreview;
      try {
        answer = JSON.parse(
          await papi.commands.sendCommand('interlinearizer.previewBreakdownEdit', {
            sessionId,
            tokenRef,
          }),
        );
      } catch (e) {
        logger.warn(`Interlinearizer: could not preview a breakdown edit at ${tokenRef}`, e);
        answer = UNKNOWN_BREAKDOWN;
      }
      if (isCurrent) setPreview(answer);
    })();
    return () => {
      isCurrent = false;
      setPreview(undefined);
    };
  }, [sessionId, tokenRef, isOpen]);
  return preview;
}
