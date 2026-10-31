import papi, { logger } from '@papi/frontend';
import type {
  MergedContent,
  PhraseAnalysisLink,
  RemovalPreviewRequest,
  SessionEditArgs,
  TokenSnapshot,
} from 'interlinearizer';
import { useCallback, useMemo } from 'react';
import type { CommandReply } from '../types/command-reply';
import { readEditOutcome, type AnalysisEditOutcome } from '../utils/edit-outcome';
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

/** Approves a stored token analysis for a token. */
export function useApproveAnalysisCommand(): (
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

/** Keeps a token analysis's stale breakdown as it stands. */
export function useConfirmMorphemesCommand(): (analysisId: string, tokenRef?: string) => void {
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

/** Writes a token's morpheme breakdown. */
export function useMorphemeBreakdownCommand(): (
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

/** Removes a token's morpheme breakdown. */
export function useMorphemeDeleteCommand(): (tokenRef: string) => void {
  const fire = useFireEdit();
  return useCallback(
    (tokenRef) =>
      fire(`remove the breakdown of ${tokenRef}`, (args) =>
        papi.commands.sendCommand('interlinearizer.deleteMorphemes', { ...args, tokenRef }),
      ),
    [fire],
  );
}

/** Writes the gloss of one morpheme of a token's breakdown. */
export function useMorphemeGlossCommand(): (
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

/** Writes a phrase occurrence's gloss. */
export function usePhraseGlossCommand(): (phraseId: string, value: string) => void {
  const fire = useFireEdit();
  return useCallback(
    (phraseId, value) =>
      fire(`write the gloss of phrase ${phraseId}`, (args) =>
        papi.commands.sendCommand('interlinearizer.writePhraseGloss', { ...args, phraseId, value }),
      ),
    [fire],
  );
}

/** The phrase edits, as the session makes them. */
export function usePhraseCommands(): {
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

/** Writes a segment's free translation, adopting a stale one when named. */
export function useSegmentFreeTranslationCommand(): (
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

/** Keeps or drops a stale free translation. */
export function useStaleFreeTranslationCommands(): {
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

/** Gives up, or moves, the place that a token analysis went stale at. */
export function useStaleLocationCommands(): {
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

/**
 * The analysis that holds `analysisId`'s row after a catalog edit, as the edit's step names it.
 * With no step, that is `analysisId` itself; with a step that names no survivor, `undefined`.
 */
function survivorOf(reply: CommandReply | undefined, analysisId: string): string | undefined {
  if (!reply?.step) return analysisId;
  const { summary } = reply.step;
  return summary && 'survivingAnalysisId' in summary ? summary.survivingAnalysisId : undefined;
}

/**
 * The catalog's row edits, as the session makes them. Each settles once the edit has; an edit that
 * resolves an outcome settles once the whole analysis has been read again.
 */
export function useAnalysisRowCommands(): {
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
  const { whole, analysisLanguage } = usePageSession();

  return useMemo(() => {
    /** Sends an edit, logging and rethrowing a failure. */
    const send = async (
      intent: string,
      call: (args: SessionEditArgs) => Promise<string | undefined>,
    ): Promise<CommandReply | undefined> => {
      try {
        return await edit(call);
      } catch (e) {
        logger.error(`Interlinearizer: failed to ${intent}`, e);
        throw e;
      }
    };
    /** Where the edit that `reply` answers left `analysisId`. */
    const outcomeOf = (reply: CommandReply | undefined, analysisId: string) =>
      readEditOutcome(whole.current, survivorOf(reply, analysisId), analysisId, analysisLanguage);
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
          analysisId,
        ),
      clearGlosses: async (analysisIds) => {
        const reply: (CommandReply & { emptiedAnalysisIds?: string[] }) | undefined = await send(
          'clearAnalysisGlosses',
          (args) =>
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
          analysisId,
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
          analysisId,
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
          survivorAnalysisId,
        ),
    };
  }, [edit, whole, analysisLanguage]);
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
