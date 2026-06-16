import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  MorphemeAnalysis,
  PhraseAnalysis,
  PhraseAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
  TokenSnapshot,
} from 'interlinearizer';
import { emptyAnalysis } from '../types/empty-factories';

// #region Types

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

/** Payload for the {@link mergePhrases} action. */
interface MergePhrasesPayload {
  /** ID of the `PhraseAnalysis` to keep and grow; receives the merged token list. */
  targetPhraseId: string;
  /** The combined, document-ordered `TokenSnapshot`s for the target phrase. */
  tokens: TokenSnapshot[];
  /**
   * ID of a neighboring phrase whose tokens were folded into `tokens` and that must be deleted in
   * the same step. `undefined` when the absorbed neighbor was a free (unphrased) token, so there is
   * no phrase record to remove.
   */
  absorbedPhraseId?: string;
}

/** Payload for the {@link writePhraseGloss} action. */
interface WritePhraseGlossPayload {
  /** ID of the `PhraseAnalysis` to update. */
  phraseId: string;
  /** New gloss string to assign in the active analysis language. */
  value: string;
}

// #endregion

// #region Default state

/** Default `AnalysisState` used as the Redux initial state. */
export const defaultState: AnalysisState = {
  analysis: emptyAnalysis(),
  analysisLanguage: 'und',
};

// #endregion

// #region Slice

/**
 * Derives the display surface text for a phrase by joining each token's surface text with a space.
 *
 * @param tokens - Ordered token snapshots forming the phrase, in document order.
 * @returns The space-joined surface text string.
 */
function phraseSurfaceText(tokens: TokenSnapshot[]): string {
  return tokens.map((t) => t.surfaceText).join(' ');
}

/**
 * Removes the `PhraseAnalysis` record and its `PhraseAnalysisLink` matching `phraseId` from the
 * Immer draft state in a single step, ensuring both collections stay in sync.
 *
 * @param state - Current slice state (Immer draft).
 * @param phraseId - ID of the phrase to remove.
 */
function removePhraseById(state: AnalysisState, phraseId: string): void {
  state.analysis.phraseAnalyses = state.analysis.phraseAnalyses.filter((pa) => pa.id !== phraseId);
  state.analysis.phraseAnalysisLinks = state.analysis.phraseAnalysisLinks.filter(
    (pl) => pl.analysisId !== phraseId,
  );
}

/**
 * Finds the approved `TokenAnalysisLink` for `tokenRef` together with the `TokenAnalysis` it
 * references. When the approved link references a missing analysis (an orphaned link from
 * corruption or a migration), the link is removed from the draft — so the corruption never persists
 * or accumulates duplicate approved links — and `undefined` is returned as if no approved link
 * existed. Every token-analysis reducer resolves through this helper so they all repair orphaned
 * links the same way.
 *
 * @param state - Current slice state (Immer draft).
 * @param tokenRef - `Token.ref` of the token to look up.
 * @returns The approved link and its analysis, or `undefined` when the token has none.
 */
function resolveApprovedAnalysis(
  state: AnalysisState,
  tokenRef: string,
): { link: TokenAnalysisLink; analysis: TokenAnalysis } | undefined {
  const link = state.analysis.tokenAnalysisLinks.find(
    (l) => l.status === 'approved' && l.token.tokenRef === tokenRef,
  );
  if (!link) return undefined;
  const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === link.analysisId);
  if (!analysis) {
    state.analysis.tokenAnalysisLinks = state.analysis.tokenAnalysisLinks.filter((l) => l !== link);
    return undefined;
  }
  return { link, analysis };
}

/**
 * Appends a new `TokenAnalysis` and an approved `TokenAnalysisLink` referencing it in a single
 * step, ensuring both collections stay in sync. The link's token snapshot takes its surface text
 * from the analysis.
 *
 * @param state - Current slice state (Immer draft).
 * @param analysis - The new `TokenAnalysis` record to append.
 * @param tokenRef - `Token.ref` of the token the link points at.
 */
function appendApprovedAnalysis(
  state: AnalysisState,
  analysis: TokenAnalysis,
  tokenRef: string,
): void {
  state.analysis.tokenAnalyses.push(analysis);
  state.analysis.tokenAnalysisLinks.push({
    analysisId: analysis.id,
    status: 'approved',
    token: { tokenRef, surfaceText: analysis.surfaceText },
  });
}

