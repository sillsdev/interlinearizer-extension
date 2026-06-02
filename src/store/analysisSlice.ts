import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  PhraseAnalysis,
  PhraseAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
  TokenSnapshot,
} from 'interlinearizer';

/** Redux state slice for the active `TextAnalysis` and its working language. */
export type AnalysisState = {
  /** The active `TextAnalysis` being read and mutated. */
  analysis: TextAnalysis;
  /** BCP 47 tag identifying the language used when reading and writing gloss values. */
  analysisLanguage: string;
};

/** Payload for the {@link writeGloss} action, extended with a pre-generated UUID. */
interface WriteGlossPayload {
  /** `Token.ref` of the token being glossed. */
  tokenRef: string;
  /** Current surface text of the token, stored on the `TokenAnalysis` record. */
  surfaceText: string;
  /** New gloss string to assign in the active analysis language. */
  value: string;
  /** Pre-generated UUID for a new `TokenAnalysis` record, produced by the `prepare` callback. */
  id: string;
}

/** Payload for the {@link createPhrase} action. */
interface CreatePhrasePayload {
  /** Pre-generated UUID for the new `PhraseAnalysis`, produced by the `prepare` callback. */
  id: string;
  /** Ordered `TokenSnapshot`s forming the phrase, in document order. */
  tokens: TokenSnapshot[];
}

/** Payload for the {@link updatePhrase} action. */
interface UpdatePhrasePayload {
  /** ID of the `PhraseAnalysis` (and its link) to update. */
  phraseId: string;
  /** Replacement ordered `TokenSnapshot`s, in document order. */
  tokens: TokenSnapshot[];
}

/** Payload for the {@link deletePhrase} action. */
interface DeletePhrasePayload {
  /** ID of the `PhraseAnalysis` (and its link) to remove. */
  phraseId: string;
}

/** Payload for the {@link writePhraseGloss} action. */
interface WritePhraseGlossPayload {
  /** ID of the `PhraseAnalysis` to update. */
  phraseId: string;
  /** New gloss string to assign in the active analysis language. */
  value: string;
}

/** Empty `TextAnalysis` used when no `initialAnalysis` is provided to the store. */
export const defaultAnalysis: TextAnalysis = {
  segmentAnalyses: [],
  segmentAnalysisLinks: [],
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [],
  phraseAnalysisLinks: [],
};

/** Default `AnalysisState` used as the Redux initial state. */
export const defaultState: AnalysisState = {
  analysis: { ...defaultAnalysis },
  analysisLanguage: 'und',
};

