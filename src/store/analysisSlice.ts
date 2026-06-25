import { createSelector, createSlice, current, type PayloadAction } from '@reduxjs/toolkit';
import type {
  MorphemeAnalysis,
  PhraseAnalysis,
  PhraseAnalysisLink,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
  TokenAnalysisLink,
  TokenSnapshot,
} from 'interlinearizer';
import { emptyAnalysis } from '../types/empty-factories';
import { isEmptyMultiString } from '../utils/multi-string';
import { analysesAreIdentical } from '../utils/analysis-identity';
import {
  buildPoolIndex,
  deriveTokenSuggestion,
  type ResolvedTokenAnalysis,
} from '../utils/suggestion-engine';

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

/** Payload for the {@link writeSegmentFreeTranslation} action, extended with a pre-generated UUID. */
interface WriteSegmentFreeTranslationPayload {
  /** `Segment.id` of the segment being translated. */
  segmentId: string;
  /** Current baseline text of the segment, stored on the `SegmentAnalysis` record. */
  surfaceText: string;
  /** New free-translation string to assign in the active analysis language. */
  value: string;
  /** Pre-generated UUID for a new `SegmentAnalysis` record, produced by the `prepare` callback. */
  id: string;
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
 * Finds the approved `SegmentAnalysisLink` for `segmentId` together with the `SegmentAnalysis` it
 * references. When the approved link references a missing analysis (an orphaned link from
 * corruption or a migration), the link is removed from the draft — so the corruption never persists
 * or accumulates duplicate approved links — and `undefined` is returned as if no approved link
 * existed. Mirrors {@link resolveApprovedAnalysis} for the segment layer.
 *
 * @param state - Current slice state (Immer draft).
 * @param segmentId - `Segment.id` of the segment to look up.
 * @returns The approved link and its analysis, or `undefined` when the segment has none.
 */
function resolveApprovedSegmentAnalysis(
  state: AnalysisState,
  segmentId: string,
): { link: SegmentAnalysisLink; analysis: SegmentAnalysis } | undefined {
  const link = state.analysis.segmentAnalysisLinks.find(
    (l) => l.status === 'approved' && l.segmentId === segmentId,
  );
  if (!link) return undefined;
  const analysis = state.analysis.segmentAnalyses.find((sa) => sa.id === link.analysisId);
  if (!analysis) {
    state.analysis.segmentAnalysisLinks = state.analysis.segmentAnalysisLinks.filter(
      (l) => l !== link,
    );
    return undefined;
  }
  return { link, analysis };
}

/**
 * Determines whether a `SegmentAnalysis` carries no content worth keeping, so a reducer that just
 * emptied the free translation can drop the whole record instead of accumulating empty records in
 * storage. `freeTranslation` and `literalTranslation` each count as empty when they have no entries
 * or every entry is blank ({@link isEmptyMultiString}), so a populated `literalTranslation` (e.g. an
 * imported word-for-word translation) still survives a free-translation clear while a record left
 * holding only whitespace is dropped — mirroring how {@link isEmptyTokenAnalysis} preserves
 * morphemes/pos.
 *
 * @param analysis - The `SegmentAnalysis` to inspect.
 * @returns `true` when the record holds no content worth keeping.
 */
function isEmptySegmentAnalysis(analysis: SegmentAnalysis): boolean {
  return (
    isEmptyMultiString(analysis.freeTranslation) && isEmptyMultiString(analysis.literalTranslation)
  );
}

/**
 * Removes a `SegmentAnalysis` record and its `SegmentAnalysisLink` from the draft in a single step,
 * keeping the two collections in sync. Called when an edit empties an analysis of all content.
 *
 * @param state - Current slice state (Immer draft).
 * @param analysis - The `SegmentAnalysis` record to remove.
 * @param link - The `SegmentAnalysisLink` referencing it.
 */
function removeSegmentAnalysis(
  state: AnalysisState,
  analysis: SegmentAnalysis,
  link: SegmentAnalysisLink,
): void {
  state.analysis.segmentAnalyses = state.analysis.segmentAnalyses.filter((sa) => sa !== analysis);
  state.analysis.segmentAnalysisLinks = state.analysis.segmentAnalysisLinks.filter(
    (l) => l !== link,
  );
}

/**
 * Finds the approved `TokenAnalysisLink` for `tokenRef` together with the `TokenAnalysis` it
 * references. Uses `findLast` so that, in the data-model-violating case of multiple approved links
 * for one token, the reducer mutates the same link the read selectors surface (both
 * {@link selectApprovedIdByTokenRef} and the phrase-link selectors are last-wins); otherwise a write
 * would land on a different link than `useGloss`/`useMorphemes` read and appear to no-op. When the
 * approved link references a missing analysis (an orphaned link from corruption or a migration),
 * the link is removed from the draft — so the corruption never persists or accumulates duplicate
 * approved links — and `undefined` is returned as if no approved link existed. Every token-analysis
 * reducer resolves through this helper so they all repair orphaned links the same way.
 *
 * @param state - Current slice state (Immer draft).
 * @param tokenRef - `Token.ref` of the token to look up.
 * @returns The approved link and its analysis, or `undefined` when the token has none.
 */
function resolveApprovedAnalysis(
  state: AnalysisState,
  tokenRef: string,
): { link: TokenAnalysisLink; analysis: TokenAnalysis } | undefined {
  const link = state.analysis.tokenAnalysisLinks.findLast(
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
 * Links a token to an approved `TokenAnalysis`, doing find-or-create so identical analyses are
 * shared rather than duplicated: if an existing payload is content-identical to `analysis`
 * ({@link analysesAreIdentical}), the new approved link points at that payload and `analysis` is
 * discarded; otherwise `analysis` is appended as a new payload. Either way exactly one approved
 * `TokenAnalysisLink` is pushed, keeping the two collections in sync. The link's token snapshot
 * records _this_ token's surface text (from `analysis.surfaceText`), not the shared payload's, so
 * per-token drift detection stays accurate even when a sentence-initial form links to a payload
 * first created from a mid-sentence form.
 *
 * @param state - Current slice state (Immer draft).
 * @param analysis - The candidate `TokenAnalysis` record to link or, if novel, append.
 * @param tokenRef - `Token.ref` of the token the link points at.
 */
function appendApprovedAnalysis(
  state: AnalysisState,
  analysis: TokenAnalysis,
  tokenRef: string,
): void {
  const existing = state.analysis.tokenAnalyses.find((ta) => analysesAreIdentical(ta, analysis));
  if (!existing) state.analysis.tokenAnalyses.push(analysis);
  state.analysis.tokenAnalysisLinks.push({
    analysisId: existing?.id ?? analysis.id,
    status: 'approved',
    token: { tokenRef, surfaceText: analysis.surfaceText },
  });
}

/**
 * Detaches a token from its analysis once an edit has emptied that analysis of all content: the
 * editing token's `TokenAnalysisLink` is removed, and the `TokenAnalysis` payload itself is removed
 * only when no other link still references it. Because payloads are shared across every token
 * glossed identically (see {@link appendApprovedAnalysis}), removing the link before checking for
 * remaining references is what stops an edit on one token from orphaning a payload that another
 * token still links to. A payload kept alive by a surviving link may be momentarily empty; it is
 * reclaimed when that last link is cleared.
 *
 * @param state - Current slice state (Immer draft).
 * @param analysis - The emptied `TokenAnalysis` payload.
 * @param link - The `TokenAnalysisLink` from the editing token to remove.
 */
function detachTokenAnalysisLink(
  state: AnalysisState,
  analysis: TokenAnalysis,
  link: TokenAnalysisLink,
): void {
  state.analysis.tokenAnalysisLinks = state.analysis.tokenAnalysisLinks.filter((l) => l !== link);
  const stillReferenced = state.analysis.tokenAnalysisLinks.some(
    (l) => l.analysisId === analysis.id,
  );
  if (!stillReferenced) {
    state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter((ta) => ta !== analysis);
  }
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
 * Provenance fields (`confidence`, `producer`, `sourceUser`) are intentionally NOT treated as
 * content: they describe who/what produced an analysis, not an analysis worth keeping on their own.
 * A record holding only provenance and no glosses/morphemes/pos/features is therefore considered
 * empty and may be dropped when its last content field is cleared. This is a deliberate choice — if
 * a future workflow needs provenance-only records (e.g. imported parser metadata) to survive a
 * gloss clear, add the relevant fields to the check below.
 *
 * @param analysis - The `TokenAnalysis` to inspect.
 * @returns `true` when the record holds no analysis content worth keeping.
 */
function isEmptyTokenAnalysis(analysis: TokenAnalysis): boolean {
  return (
    isEmptyMultiString(analysis.gloss) &&
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
            if (isEmptyTokenAnalysis(analysis)) detachTokenAnalysisLink(state, analysis, link);
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
      if (isEmptyTokenAnalysis(analysis)) detachTokenAnalysisLink(state, analysis, link);
    },
    /**
     * Writes a gloss string onto a single morpheme within the approved `TokenAnalysis` for the
     * given token. No-ops when the token has no approved analysis or the morpheme id is not found
     * (an orphaned approved link is still repaired; see {@link resolveApprovedAnalysis}).
     *
     * A blank `value` (empty or whitespace) clears the gloss rather than storing junk: the active
     * language's entry is removed, and when that leaves the morpheme with no glosses the `gloss`
     * object is dropped entirely — mirroring the token-level {@link writeGloss}. The morpheme record
     * itself is kept (a breakdown is content in its own right), so unlike `writeGloss` this never
     * removes the enclosing analysis.
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

      if (value.trim() === '') {
        if (morpheme.gloss) {
          delete morpheme.gloss[lang];
          if (Object.keys(morpheme.gloss).length === 0) delete morpheme.gloss;
        }
        return;
      }

      if (!morpheme.gloss) morpheme.gloss = {};
      morpheme.gloss[lang] = value;
    },
    forkAnalysisForToken: {
      /**
       * Generates a UUID for the forked clone before the action reaches the reducer, keeping the
       * reducer pure.
       *
       * @param tokenRef - `Token.ref` of the token whose approved analysis is being forked.
       * @returns The prepared action payload including a pre-generated clone `id`.
       */
      prepare(tokenRef: string) {
        return { payload: { tokenRef, id: crypto.randomUUID() } };
      },
      /**
       * Forks this token off a shared `TokenAnalysis` so a later edit affects only it: the shared
       * payload is deep-cloned into a new payload (new id, same content including morpheme ids),
       * and this token's approved link is repointed to the clone while every other token stays on
       * the original. The clone is independent — a subsequent {@link writeGloss} /
       * {@link writeMorphemes} resolves to and edits only the clone.
       *
       * No-ops when the token has no approved analysis, and when the payload is not actually shared
       * (this token is its only link): forking a sole-occupant payload would just duplicate it,
       * violating dedupe-on-write ({@link analysesAreIdentical}) and orphaning the original.
       *
       * @param state - Current slice state (Immer draft).
       * @param action - Action carrying the `tokenRef` to fork and the clone `id`.
       */
      reducer(state, action: PayloadAction<{ tokenRef: string; id: string }>) {
        const { tokenRef, id } = action.payload;
        const resolved = resolveApprovedAnalysis(state, tokenRef);
        if (!resolved) return;
        const { link, analysis } = resolved;

        const sharedByOthers = state.analysis.tokenAnalysisLinks.some(
          (l) => l !== link && l.analysisId === analysis.id,
        );
        if (!sharedByOthers) return;

        state.analysis.tokenAnalyses.push({ ...current(analysis), id });
        link.analysisId = id;
      },
    },
    /**
     * Approves an existing shared `TokenAnalysis` payload for a token by appending one approved
     * `TokenAnalysisLink` from the token to that payload's id — the persisted half of accepting a
     * suggestion or promoting a candidate (see {@link selectResolvedTokenAnalysis}). No new payload
     * is created (unlike {@link writeGloss}'s find-or-create); the chosen payload's approval
     * frequency rises by one and the token's derived suggestion disappears now that it carries its
     * own approved decision.
     *
     * Self-protects the "at most one approved link per token" invariant: if the token already has
     * an approved analysis this is a no-op, so a stray double-dispatch or a future caller can never
     * append a second approved link — the UI only offers accept/promote on un-approved tokens, but
     * the reducer no longer relies on that alone. Resolving through {@link resolveApprovedAnalysis}
     * also repairs an orphaned approved link first: a token whose approved link the read selectors
     * ignore (it points at a missing payload) still shows a suggestion, so accepting it must heal
     * the orphan and proceed rather than be blocked by it. The link's snapshot records _this_
     * token's `surfaceText` (not the shared payload's), matching {@link appendApprovedAnalysis} so
     * per-token drift detection stays accurate.
     *
     * @param state - Current slice state (Immer draft).
     * @param action - Action carrying the accepting `tokenRef`, its `surfaceText`, and the
     *   `analysisId` of the payload to approve (the suggested payload, or a candidate when
     *   promoting).
     */
    approveAnalysisForToken(
      state,
      action: PayloadAction<{ tokenRef: string; surfaceText: string; analysisId: string }>,
    ) {
      const { tokenRef, surfaceText, analysisId } = action.payload;
      if (resolveApprovedAnalysis(state, tokenRef)) return;
      state.analysis.tokenAnalysisLinks.push({
        analysisId,
        status: 'approved',
        token: { tokenRef, surfaceText },
      });
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
    writeSegmentFreeTranslation: {
      /**
       * Generates a UUID for a potential new `SegmentAnalysis` record before the action reaches the
       * reducer, keeping the reducer pure.
       *
       * @param segmentId - `Segment.id` of the segment being translated.
       * @param surfaceText - Baseline text of the segment.
       * @param value - New free-translation string.
       * @returns The prepared action payload including a pre-generated `id`.
       */
      prepare(segmentId: string, surfaceText: string, value: string) {
        return { payload: { segmentId, surfaceText, value, id: crypto.randomUUID() } };
      },
      /**
       * Creates or updates the approved `SegmentAnalysis` carrying a segment's free translation. If
       * an approved link already exists for `segmentId`, its analysis is updated in place and the
       * stored surface text is refreshed, so it never goes stale when the baseline text changed
       * since the analysis was first written. Otherwise a new `SegmentAnalysis` and approved
       * `SegmentAnalysisLink` are appended (an orphaned approved link is repaired first; see
       * {@link resolveApprovedSegmentAnalysis}).
       *
       * A blank `value` (empty or whitespace) clears the free translation rather than writing junk:
       * the active language's entry is removed, and when that leaves the analysis with no content
       * ({@link isEmptySegmentAnalysis}) the record and its link are removed entirely. A blank write
       * to a segment with no approved analysis is a no-op, so a focus/blur cycle on an empty input
       * never creates a record.
       *
       * @param state - Current slice state (Immer draft).
       * @param action - Action carrying the `WriteSegmentFreeTranslationPayload`.
       */
      reducer(state, action: PayloadAction<WriteSegmentFreeTranslationPayload>) {
        const { segmentId, surfaceText, value, id } = action.payload;
        const lang = state.analysisLanguage;
        const isBlank = value.trim() === '';

        const resolved = resolveApprovedSegmentAnalysis(state, segmentId);
        if (resolved) {
          const { link, analysis } = resolved;
          analysis.surfaceText = surfaceText;
          if (isBlank) {
            if (analysis.freeTranslation) {
              delete analysis.freeTranslation[lang];
              if (Object.keys(analysis.freeTranslation).length === 0)
                delete analysis.freeTranslation;
            }
            if (isEmptySegmentAnalysis(analysis)) removeSegmentAnalysis(state, analysis, link);
            return;
          }
          if (!analysis.freeTranslation) analysis.freeTranslation = {};
          analysis.freeTranslation[lang] = value;
          return;
        }

        if (isBlank) return;
        const newAnalysis: SegmentAnalysis = {
          id,
          surfaceText,
          freeTranslation: { [lang]: value },
        };
        const newLink: SegmentAnalysisLink = { analysisId: id, status: 'approved', segmentId };
        state.analysis.segmentAnalyses.push(newAnalysis);
        state.analysis.segmentAnalysisLinks.push(newLink);
      },
    },
  },
});

export const {
  writeGloss,
  writeMorphemes,
  deleteMorphemes,
  writeMorphemeGloss,
  forkAnalysisForToken,
  approveAnalysisForToken,
  createPhrase,
  updatePhrase,
  deletePhrase,
  mergePhrases,
  writePhraseGloss,
  writeSegmentFreeTranslation,
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

/**
 * Memoized selector mapping each approved `TokenAnalysis.id` to the number of distinct tokens whose
 * approved link points at it — the blast radius of a global edit to that payload. Built from
 * {@link selectApprovedIdByTokenRef}, which holds at most one approved analysis per token, so
 * multiple approved links on the same token are never double-counted. Recomputes only when that map
 * changes reference.
 */
const selectApprovedTokenCountByAnalysisId = createSelector(
  selectApprovedIdByTokenRef,
  (idByTokenRef) => {
    const counts = new Map<string, number>();
    idByTokenRef.forEach((analysisId) => {
      counts.set(analysisId, (counts.get(analysisId) ?? 0) + 1);
    });
    return counts;
  },
);

/**
 * Returns how many tokens share `tokenRef`'s approved analysis — i.e. how many tokens a global edit
 * to that payload would affect. Returns `0` when the token has no approved analysis, `1` for a
 * payload occupied by this token alone, and `N` for one shared by `N` tokens. The UI uses this to
 * decide whether a human edit needs confirmation (count > 1) and to phrase "used by N tokens".
 *
 * @param state - The analysis slice state.
 * @param tokenRef - The `Token.ref` whose approved payload to measure.
 * @returns The number of tokens sharing the payload, or `0` when there is no approved analysis.
 */
export function selectApprovedLinkCountForPayload(state: AnalysisState, tokenRef: string): number {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (!approvedId) return 0;
  const count = selectApprovedTokenCountByAnalysisId(state).get(approvedId);
  /* v8 ignore next -- approvedId comes from the same approved map, so its count is always present */
  if (count === undefined) return 0;
  return count;
}

/**
 * Memoized selector that builds the suggestion-engine pool index from the approved analyses: each
 * distinct approved payload filed under its normalized surface form with its approval frequency
 * (see {@link buildPoolIndex}). This is the read-only corpus the engine derives suggestions from —
 * only approved analyses enter, because {@link selectApprovedTokenCountByAnalysisId} counts approved
 * links alone. Recomputes only when `tokenAnalyses` or `tokenAnalysisLinks` change reference.
 */
export const selectPoolIndex = createSelector(
  selectAnalysisById,
  selectApprovedTokenCountByAnalysisId,
  buildPoolIndex,
);

/**
 * Returns the merged analysis the renderer shows for a token: its approved decision when one
 * exists, otherwise the engine's suggestion derived live from {@link selectPoolIndex}, or
 * `undefined` when the token has neither. This is the single source the gloss renderer reads — it
 * never combines stored decisions and the derived view itself. An approved decision short-circuits
 * before the pool is consulted, so a confirmed token never shows a suggestion.
 *
 * Unlike the reference-stable per-token reads ({@link selectApprovedGloss} returns a primitive,
 * {@link selectApprovedMorphemes} a stable array), this freshly allocates its result object — and
 * the suggested branch a fresh `candidates` array — on every call. A `useSelector` consumer must
 * therefore NOT rely on the default `Object.is` equality: subscribe through a per-token memoized
 * selector or pass a shallow/custom `equalityFn` (or `useMemo` the result), or every store change
 * will re-render the token and trip react-redux's "selector returned a different result" warning.
 *
 * @param state - The analysis slice state.
 * @param tokenRef - The `Token.ref` to resolve.
 * @param surfaceText - The token's current surface text, matched against the pool when the token is
 *   unapproved.
 * @returns The approved or suggested analysis for the token, or `undefined` when it has neither.
 */
export function selectResolvedTokenAnalysis(
  state: AnalysisState,
  tokenRef: string,
  surfaceText: string,
): ResolvedTokenAnalysis | undefined {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId !== undefined) {
    const analysis = selectAnalysisById(state).get(approvedId);
    /* v8 ignore next -- approvedId comes from the byId-filtered approved map, so the payload is present */
    if (!analysis) return undefined;
    return { status: 'approved', analysis };
  }
  const suggestion = deriveTokenSuggestion(selectPoolIndex(state), surfaceText);
  return suggestion ? { status: 'suggested', ...suggestion } : undefined;
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

/**
 * Returns the approved free-translation string for the given segment in the active analysis
 * language, or `''` when no approved analysis exists or it has no free translation for the active
 * language. An approved link referencing a missing analysis is treated as absent (read-only here;
 * the orphan is repaired on the next write through {@link resolveApprovedSegmentAnalysis}).
 *
 * @param state - The analysis slice state.
 * @param segmentId - The `Segment.id` to look up.
 * @returns The free-translation string, or `''` when absent.
 */
export function selectSegmentFreeTranslation(state: AnalysisState, segmentId: string): string {
  const link = state.analysis.segmentAnalysisLinks.find(
    (l) => l.status === 'approved' && l.segmentId === segmentId,
  );
  if (!link) return '';
  const sa = state.analysis.segmentAnalyses.find((a) => a.id === link.analysisId);
  return sa?.freeTranslation?.[state.analysisLanguage] ?? '';
}

// #endregion