/**
 * Removes a `TokenAnalysis` record and its `TokenAnalysisLink` from the draft in a single step,
 * keeping the two collections in sync. Called when an edit empties an analysis of all content so
 * empty records do not accumulate in storage.
 *
 * @param state - Current slice state (Immer draft).
 * @param analysis - The `TokenAnalysis` record to remove.
 * @param link - The `TokenAnalysisLink` referencing it.
 */
function removeTokenAnalysis(
  state: AnalysisState,
  analysis: TokenAnalysis,
  link: TokenAnalysisLink,
): void {
  state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter((ta) => ta !== analysis);
  state.analysis.tokenAnalysisLinks = state.analysis.tokenAnalysisLinks.filter((l) => l !== link);
}

/**
 * Determines whether a `TokenAnalysis` carries no analysis content, so a reducer that just emptied
 * one field can decide to drop the whole record instead of letting empty records accumulate in
 * storage. Checks every content field of the type — `gloss`, `morphemes`, `pos`, `features`, and
 * `glossSenseRef` — not only the field the caller emptied, so records carrying imported
 * morphosyntactic or lexicon data are never discarded by an unrelated edit. A gloss counts as empty
 * when it has no entries or every entry is blank, so a record left holding only whitespace glosses
 * (junk from clearing a gloss field) is treated the same as one with no gloss at all.
 *
 * @param analysis - The `TokenAnalysis` to inspect.
 * @returns `true` when the record holds no analysis content worth keeping.
 */