const analysisSlice = createSlice({
  name: 'analysis',
  initialState: defaultState,
  reducers: {
    /**
     * Replaces the entire `TextAnalysis` in state. Intended for project-switch scenarios where the
     * caller loads a new analysis from storage and needs to reset all in-memory state.
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action whose payload is the replacement `TextAnalysis`.
     */
    setAnalysis(state, action: PayloadAction<TextAnalysis>) {
      state.analysis = action.payload;
    },
    writeGloss: {
      /**
       * Generates a UUID for a potential new `TokenAnalysis` record before the action reaches the
       * reducer, keeping the reducer pure.
       *
       * @param tokenRef - `Token.ref` of the token being glossed.
       * @param surfaceText - Surface text of the token.
       * @param value - New gloss string.
       * @returns The prepared action payload including a pre-generated `id`.
       */
      prepare(tokenRef: string, surfaceText: string, value: string) {
        return { payload: { tokenRef, surfaceText, value, id: crypto.randomUUID() } };
      },
      /**
       * Creates or updates an approved `TokenAnalysis` for the given token. If an approved link
       * already exists for `tokenRef`, its analysis is updated in place; otherwise a new
       * `TokenAnalysis` and `TokenAnalysisLink` are appended. Non-approved analyses for the token
       * are left untouched.
       *
       * @param state - Current slice state (Immer draft).
       * @param action - Action carrying the `WriteGlossPayload`.
       */
      reducer(state, action: PayloadAction<WriteGlossPayload>) {
        const { tokenRef, surfaceText, value, id } = action.payload;
        const lang = state.analysisLanguage;

        const existingLink = state.analysis.tokenAnalysisLinks.find(
          (l) => l.status === 'approved' && l.token.tokenRef === tokenRef,
        );

        if (existingLink) {
          const existingAnalysis = state.analysis.tokenAnalyses.find(
            (ta) => ta.id === existingLink.analysisId,
          );
          if (existingAnalysis) {
            existingAnalysis.surfaceText = surfaceText;
            if (!existingAnalysis.gloss) existingAnalysis.gloss = {};
            existingAnalysis.gloss[lang] = value;
            return;
          }
          // The approved link references a missing analysis (orphaned link from corruption or a
          // migration). Remove it so we don't accumulate duplicate approved links below.
          state.analysis.tokenAnalysisLinks = state.analysis.tokenAnalysisLinks.filter(
            (l) => l !== existingLink,
          );
        }

        // No approved link exists, or the orphaned link was removed above — create a new one.
        const newAnalysis: TokenAnalysis = { id, surfaceText, gloss: { [lang]: value } };
        const newLink: TokenAnalysisLink = {
          analysisId: id,
          status: 'approved',
          token: { tokenRef, surfaceText },
        };
        state.analysis.tokenAnalyses.push(newAnalysis);
        state.analysis.tokenAnalysisLinks.push(newLink);
      },
    },
    createPhrase: {
      /**
       * Generates a UUID for the new `PhraseAnalysis` before the action reaches the reducer,
       * keeping the reducer pure.
       *
       * @param tokens - Ordered `TokenSnapshot`s forming the phrase, in document order.
       * @returns The prepared action payload including a pre-generated `id`.
       */
      prepare(tokens: TokenSnapshot[]) {
        return { payload: { id: crypto.randomUUID(), tokens } };
      },
      /**
       * Appends a new approved `PhraseAnalysis` and its `PhraseAnalysisLink` to the analysis.
       *
       * @param state - Current slice state (Immer draft).
       * @param action - Action carrying the `CreatePhrasePayload`.
       */
      reducer(state, action: PayloadAction<CreatePhrasePayload>) {
        const { id, tokens } = action.payload;
        const surfaceText = tokens.map((t) => t.surfaceText).join(' ');
        const newAnalysis: PhraseAnalysis = { id, surfaceText };
        const newLink: PhraseAnalysisLink = { analysisId: id, status: 'approved', tokens };
        state.analysis.phraseAnalyses.push(newAnalysis);
        state.analysis.phraseAnalysisLinks.push(newLink);
      },
    },
    /**
     * Replaces the token list of the matching `PhraseAnalysisLink`. Does not create a new
     * `PhraseAnalysis` record — preserves the phrase id and any gloss already written on it.
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the `UpdatePhrasePayload`.
     */
    updatePhrase(state, action: PayloadAction<UpdatePhrasePayload>) {
      const { phraseId, tokens } = action.payload;
      const link = state.analysis.phraseAnalysisLinks.find((l) => l.analysisId === phraseId);
      if (link) link.tokens = tokens;
    },
    /**
     * Removes the `PhraseAnalysis` record and its `PhraseAnalysisLink` for the given phrase id.
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the `DeletePhrasePayload`.
     */
    deletePhrase(state, action: PayloadAction<DeletePhrasePayload>) {
      const { phraseId } = action.payload;
      state.analysis.phraseAnalyses = state.analysis.phraseAnalyses.filter(
        (pa) => pa.id !== phraseId,
      );
      state.analysis.phraseAnalysisLinks = state.analysis.phraseAnalysisLinks.filter(
        (pl) => pl.analysisId !== phraseId,
      );
    },
    /**
     * Writes a gloss value into the `PhraseAnalysis` record for the given phrase id. No-ops when no
     * matching `PhraseAnalysis` is found.
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the `WritePhraseGlossPayload`.
     */
    writePhraseGloss(state, action: PayloadAction<WritePhraseGlossPayload>) {
      const { phraseId, value } = action.payload;
      const pa = state.analysis.phraseAnalyses.find((p) => p.id === phraseId);
      if (!pa) return;
      const lang = state.analysisLanguage;
      if (!pa.gloss) pa.gloss = {};
      pa.gloss[lang] = value;
    },
  },
});

export const {
  setAnalysis,
  writeGloss,
  createPhrase,
  updatePhrase,
  deletePhrase,
  writePhraseGloss,
} = analysisSlice.actions;
export default analysisSlice.reducer;

/**
 * Projects `tokenAnalyses` out of `AnalysisState` for use as a `createSelector` input.
 *
 * @param state - The analysis slice state.
 * @returns The `tokenAnalyses` array.
 */
const selectTokenAnalyses = (state: AnalysisState) => state.analysis.tokenAnalyses;

/**
 * Projects `tokenAnalysisLinks` out of `AnalysisState` for use as a `createSelector` input.
 *
 * @param state - The analysis slice state.
 * @returns The `tokenAnalysisLinks` array.
 */
const selectTokenAnalysisLinks = (state: AnalysisState) => state.analysis.tokenAnalysisLinks;

/**
 * Projects `analysisLanguage` out of `AnalysisState` for use as a `createSelector` input.
 *
 * @param state - The analysis slice state.
 * @returns The active BCP 47 analysis language tag.
 */
