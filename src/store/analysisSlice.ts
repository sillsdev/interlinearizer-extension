import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';

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
        }

        // No approved link exists, or the link's analysis is missing — create a new one.
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
  },
});

export const { setAnalysis, writeGloss } = analysisSlice.actions;
export default analysisSlice.reducer;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

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