function isEmptyTokenAnalysis(analysis: TokenAnalysis): boolean {
  return (
    (!analysis.gloss || Object.values(analysis.gloss).every((g) => g.trim() === '')) &&
    /* v8 ignore next -- the length===0 sub-branch needs an empty-but-defined morphemes array, which no caller produces */
    (!analysis.morphemes || analysis.morphemes.length === 0) &&
    analysis.pos === undefined &&
    analysis.features === undefined &&
    analysis.glossSenseRef === undefined
  );
}

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
       * already exists for `tokenRef`, its analysis is updated in place and the stored surface text
       * is refreshed on both the analysis and the link's token snapshot, so neither goes stale when
       * the baseline text changed since the analysis was first written. Otherwise a new
       * `TokenAnalysis` and `TokenAnalysisLink` are appended (an orphaned approved link is repaired
       * first; see {@link resolveApprovedAnalysis}). Non-approved analyses for the token are left
       * untouched.
       *
       * A blank `value` (empty or whitespace) is treated as clearing the gloss rather than writing
       * junk: the active language's entry is removed, and when that leaves the analysis with no
       * content ({@link isEmptyTokenAnalysis}) the record and its link are removed entirely. A blank
       * write to a token with no approved analysis is a no-op, so a focus/blur cycle on an empty
       * gloss never creates a record.
       *
       * @param state - Current slice state (Immer draft).
       * @param action - Action carrying the `WriteGlossPayload`.
       */
      reducer(state, action: PayloadAction<WriteGlossPayload>) {
        const { tokenRef, surfaceText, value, id } = action.payload;
        const lang = state.analysisLanguage;
        const isBlank = value.trim() === '';

        const resolved = resolveApprovedAnalysis(state, tokenRef);
        if (resolved) {
          const { link, analysis } = resolved;
          analysis.surfaceText = surfaceText;
          link.token.surfaceText = surfaceText;
          if (isBlank) {
            if (analysis.gloss) {
              delete analysis.gloss[lang];
              if (Object.keys(analysis.gloss).length === 0) delete analysis.gloss;
            }
            if (isEmptyTokenAnalysis(analysis)) removeTokenAnalysis(state, analysis, link);
            return;
          }
          if (!analysis.gloss) analysis.gloss = {};
          analysis.gloss[lang] = value;
          return;
        }

        if (isBlank) return;
        appendApprovedAnalysis(state, { id, surfaceText, gloss: { [lang]: value } }, tokenRef);
      },
    },
    writeMorphemes: {
      /**
       * Generates UUIDs for new morpheme records and a potential new `TokenAnalysis` before the
       * action reaches the reducer.
       *
       * @param tokenRef - `Token.ref` of the token whose morphemes are being set.
       * @param surfaceText - Surface text of the token.
       * @param forms - Ordered morpheme form strings as entered by the user.
       * @param writingSystem - BCP 47 tag of the token's surface text (`Token.writingSystem`),
       *   stored on each morpheme as the writing system of its form.
       * @returns The prepared action payload.
       */
      prepare(tokenRef: string, surfaceText: string, forms: string[], writingSystem: string) {
        return {
          payload: {
            tokenRef,
            surfaceText,
            writingSystem,
            analysisId: crypto.randomUUID(),
            morphemes: forms.map((form) => ({ id: crypto.randomUUID(), form })),
          },
        };
      },
      /**
       * Sets the morpheme breakdown on the approved `TokenAnalysis` for the given token. When a
       * morpheme form is unchanged the existing morpheme record is preserved whole — including its
       * id, which `MorphemeLink.morphemeId` cross-references, so alignment links to unchanged
       * morphemes survive edits to the rest of the breakdown. When no approved analysis exists,
       * creates one (an orphaned approved link is repaired first; see
       * {@link resolveApprovedAnalysis}). Also refreshes the stored surface text on both the
       * analysis and the link's token snapshot, so neither goes stale when the baseline text
       * changed since the analysis was first written. Every morpheme — preserved or new — is
       * stamped with the supplied writing system, so records written before the writing system was
       * threaded through (which wrongly stored the analysis language) self-correct on the next
       * save.
       *
       * @param state - Current slice state (Immer draft).
       * @param action - Action carrying the morpheme payload.
       */
      reducer(
        state,
        action: PayloadAction<{
          tokenRef: string;
          surfaceText: string;
          writingSystem: string;
          analysisId: string;
          morphemes: Array<{ id: string; form: string }>;
        }>,
      ) {
        const { tokenRef, surfaceText, writingSystem, analysisId, morphemes } = action.payload;

        const resolved = resolveApprovedAnalysis(state, tokenRef);
        if (resolved) {
          const { link, analysis } = resolved;
          analysis.surfaceText = surfaceText;
          link.token.surfaceText = surfaceText;
          // Multimap with consumed entries so duplicate forms (e.g. reduplication "ba ba") each
          // match a distinct old morpheme in order, instead of all inheriting the last one.
          const oldByForm = new Map<string, MorphemeAnalysis[]>();
          (analysis.morphemes ?? []).forEach((m) => {
            const bucket = oldByForm.get(m.form);
            if (bucket) bucket.push(m);
            else oldByForm.set(m.form, [m]);
          });
          analysis.morphemes = morphemes.map(({ id, form }) => {
            const old = oldByForm.get(form)?.shift();
            // Keep the preserved morpheme's id (the prepared id is discarded) so external
            // references to it stay valid; only the writing system is refreshed.
            if (old) return { ...old, writingSystem };
            return { id, form, writingSystem };
          });
          return;
        }

        appendApprovedAnalysis(
          state,
          {
            id: analysisId,
            surfaceText,
            morphemes: morphemes.map(({ id, form }) => ({ id, form, writingSystem })),
          },
          tokenRef,
        );
      },
    },
    /**
     * Removes the morpheme breakdown from the approved `TokenAnalysis` for the given token. When
     * the analysis carries no other content (gloss, POS, features, or lexicon sense reference — see
     * {@link isEmptyTokenAnalysis}), the now-empty analysis record and its link are removed entirely
     * so empty records do not accumulate in storage. No-ops when the token has no approved analysis
     * or the analysis has no morphemes (an orphaned approved link is still repaired; see
     * {@link resolveApprovedAnalysis}).
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the `tokenRef` whose breakdown is removed.
     */
    deleteMorphemes(state, action: PayloadAction<{ tokenRef: string }>) {
      const { tokenRef } = action.payload;

      const resolved = resolveApprovedAnalysis(state, tokenRef);
      if (!resolved?.analysis.morphemes) return;
      const { link, analysis } = resolved;

      delete analysis.morphemes;
      if (isEmptyTokenAnalysis(analysis)) removeTokenAnalysis(state, analysis, link);
    },
    /**
     * Writes a gloss string onto a single morpheme within the approved `TokenAnalysis` for the
     * given token. No-ops when the token has no approved analysis or the morpheme id is not found
     * (an orphaned approved link is still repaired; see {@link resolveApprovedAnalysis}).
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the morpheme gloss payload.
     */
    writeMorphemeGloss(
      state,
      action: PayloadAction<{ tokenRef: string; morphemeId: string; value: string }>,
    ) {
      const { tokenRef, morphemeId, value } = action.payload;
      const lang = state.analysisLanguage;

      const resolved = resolveApprovedAnalysis(state, tokenRef);
      const morpheme = resolved?.analysis.morphemes?.find((m) => m.id === morphemeId);
      if (!morpheme) return;

      if (!morpheme.gloss) morpheme.gloss = {};
      morpheme.gloss[lang] = value;
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
        const newAnalysis: PhraseAnalysis = { id, surfaceText: phraseSurfaceText(tokens) };
        const newLink: PhraseAnalysisLink = { analysisId: id, status: 'approved', tokens };
        state.analysis.phraseAnalyses.push(newAnalysis);
        state.analysis.phraseAnalysisLinks.push(newLink);
      },
    },
    /**
     * Replaces the token list of the matching `PhraseAnalysisLink` and re-derives the
     * `PhraseAnalysis.surfaceText` from the new tokens (mirroring `createPhrase`) so the persisted
     * surface form never goes stale. Does not create a new `PhraseAnalysis` record — preserves the
     * phrase id and any gloss already written on it. When `tokens` is empty the phrase is removed
     * entirely (both the analysis record and its link) so a zero-token phrase can never persist in
     * the store.
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the `UpdatePhrasePayload`.
     */
    updatePhrase(state, action: PayloadAction<UpdatePhrasePayload>) {
      const { phraseId, tokens } = action.payload;
      if (tokens.length === 0) {
        removePhraseById(state, phraseId);
        return;
      }
      const link = state.analysis.phraseAnalysisLinks.find((l) => l.analysisId === phraseId);
      if (link) link.tokens = tokens;
      const analysis = state.analysis.phraseAnalyses.find((pa) => pa.id === phraseId);
      if (analysis) analysis.surfaceText = phraseSurfaceText(tokens);
    },
    /**
     * Removes the `PhraseAnalysis` record and its `PhraseAnalysisLink` for the given phrase id.
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the `DeletePhrasePayload`.
     */
    deletePhrase(state, action: PayloadAction<DeletePhrasePayload>) {
      const { phraseId } = action.payload;
      removePhraseById(state, phraseId);
    },
    /**
     * Merges a neighboring phrase (or a free token) into the target phrase as a single atomic
     * mutation: the target's tokens are replaced with the supplied merged list and, when an
     * `absorbedPhraseId` is given, that neighbor's analysis record and link are removed in the same
     * step. Doing both in one reducer avoids the transient state — produced when `updatePhrase` and
     * `deletePhrase` were dispatched separately — where the neighbor's tokens briefly existed in
     * two phrases at once, which a save between the two dispatches could persist.
     *
     * No-ops when `absorbedPhraseId === targetPhraseId` to prevent the update from being
     * immediately undone by the delete.
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the `MergePhrasesPayload`.
     */
    mergePhrases(state, action: PayloadAction<MergePhrasesPayload>) {
      const { targetPhraseId, tokens, absorbedPhraseId } = action.payload;
      if (absorbedPhraseId !== undefined && absorbedPhraseId === targetPhraseId) return;

      const link = state.analysis.phraseAnalysisLinks.find((l) => l.analysisId === targetPhraseId);
      if (link) link.tokens = tokens;
      const analysis = state.analysis.phraseAnalyses.find((pa) => pa.id === targetPhraseId);
      if (analysis) analysis.surfaceText = phraseSurfaceText(tokens);
      if (absorbedPhraseId !== undefined) removePhraseById(state, absorbedPhraseId);
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
  writeMorphemes,
  deleteMorphemes,
  writeMorphemeGloss,
  createPhrase,
  updatePhrase,
  deletePhrase,
  mergePhrases,
  writePhraseGloss,
} = analysisSlice.actions;
export default analysisSlice.reducer;

// #endregion

// #region Selectors

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
export const selectAnalysisLanguage = (state: AnalysisState) => state.analysisLanguage;

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

const EMPTY_MORPHEMES: readonly MorphemeAnalysis[] = [];

/**
 * Returns the morpheme array from the approved `TokenAnalysis` for `tokenRef`, or an empty array
 * when no approved analysis exists or it has no morphemes.
 *
 * @param state - The analysis slice state.
 * @param tokenRef - The `Token.ref` to look up.
 * @returns The morpheme array, or a stable empty array when absent.
 */
export function selectApprovedMorphemes(
  state: AnalysisState,
  tokenRef: string,
): readonly MorphemeAnalysis[] {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (!approvedId) return EMPTY_MORPHEMES;
  const ta = selectAnalysisById(state).get(approvedId);
  return ta?.morphemes ?? EMPTY_MORPHEMES;
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
export const selectPhraseLinkByTokenRef = createSelector(selectPhraseLinks, (links) => {
  const map = new Map<string, PhraseAnalysisLink>();
  links.forEach((link) => link.tokens.forEach((snap) => map.set(snap.tokenRef, link)));
  return map;
});

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

// #endregion