const selectAnalysisLanguage = (state: AnalysisState) => state.analysisLanguage;

/**
 * Memoized selector that builds a `Map` from `TokenAnalysis.id` to `TokenAnalysis` for O(1) lookup.
 * Recomputes only when `tokenAnalyses` changes reference.
 */
const selectAnalysisById = createSelector(
  selectTokenAnalyses,
  (tokenAnalyses) => new Map(tokenAnalyses.map((ta) => [ta.id, ta])),
);

/**
 * Memoized selector that builds a `Map` from `tokenRef` to the approved `TokenAnalysis.id` for that
 * token. Only the last approved link per token is indexed (the data model allows at most one).
 * Recomputes only when `tokenAnalysisLinks` or `tokenAnalyses` change reference.
 */
const selectApprovedIdByTokenRef = createSelector(
  selectTokenAnalysisLinks,
  selectAnalysisById,
  (links, byId) =>
    links.reduce((index, link) => {
      if (link.status === 'approved' && byId.has(link.analysisId)) {
        index.set(link.token.tokenRef, link.analysisId);
      }
      return index;
    }, new Map<string, string>()),
);

/**
 * Returns the `TextAnalysis` from the analysis slice state.
 *
 * @param state - The analysis slice state.
 * @returns The current `TextAnalysis`.
 */
export const selectAnalysis = (state: AnalysisState) => state.analysis;

/**
 * Returns the approved gloss string for `tokenRef` in the active analysis language, or `''` when no
 * approved analysis exists or the analysis has no gloss for the active language.
 *
 * @param state - The analysis slice state.
 * @param tokenRef - The `Token.ref` to look up.
 * @returns The approved gloss string, or `''` when absent.
 */
export function selectApprovedGloss(state: AnalysisState, tokenRef: string): string {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (!approvedId) return '';
  const ta = selectAnalysisById(state).get(approvedId);
  const lang = selectAnalysisLanguage(state);
  return ta?.gloss?.[lang] ?? '';
}

/**
 * Projects `phraseAnalysisLinks` out of `AnalysisState` for use as a `createSelector` input.
 *
 * @param state - The analysis slice state.
 * @returns The `phraseAnalysisLinks` array.
 */
const selectPhraseAnalysisLinksRaw = (state: AnalysisState) => state.analysis.phraseAnalysisLinks;

/**
 * Memoized selector that returns all approved `PhraseAnalysisLink`s. Recomputes only when
 * `phraseAnalysisLinks` changes reference.
 */
export const selectPhraseLinks = createSelector(selectPhraseAnalysisLinksRaw, (links) =>
  links.filter((l) => l.status === 'approved'),
);

/**
 * Memoized selector that builds a `Map` from each `tokenRef` to the approved `PhraseAnalysisLink`
 * containing it. When a token appears in multiple approved links (data-model violation), the last
 * wins. Recomputes only when approved phrase links change.
 */
export const selectPhraseLinkByTokenRef = createSelector(selectPhraseLinks, (links) =>
  links.reduce((map, link) => {
    link.tokens.reduce((m, snap) => {
      m.set(snap.tokenRef, link);
      return m;
    }, map);
    return map;
  }, new Map<string, PhraseAnalysisLink>()),
);

/**
 * Memoized selector that builds a `Map` from `analysisId` to approved `PhraseAnalysisLink` for O(1)
 * phrase lookup by id. Recomputes only when approved phrase links change.
 */
export const selectPhraseLinkByAnalysisId = createSelector(
  selectPhraseLinks,
  (links) => new Map(links.map((link) => [link.analysisId, link])),
);

/**
 * Returns the `PhraseAnalysis` with the given id, or `undefined` when absent.
 *
 * @param state - The analysis slice state.
 * @param phraseId - The `PhraseAnalysis.id` to look up.
 * @returns The matching `PhraseAnalysis`, or `undefined`.
 */
export function selectPhraseAnalysisById(
  state: AnalysisState,
  phraseId: string,
): PhraseAnalysis | undefined {
  return state.analysis.phraseAnalyses.find((pa) => pa.id === phraseId);
}

/**
 * Returns the approved gloss string for the given phrase in the active analysis language, or `''`
 * when no phrase with that id exists or it has no gloss for the active language.
 *
 * @param state - The analysis slice state.
 * @param phraseId - The `PhraseAnalysis.id` to look up.
 * @returns The gloss string, or `''` when absent.
 */
export function selectPhraseGloss(state: AnalysisState, phraseId: string): string {
  const pa = state.analysis.phraseAnalyses.find((p) => p.id === phraseId);
  return pa?.gloss?.[state.analysisLanguage] ?? '';
}
