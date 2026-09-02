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
import { analysesAreIdentical, normalizeSurfaceForm } from '../utils/analysis-identity';
import { buildCatalogRows } from '../utils/analysis-query';
import { isEmptyMultiString } from '../utils/multi-string';
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
  /**
   * The record the last write's collapse left standing. Reports a collapse the state cannot show: a
   * record holding no links — how an imported wordform inventory arrives — repoints nothing when it
   * collapses, leaving what its removal would leave. Never reaches storage.
   */
  lastCollapseSurvivorId?: string;
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
  /** ISO 8601 stamp for the records this write touches, produced by the `prepare` callback. */
  now: string;
}

/** Payload for the {@link createPhrase} action. */
interface CreatePhrasePayload {
  /** Pre-generated UUID for the new `PhraseAnalysis`, produced by the `prepare` callback. */
  id: string;
  /** Ordered `TokenSnapshot`s forming the phrase, in document order. */
  tokens: TokenSnapshot[];
  /** ISO 8601 stamp for the new records, produced by the `prepare` callback. */
  now: string;
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
  /** ISO 8601 stamp for the records this write touches, produced by the `prepare` callback. */
  now: string;
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

function nowIso(): string {
  return new Date().toISOString();
}

/** Derives the display surface text for a phrase by joining each token's surface text with a space. */
function phraseSurfaceText(tokens: TokenSnapshot[]): string {
  return tokens.map((t) => t.surfaceText).join(' ');
}

/**
 * Stamps a phrase's attachment as touched by a user edit. A {@link PhraseAnalysisLink} records when
 * a write last reached its payload by way of that target, so a write landing on the payload
 * advances the link too.
 */
function touchPhraseLink(state: AnalysisState, phraseId: string, now: string): void {
  const link = state.analysis.phraseAnalysisLinks.find((l) => l.analysisId === phraseId);
  /* v8 ignore next -- a phrase payload and its link are always created and removed together */
  if (link) link.updatedAt = now;
}

/**
 * Removes the `PhraseAnalysis` record and its `PhraseAnalysisLink` matching `phraseId` from the
 * Immer draft state in a single step, ensuring both collections stay in sync.
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
 * or every entry is blank, so a populated `literalTranslation` (e.g. an imported word-for-word
 * translation) still survives a free-translation clear while a record left holding only whitespace
 * is dropped — mirroring how {@link isEmptyTokenAnalysis} preserves morphemes/pos.
 */
function isEmptySegmentAnalysis(analysis: SegmentAnalysis): boolean {
  return (
    isEmptyMultiString(analysis.freeTranslation) && isEmptyMultiString(analysis.literalTranslation)
  );
}

/**
 * Removes a `SegmentAnalysis` record and its `SegmentAnalysisLink` from the draft in a single step,
 * keeping the two collections in sync. Called when an edit empties an analysis of all content.
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
 * would land on a different link than the one those selectors read and appear to no-op. When the
 * approved link references a missing analysis (an orphaned link from corruption or a migration),
 * the link is removed from the draft — so the corruption never persists or accumulates duplicate
 * approved links — and `undefined` is returned as if no approved link existed. Every token-analysis
 * reducer resolves through this helper so they all repair orphaned links the same way.
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
 * Adopting an existing payload leaves that payload's timestamps alone — no write lands on it —
 * while the new link is stamped with the write time, so the shared analysis keeps the age of the
 * record and this token records when it took the analysis on.
 */
function appendApprovedAnalysis(
  state: AnalysisState,
  analysis: TokenAnalysis,
  tokenRef: string,
  now: string,
): void {
  const existing = state.analysis.tokenAnalyses.find((ta) => analysesAreIdentical(ta, analysis));
  if (!existing) state.analysis.tokenAnalyses.push(analysis);
  state.analysis.tokenAnalysisLinks.push({
    analysisId: existing?.id ?? analysis.id,
    createdAt: now,
    updatedAt: now,
    status: 'approved',
    token: { tokenRef, surfaceText: analysis.surfaceText },
  });
}

/**
 * Detaches a token from its analysis once an edit has emptied that analysis of all content: the
 * editing token's `TokenAnalysisLink` is removed, and the `TokenAnalysis` payload itself is removed
 * only when no other link still references it. Because payloads are shared across every token
 * glossed identically, removing the link before checking for remaining references is what stops an
 * edit on one token from orphaning a payload that another token still links to. A payload kept
 * alive by a surviving link may be momentarily empty; it is reclaimed when that last link is
 * cleared.
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
 * Reports whether `analysisId`'s payload is referenced by any approved link other than `link` —
 * i.e. whether an edit or clear reaching it through `link`'s token would also affect a different
 * token. The shared/sole distinction is what tells a clear, delete, or fork whether it must work on
 * a private clone (to spare the co-linked tokens) or may mutate the payload in place.
 */
function isPayloadSharedByOtherLinks(
  state: AnalysisState,
  link: TokenAnalysisLink,
  analysisId: string,
): boolean {
  return state.analysis.tokenAnalysisLinks.some(
    (l) => l !== link && l.status === 'approved' && l.analysisId === analysisId,
  );
}

/**
 * Forks a shared `TokenAnalysis` payload onto a private clone under `cloneId` and repoints `link`
 * (the editing token's approved link) to the clone, so a following in-place edit or clear touches
 * only this token while every other token keeps the original shared payload. The clone carries the
 * same content (including morpheme ids) under a new id, with fresh copies of the mutable `gloss`
 * and `morphemes` containers so the returned draft can be edited or cleared in the same reducer
 * without writing through to the frozen shared payload.
 *
 * The clone is dated by the write rather than inheriting the original's age: it is a record of its
 * own, made to carry a change the original must not receive.
 */
function forkSharedAnalysis(
  state: AnalysisState,
  link: TokenAnalysisLink,
  analysis: TokenAnalysis,
  cloneId: string,
  now: string,
): TokenAnalysis {
  const source = current(analysis);
  state.analysis.tokenAnalyses.push({
    ...source,
    id: cloneId,
    createdAt: now,
    updatedAt: now,
    ...(source.gloss ? { gloss: { ...source.gloss } } : {}),
    ...(source.morphemes ? { morphemes: source.morphemes.map((m) => ({ ...m })) } : {}),
  });
  link.analysisId = cloneId;
  return state.analysis.tokenAnalyses[state.analysis.tokenAnalyses.length - 1];
}

/**
 * Re-converges a just-edited payload onto an existing content-identical one, so an in-place edit
 * can never leave two identical payloads the way the create path's find-or-create prevents on first
 * write. When another `TokenAnalysis` is now {@link analysesAreIdentical} to `analysis`, every link
 * pointing at `analysis` is repointed to that payload and `analysis` is dropped — collapsing a
 * homograph instance that was edited to match a sibling back onto one shared payload (frequency
 * re-merged, no duplicate suggestion). A no-op when the edit left the payload unique.
 *
 * The surviving payload keeps its own timestamps and the repointed links keep theirs: no write was
 * aimed at the survivor or at any token's annotation, only at which record holds the content.
 *
 * Leaves the survivor in {@link AnalysisState.lastCollapseSurvivorId}.
 */
function mergeIntoIdenticalPayload(state: AnalysisState, analysis: TokenAnalysis): void {
  const other = state.analysis.tokenAnalyses.find(
    (ta) => ta !== analysis && analysesAreIdentical(ta, analysis),
  );
  if (!other) return;
  state.analysis.tokenAnalysisLinks.forEach((l) => {
    if (l.analysisId === analysis.id) l.analysisId = other.id;
  });
  state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter((ta) => ta !== analysis);
  state.lastCollapseSurvivorId = other.id;
}

/**
 * Drops a `TokenAnalysis` and every link pointing at it, addressed by id alone — so the record goes
 * on its own terms and takes every token with it, rather than being retired as one token lets go of
 * it. A no-op when the id resolves to no payload.
 */
function removeAnalysisAndLinks(state: AnalysisState, analysisId: string): void {
  state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter((ta) => ta.id !== analysisId);
  state.analysis.tokenAnalysisLinks = state.analysis.tokenAnalysisLinks.filter(
    (l) => l.analysisId !== analysisId,
  );
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

/**
 * Re-segments a breakdown, carrying an unchanged morpheme across whole: it keeps its id, so
 * `MorphemeLink.morphemeId` and every other reference to it stays valid, along with its gloss and
 * its lexicon references, and only its writing system is refreshed. A form the old breakdown cannot
 * account for takes the prepared id.
 *
 * Forms are matched in order, so a form repeated within one breakdown (reduplication such as "ba
 * ba") takes a distinct old morpheme for each occurrence rather than every occurrence inheriting
 * the same one.
 */
function reconcileMorphemes(
  old: readonly MorphemeAnalysis[] | undefined,
  morphemes: readonly { id: string; form: string }[],
  writingSystem: string,
): MorphemeAnalysis[] {
  const oldByForm = new Map<string, MorphemeAnalysis[]>();
  (old ?? []).forEach((m) => {
    const bucket = oldByForm.get(m.form);
    if (bucket) bucket.push(m);
    else oldByForm.set(m.form, [m]);
  });
  return morphemes.map(({ id, form }) => {
    const kept = oldByForm.get(form)?.shift();
    return kept ? { ...kept, writingSystem } : { id, form, writingSystem };
  });
}

/**
 * The glossed forms a re-split to `forms` would strand: those whose morpheme carries a gloss and
 * which the new breakdown leaves no morpheme to hold, in the order the old breakdown listed them.
 * Empty when the re-split keeps every glossed form, which is the common case.
 *
 * Forms are matched as a re-split itself matches them — by form, first-come-first-served within a
 * repeated form — so the answer can never disagree with what the write goes on to drop. A form is
 * counted once per occurrence: re-splitting "ba ba" to a single "ba" strands the second.
 *
 * Unglossed forms are left out. Losing one costs only the segmentation, which the reader is
 * retyping anyway, and prompting about it would train them to click through the prompt that does
 * carry a loss.
 */
export function morphemeFormsLostByResplit(
  old: readonly MorphemeAnalysis[] | undefined,
  forms: readonly string[],
): string[] {
  const remaining = new Map<string, number>();
  forms.forEach((form) => remaining.set(form, (remaining.get(form) ?? 0) + 1));
  return (old ?? []).reduce<string[]>((lost, morpheme) => {
    const spare = remaining.get(morpheme.form) ?? 0;
    if (spare > 0) remaining.set(morpheme.form, spare - 1);
    else if (morpheme.gloss !== undefined) lost.push(morpheme.form);
    return lost;
  }, []);
}

const analysisSlice = createSlice({
  name: 'analysis',
  initialState: defaultState,
  reducers: {
    writeGloss: {
      /**
       * Generates a UUID for a potential new `TokenAnalysis` record before the action reaches the
       * reducer, keeping the reducer pure.
       */
      prepare(tokenRef: string, surfaceText: string, value: string) {
        return {
          payload: { tokenRef, surfaceText, value, id: crypto.randomUUID(), now: nowIso() },
        };
      },
      /**
       * Creates or updates an approved `TokenAnalysis` for the given token. If an approved link
       * already exists for `tokenRef`, its analysis is updated and the stored surface text is
       * refreshed on both the analysis and the link's token snapshot, so neither goes stale when
       * the baseline text changed since the analysis was first written. The edit is **per-token**:
       * when the payload is shared by other tokens, this token is forked onto a private clone and
       * the clone is edited, so the co-linked tokens keep the shared gloss rather than being
       * rewritten by an edit aimed at this one. (Editing every occurrence of a shared analysis is
       * deferred; see user-questions.md "separating per-token edits from global analysis edits".)
       * An edit that makes the payload identical to an existing one re-converges onto it, so
       * editing can never leave the duplicate the create path's find-or-create avoids. Otherwise a
       * new `TokenAnalysis` and `TokenAnalysisLink` are appended (an orphaned approved link is
       * repaired first). Non-approved analyses for the token are left untouched.
       *
       * A blank `value` (empty or whitespace) is treated as clearing the gloss rather than writing
       * junk: the active language's entry is removed, and when that leaves the analysis with no
       * content, the record and its link are removed entirely. The clear forks a shared payload
       * just as an edit does, so the co-linked tokens keep the shared gloss rather than being
       * stranded on an emptied payload. A blank write to a token with no approved analysis is a
       * no-op, so a focus/blur cycle on an empty gloss never creates a record.
       */
      reducer(state, action: PayloadAction<WriteGlossPayload>) {
        const { tokenRef, surfaceText, value, id, now } = action.payload;
        const lang = state.analysisLanguage;
        const isBlank = value.trim() === '';

        const resolved = resolveApprovedAnalysis(state, tokenRef);
        if (resolved) {
          const { link, analysis } = resolved;
          // Both the edit and the clear are per-token: when the payload is shared, fork this token
          // onto a private clone first and mutate that, so the co-linked tokens keep the shared gloss
          // instead of being rewritten or stranded by an edit aimed at this one. (Global "edit every
          // occurrence" is deferred; see user-questions.md "separating per-token edits from global
          // analysis edits".) Surface text is refreshed on the fork (not the shared original)
          // so a co-linked sibling's payload is never rewritten.
          const target = isPayloadSharedByOtherLinks(state, link, analysis.id)
            ? forkSharedAnalysis(state, link, analysis, id, now)
            : analysis;
          target.surfaceText = surfaceText;
          target.updatedAt = now;
          link.token.surfaceText = surfaceText;
          link.updatedAt = now;
          if (isBlank) {
            if (target.gloss) {
              delete target.gloss[lang];
              if (Object.keys(target.gloss).length === 0) delete target.gloss;
            }
            // When the clear empties the analysis, detach it; otherwise the cleared payload (e.g. one
            // left holding only morphemes) can be identical to an existing sibling, so re-converge —
            // mirroring writeMorphemeGloss's clear path so a clear never leaves a duplicate the
            // suggestion pool would double-count.
            if (isEmptyTokenAnalysis(target)) detachTokenAnalysisLink(state, target, link);
            else mergeIntoIdenticalPayload(state, target);
            return;
          }
          if (!target.gloss) target.gloss = {};
          target.gloss[lang] = value;
          // An in-place edit can make this payload identical to an existing one (e.g. a homograph
          // instance re-glossed to match its sibling); re-converge so the dedupe the create path
          // guarantees on first write also holds after edits.
          mergeIntoIdenticalPayload(state, target);
          return;
        }

        if (isBlank) return;
        appendApprovedAnalysis(
          state,
          { id, createdAt: now, updatedAt: now, surfaceText, gloss: { [lang]: value } },
          tokenRef,
          now,
        );
      },
    },
    writeMorphemes: {
      /**
       * Generates UUIDs for new morpheme records and a potential new `TokenAnalysis` before the
       * action reaches the reducer. The token's own writing system is stored on each morpheme as
       * the writing system of its form.
       */
      prepare(tokenRef: string, surfaceText: string, forms: string[], writingSystem: string) {
        return {
          payload: {
            tokenRef,
            surfaceText,
            writingSystem,
            analysisId: crypto.randomUUID(),
            morphemes: forms.map((form) => ({ id: crypto.randomUUID(), form })),
            now: nowIso(),
          },
        };
      },
      /**
       * Sets the morpheme breakdown on the approved `TokenAnalysis` for the given token. The edit
       * is per-token: when the payload is shared by other tokens, this token is forked onto a
       * private clone and the clone is re-segmented, so the co-linked tokens keep the shared
       * breakdown. (Editing every occurrence of a shared analysis is deferred; see
       * user-questions.md "separating per-token edits from global analysis edits".) When a morpheme
       * form is unchanged the existing morpheme record is preserved whole — including its id, which
       * `MorphemeLink.morphemeId` cross-references, so alignment links to unchanged morphemes
       * survive edits to the rest of the breakdown. When no approved analysis exists, creates one
       * (an orphaned approved link is repaired first). Also refreshes the stored surface text on
       * both the analysis and the link's token snapshot, so neither goes stale when the baseline
       * text changed since the analysis was first written. Every morpheme — preserved or new — is
       * stamped with the supplied writing system, so records written before the writing system was
       * threaded through (which wrongly stored the analysis language) self-correct on the next
       * save.
       */
      reducer(
        state,
        action: PayloadAction<{
          tokenRef: string;
          surfaceText: string;
          writingSystem: string;
          analysisId: string;
          morphemes: Array<{ id: string; form: string }>;
          now: string;
        }>,
      ) {
        const { tokenRef, surfaceText, writingSystem, analysisId, morphemes, now } = action.payload;

        const resolved = resolveApprovedAnalysis(state, tokenRef);
        if (resolved) {
          const { link, analysis } = resolved;
          // A breakdown edit is per-token: when the payload is shared, fork this token onto a private
          // clone and re-segment the clone, so the co-linked tokens keep the shared breakdown. The
          // prepared `analysisId` (otherwise consumed only by the create path below) names the clone.
          // (Editing every occurrence of a shared analysis is deferred; see user-questions.md
          // "separating per-token edits from global analysis edits".)
          const target = isPayloadSharedByOtherLinks(state, link, analysis.id)
            ? forkSharedAnalysis(state, link, analysis, analysisId, now)
            : analysis;
          target.surfaceText = surfaceText;
          target.updatedAt = now;
          link.token.surfaceText = surfaceText;
          link.updatedAt = now;
          target.morphemes = reconcileMorphemes(target.morphemes, morphemes, writingSystem);
          // An in-place breakdown edit can make this payload identical to an existing one (e.g. a
          // homograph re-segmented to match a sibling); re-converge so the dedupe the create path
          // guarantees on first write also holds after morpheme edits (mirrors writeGloss).
          mergeIntoIdenticalPayload(state, target);
          return;
        }

        appendApprovedAnalysis(
          state,
          {
            id: analysisId,
            createdAt: now,
            updatedAt: now,
            surfaceText,
            morphemes: morphemes.map(({ id, form }) => ({ id, form, writingSystem })),
          },
          tokenRef,
          now,
        );
      },
    },
    deleteMorphemes: {
      /**
       * Generates a UUID for a potential fork clone before the action reaches the reducer — used
       * only when the breakdown is removed from a shared payload — keeping the reducer pure.
       */
      prepare(arg: { tokenRef: string }) {
        return { payload: { tokenRef: arg.tokenRef, id: crypto.randomUUID(), now: nowIso() } };
      },
      /**
       * Removes the morpheme breakdown from the approved `TokenAnalysis` for the given token. When
       * the analysis carries no other content (gloss, POS, features, or lexicon sense reference),
       * the emptied analysis record and its link are removed entirely so empty records do not
       * accumulate in storage. When the payload is shared with other tokens, the breakdown is
       * removed from a private clone of this token so the co-linked tokens keep their morphemes.
       * No-ops when the token has no approved analysis or the analysis has no morphemes (an
       * orphaned approved link is still repaired).
       */
      reducer(state, action: PayloadAction<{ tokenRef: string; id: string; now: string }>) {
        const { tokenRef, id, now } = action.payload;

        const resolved = resolveApprovedAnalysis(state, tokenRef);
        if (!resolved?.analysis.morphemes) return;
        const { link, analysis } = resolved;

        const target = isPayloadSharedByOtherLinks(state, link, analysis.id)
          ? forkSharedAnalysis(state, link, analysis, id, now)
          : analysis;
        delete target.morphemes;
        target.updatedAt = now;
        link.updatedAt = now;
        if (isEmptyTokenAnalysis(target)) {
          detachTokenAnalysisLink(state, target, link);
          return;
        }
        // Removing the breakdown can leave this payload identical to an existing one; re-converge so
        // dedupe holds after morphology-only edits, the same way writeGloss does after a gloss edit.
        mergeIntoIdenticalPayload(state, target);
      },
    },
    /**
     * Writes a gloss string onto a single morpheme within the approved `TokenAnalysis` for the
     * given token. No-ops when the token has no approved analysis or the morpheme id is not found
     * (an orphaned approved link is still repaired).
     *
     * A blank `value` (empty or whitespace) clears the gloss rather than storing junk: the active
     * language's entry is removed, and when that leaves the morpheme with no glosses the `gloss`
     * object is dropped entirely — mirroring the token-level {@link writeGloss}. The morpheme record
     * itself is kept (a breakdown is content in its own right), so unlike `writeGloss` this never
     * removes the enclosing analysis.
     *
     * Both the write and the clear are **per-token**: when the payload is shared by other tokens,
     * this token is forked onto a private clone — which preserves morpheme ids, so `morphemeId`
     * still resolves on the clone — and the clone's morpheme is edited, so the co-linked tokens
     * keep the shared gloss. (Editing every occurrence of a shared analysis is deferred; see
     * user-questions.md "separating per-token edits from global analysis edits".) Both are also
     * identity-changing edits, so each re-converges onto an existing content-identical payload —
     * keeping the create path's dedupe invariant symmetric across both directions, so a clear back
     * to a sibling's state never leaves a duplicate.
     */
    writeMorphemeGloss: {
      /**
       * Generates a UUID for the clone a per-token edit forks from a shared payload, before the
       * action reaches the reducer, keeping the reducer pure. Unused when the payload is not
       * shared. A blank gloss value clears the morpheme's active-language gloss.
       */
      prepare(arg: { tokenRef: string; morphemeId: string; value: string }) {
        return { payload: { ...arg, id: crypto.randomUUID(), now: nowIso() } };
      },
      reducer(
        state,
        action: PayloadAction<{
          tokenRef: string;
          morphemeId: string;
          value: string;
          id: string;
          now: string;
        }>,
      ) {
        const { tokenRef, morphemeId, value, id, now } = action.payload;
        const lang = state.analysisLanguage;

        const resolved = resolveApprovedAnalysis(state, tokenRef);
        if (!resolved) return;
        const { link, analysis } = resolved;
        if (!analysis.morphemes?.some((m) => m.id === morphemeId)) return;

        // Fork before editing so the morpheme gloss change touches only this token; on the clone the
        // morpheme keeps its id, so re-find it there.
        const target = isPayloadSharedByOtherLinks(state, link, analysis.id)
          ? forkSharedAnalysis(state, link, analysis, id, now)
          : analysis;
        const morpheme = target.morphemes?.find((m) => m.id === morphemeId);
        /* v8 ignore next -- forkSharedAnalysis preserves morpheme ids, so this always resolves */
        if (!morpheme) return;

        if (value.trim() === '') {
          if (morpheme.gloss) {
            delete morpheme.gloss[lang];
            if (Object.keys(morpheme.gloss).length === 0) delete morpheme.gloss;
          }
        } else {
          if (!morpheme.gloss) morpheme.gloss = {};
          morpheme.gloss[lang] = value;
        }
        target.updatedAt = now;
        link.updatedAt = now;
        // A morpheme gloss is part of analysis identity (see analysesAreIdentical), so editing or
        // clearing one can make this payload identical to an existing one (e.g. a homograph whose
        // only difference was this morpheme's gloss); re-converge so dedupe holds after edits too.
        mergeIntoIdenticalPayload(state, target);
      },
    },
    // The reducers below are keyed by `analysisId` rather than `tokenRef`, and the key is the whole
    // of the scope distinction: a `tokenRef` edit changes what one token means and forks a shared
    // payload to do it, an `analysisId` edit changes what the record says everywhere. Neither
    // family takes a scope flag, because the address the caller can supply already says which act
    // it is.
    /**
     * Writes a gloss onto a `TokenAnalysis` addressed by its own id, changing what that record says
     * for every token linked to it.
     *
     * A blank `value` clears the active language's gloss, and an edit that empties the record
     * removes it and every link to it. An edit that makes the record identical to a sibling
     * collapses it into that sibling, so the edited row disappears from the catalog.
     */
    writeAnalysisGloss: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: { analysisId: string; value: string }) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(state, action: PayloadAction<{ analysisId: string; value: string; now: string }>) {
        const { analysisId, value, now } = action.payload;
        const lang = state.analysisLanguage;

        const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === analysisId);
        if (!analysis) return;
        state.lastCollapseSurvivorId = undefined;

        if (value.trim() === '') {
          if (analysis.gloss) {
            delete analysis.gloss[lang];
            if (Object.keys(analysis.gloss).length === 0) delete analysis.gloss;
          }
        } else {
          if (!analysis.gloss) analysis.gloss = {};
          analysis.gloss[lang] = value;
        }
        analysis.updatedAt = now;

        // Removed outright rather than left as an empty payload the pool would still carry.
        if (isEmptyTokenAnalysis(analysis)) {
          removeAnalysisAndLinks(state, analysisId);
          return;
        }
        mergeIntoIdenticalPayload(state, analysis);
      },
    },
    /**
     * Re-segments the morpheme breakdown on a `TokenAnalysis` addressed by its own id, for every
     * token linked to it, so one correction fixes a mis-split word across all its occurrences.
     *
     * A form the breakdown already carried keeps its morpheme whole — its id, so
     * `MorphemeLink.morphemeId` stays valid, along with its gloss and lexicon references — while a
     * form with no counterpart is minted fresh. A re-split that drops a form drops what it carried
     * with it, there being no morpheme left to hold it. An empty `forms` removes the breakdown, and
     * removes the record when nothing else remains on it.
     */
    writeAnalysisMorphemes: {
      /**
       * Mints an id per form and reads the clock before the action reaches the reducer, keeping the
       * reducer pure. Only a form the breakdown cannot already account for spends the id offered
       * for it.
       */
      prepare(arg: { analysisId: string; forms: readonly string[]; writingSystem: string }) {
        return {
          payload: {
            analysisId: arg.analysisId,
            writingSystem: arg.writingSystem,
            morphemes: arg.forms.map((form) => ({ id: crypto.randomUUID(), form })),
            now: nowIso(),
          },
        };
      },
      reducer(
        state,
        action: PayloadAction<{
          analysisId: string;
          writingSystem: string;
          morphemes: readonly { id: string; form: string }[];
          now: string;
        }>,
      ) {
        const { analysisId, writingSystem, morphemes, now } = action.payload;

        const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === analysisId);
        if (!analysis) return;
        state.lastCollapseSurvivorId = undefined;

        if (morphemes.length === 0) delete analysis.morphemes;
        else analysis.morphemes = reconcileMorphemes(analysis.morphemes, morphemes, writingSystem);
        analysis.updatedAt = now;

        if (isEmptyTokenAnalysis(analysis)) {
          removeAnalysisAndLinks(state, analysisId);
          return;
        }
        mergeIntoIdenticalPayload(state, analysis);
      },
    },
    /**
     * Writes a gloss onto one morpheme of a `TokenAnalysis` addressed by its own id, for every
     * token linked to it. Clearing the gloss keeps the morpheme, a breakdown being content in its
     * own right, so this never empties the enclosing record.
     */
    writeAnalysisMorphemeGloss: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: { analysisId: string; morphemeId: string; value: string }) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(
        state,
        action: PayloadAction<{
          analysisId: string;
          morphemeId: string;
          value: string;
          now: string;
        }>,
      ) {
        const { analysisId, morphemeId, value, now } = action.payload;
        const lang = state.analysisLanguage;

        const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === analysisId);
        const morpheme = analysis?.morphemes?.find((m) => m.id === morphemeId);
        if (!analysis || !morpheme) return;
        state.lastCollapseSurvivorId = undefined;

        if (value.trim() === '') {
          if (morpheme.gloss) {
            delete morpheme.gloss[lang];
            if (Object.keys(morpheme.gloss).length === 0) delete morpheme.gloss;
          }
        } else {
          if (!morpheme.gloss) morpheme.gloss = {};
          morpheme.gloss[lang] = value;
        }
        analysis.updatedAt = now;
        // A morpheme gloss is part of analysis identity, so this edit can collapse onto a sibling.
        mergeIntoIdenticalPayload(state, analysis);
      },
    },
    /**
     * Removes a `TokenAnalysis` and every link to it. Its tokens fall back to whatever the
     * suggestion pool still offers for their surface form — a surviving homograph, or nothing, in
     * which case they read as blank; {@link selectAnalysisDeletionOutcome} reports which.
     *
     * Irreversible, and the only reducer that drops a record the user never emptied.
     */
    deleteAnalysis(state, action: PayloadAction<{ analysisId: string }>) {
      removeAnalysisAndLinks(state, action.payload.analysisId);
    },
    /**
     * Moves every link on one `TokenAnalysis` to another and drops the source, so the target's
     * usage count becomes the sum of the two and the source's tokens end up analyzed as the target
     * rather than stranded with nothing.
     *
     * Only the links move, and only they are stamped: a moved link's token comes to say something
     * different, while no write is aimed at the target's own content, so its timestamps keep
     * reporting the age of the record. No-ops when either id resolves to no payload, or when both
     * name the same record.
     */
    mergeAnalysisInto: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: { sourceAnalysisId: string; targetAnalysisId: string }) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(
        state,
        action: PayloadAction<{ sourceAnalysisId: string; targetAnalysisId: string; now: string }>,
      ) {
        const { sourceAnalysisId, targetAnalysisId, now } = action.payload;
        if (sourceAnalysisId === targetAnalysisId) return;
        const has = (id: string) => state.analysis.tokenAnalyses.some((ta) => ta.id === id);
        if (!has(sourceAnalysisId) || !has(targetAnalysisId)) return;

        state.analysis.tokenAnalysisLinks.forEach((l) => {
          if (l.analysisId === sourceAnalysisId) {
            l.analysisId = targetAnalysisId;
            l.updatedAt = now;
          }
        });
        state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter(
          (ta) => ta.id !== sourceAnalysisId,
        );
      },
    },
    /**
     * Approves a shared `TokenAnalysis` payload for a token — the persisted half of accepting a
     * suggestion or promoting a candidate (see {@link selectResolvedTokenAnalysis}). No new payload
     * is created (unlike {@link writeGloss}'s find-or-create); the chosen payload's approval
     * frequency rises by one and the token's derived suggestion disappears now that it carries its
     * own approved decision.
     *
     * When the token already has an approved analysis the existing link is **repointed** to the
     * chosen payload rather than a second link being appended, so the "at most one approved link
     * per token" invariant is preserved while still letting an already-approved homograph be
     * promoted to a different pool analysis (the affordance {@link selectResolvedTokenAnalysis}
     * offers on approved tokens). The repoint lands on the same link the read selectors surface,
     * and an orphaned approved link is healed first rather than blocking the promotion. When the
     * existing approval already points at the chosen payload the repoint is a no-op. Detaching the
     * old payload after the repoint reclaims it when this was its last approved reference, so a
     * promotion never strands an empty payload.
     *
     * An `analysisId` that resolves to no stored payload is rejected (no-op) rather than approved
     * as a fresh orphan. The link's snapshot records _this_ token's `surfaceText` (not the shared
     * payload's), matching the create path so per-token drift detection stays accurate.
     *
     * Only the link is stamped, and a promotion refreshes just its `updatedAt`: the link dates this
     * token's first annotation, which a change of payload does not reset. The approved payload is
     * adopted as it stands, so its own timestamps keep reporting the age of the record rather than
     * the moment this token accepted it.
     */
    approveAnalysisForToken: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: { tokenRef: string; surfaceText: string; analysisId: string }) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(
        state,
        action: PayloadAction<{
          tokenRef: string;
          surfaceText: string;
          analysisId: string;
          now: string;
        }>,
      ) {
        const { tokenRef, surfaceText, analysisId, now } = action.payload;
        // Approve only a payload that actually exists: an unknown id would point an approved link
        // at nothing, which the read selectors then have to repair as an orphan. Callers pass an id
        // drawn from the live suggestion pool, but the reducer does not rely on that alone.
        if (!state.analysis.tokenAnalyses.some((ta) => ta.id === analysisId)) return;
        const resolved = resolveApprovedAnalysis(state, tokenRef);
        if (resolved) {
          // Promote: repoint the one approved link to the chosen payload (a no-op when it already
          // points there) instead of appending a second, then reclaim the old payload if this was
          // its last approved reference.
          const { link, analysis } = resolved;
          if (link.analysisId === analysisId) return;
          link.analysisId = analysisId;
          link.token.surfaceText = surfaceText;
          link.updatedAt = now;
          if (!isPayloadSharedByOtherLinks(state, link, analysis.id)) {
            state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter(
              (ta) => ta !== analysis,
            );
          }
          return;
        }
        state.analysis.tokenAnalysisLinks.push({
          analysisId,
          createdAt: now,
          updatedAt: now,
          status: 'approved',
          token: { tokenRef, surfaceText },
        });
      },
    },
    createPhrase: {
      /**
       * Generates a UUID for the new `PhraseAnalysis` before the action reaches the reducer,
       * keeping the reducer pure.
       */
      prepare(tokens: TokenSnapshot[]) {
        return { payload: { id: crypto.randomUUID(), tokens, now: nowIso() } };
      },
      /** Appends a new approved `PhraseAnalysis` and its `PhraseAnalysisLink` to the analysis. */
      reducer(state, action: PayloadAction<CreatePhrasePayload>) {
        const { id, tokens, now } = action.payload;
        const newAnalysis: PhraseAnalysis = {
          id,
          createdAt: now,
          updatedAt: now,
          surfaceText: phraseSurfaceText(tokens),
        };
        const newLink: PhraseAnalysisLink = {
          analysisId: id,
          createdAt: now,
          updatedAt: now,
          status: 'approved',
          tokens,
        };
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
     */
    updatePhrase: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: UpdatePhrasePayload) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(state, action: PayloadAction<UpdatePhrasePayload & { now: string }>) {
        const { phraseId, tokens, now } = action.payload;
        if (tokens.length === 0) {
          removePhraseById(state, phraseId);
          return;
        }
        const link = state.analysis.phraseAnalysisLinks.find((l) => l.analysisId === phraseId);
        if (link) {
          link.tokens = tokens;
          link.updatedAt = now;
        }
        const analysis = state.analysis.phraseAnalyses.find((pa) => pa.id === phraseId);
        if (analysis) {
          analysis.surfaceText = phraseSurfaceText(tokens);
          analysis.updatedAt = now;
        }
      },
    },
    /** Removes the `PhraseAnalysis` record and its `PhraseAnalysisLink` for the given phrase id. */
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
     */
    mergePhrases: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: MergePhrasesPayload) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(state, action: PayloadAction<MergePhrasesPayload & { now: string }>) {
        const { targetPhraseId, tokens, absorbedPhraseId, now } = action.payload;
        if (absorbedPhraseId !== undefined && absorbedPhraseId === targetPhraseId) return;

        const link = state.analysis.phraseAnalysisLinks.find(
          (l) => l.analysisId === targetPhraseId,
        );
        if (link) {
          link.tokens = tokens;
          link.updatedAt = now;
        }
        const analysis = state.analysis.phraseAnalyses.find((pa) => pa.id === targetPhraseId);
        if (analysis) {
          analysis.surfaceText = phraseSurfaceText(tokens);
          analysis.updatedAt = now;
        }
        if (absorbedPhraseId !== undefined) removePhraseById(state, absorbedPhraseId);
      },
    },
    /**
     * Writes a gloss value into the `PhraseAnalysis` record for the given phrase id. No-ops when no
     * matching `PhraseAnalysis` is found.
     */
    writePhraseGloss: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: WritePhraseGlossPayload) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(state, action: PayloadAction<WritePhraseGlossPayload & { now: string }>) {
        const { phraseId, value, now } = action.payload;
        const pa = state.analysis.phraseAnalyses.find((p) => p.id === phraseId);
        if (!pa) return;
        const lang = state.analysisLanguage;
        if (!pa.gloss) pa.gloss = {};
        pa.gloss[lang] = value;
        pa.updatedAt = now;
        touchPhraseLink(state, phraseId, now);
      },
    },
    writeSegmentFreeTranslation: {
      /**
       * Generates a UUID for a potential new `SegmentAnalysis` record before the action reaches the
       * reducer, keeping the reducer pure.
       */
      prepare(segmentId: string, surfaceText: string, value: string) {
        return {
          payload: { segmentId, surfaceText, value, id: crypto.randomUUID(), now: nowIso() },
        };
      },
      /**
       * Creates or updates the approved `SegmentAnalysis` carrying a segment's free translation. If
       * an approved link already exists for `segmentId`, its analysis is updated in place and the
       * stored surface text is refreshed, so it never goes stale when the baseline text changed
       * since the analysis was first written. Otherwise a new `SegmentAnalysis` and approved
       * `SegmentAnalysisLink` are appended (an orphaned approved link is repaired first).
       *
       * A blank `value` (empty or whitespace) clears the free translation rather than writing junk:
       * the active language's entry is removed, and when that leaves the analysis with no content,
       * the record and its link are removed entirely. A blank write to a segment with no approved
       * analysis is a no-op, so a focus/blur cycle on an empty input never creates a record.
       */
      reducer(state, action: PayloadAction<WriteSegmentFreeTranslationPayload>) {
        const { segmentId, surfaceText, value, id, now } = action.payload;
        const lang = state.analysisLanguage;
        const isBlank = value.trim() === '';

        const resolved = resolveApprovedSegmentAnalysis(state, segmentId);
        if (resolved) {
          const { link, analysis } = resolved;
          analysis.surfaceText = surfaceText;
          analysis.updatedAt = now;
          link.updatedAt = now;
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
          createdAt: now,
          updatedAt: now,
          surfaceText,
          freeTranslation: { [lang]: value },
        };
        const newLink: SegmentAnalysisLink = {
          analysisId: id,
          createdAt: now,
          updatedAt: now,
          status: 'approved',
          segmentId,
        };
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
  writeAnalysisGloss,
  writeAnalysisMorphemes,
  writeAnalysisMorphemeGloss,
  deleteAnalysis,
  mergeAnalysisInto,
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
 * Shared empty result for a row with no merge peers, so a subscriber reading it under `Object.is`
 * sees a stable reference rather than a fresh array each call.
 */
const NO_MERGE_PEERS: readonly TokenAnalysis[] = [];

/** Projects `tokenAnalyses` out of `AnalysisState` for use as a `createSelector` input. */
const selectTokenAnalyses = (state: AnalysisState) => state.analysis.tokenAnalyses;

/** Projects `tokenAnalysisLinks` out of `AnalysisState` for use as a `createSelector` input. */
const selectTokenAnalysisLinks = (state: AnalysisState) => state.analysis.tokenAnalysisLinks;

/** Projects `analysisLanguage` out of `AnalysisState` for use as a `createSelector` input. */
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

/** Returns the `TextAnalysis` from the analysis slice state. */
export const selectAnalysis = (state: AnalysisState) => state.analysis;

/**
 * Returns the approved gloss string for `tokenRef` in the active analysis language, or `''` when no
 * approved analysis exists or the analysis has no gloss for the active language.
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
 * approved link points at it — the blast radius of a global edit to that payload. At most one
 * approved analysis per token is counted, so multiple approved links on the same token are never
 * double-counted. Recomputes only when the approved-analysis index changes reference.
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
 * Memoized selector that builds the suggestion-engine pool index from the approved analyses: each
 * distinct approved payload filed under its normalized surface form with its approval frequency.
 * This is the read-only corpus the engine derives suggestions from — only approved analyses enter,
 * since the frequencies it is built from count approved links alone. Recomputes only when
 * `tokenAnalyses` or `tokenAnalysisLinks` change reference.
 */
export const selectPoolIndex = createSelector(
  selectAnalysisById,
  selectApprovedTokenCountByAnalysisId,
  buildPoolIndex,
);

/**
 * Which payloads name the same word, keyed by normalized surface form and ordered most-approved
 * first. Every payload is filed, an unused one ranking last rather than being left out.
 *
 * Distinct from {@link selectPoolIndex}, which admits only approved analyses because it answers what
 * to suggest for an unanalyzed token, and an unapproved payload is no answer. Which payloads name
 * one word is a separate question that an unused payload does answer: a Paratext 9 import can land
 * homographs no token has approved, and those are the rows a reader opens the catalog to
 * reconcile.
 */
const selectHomographIndex = createSelector(
  selectAnalysisById,
  selectApprovedTokenCountByAnalysisId,
  (analysisById, approvedCounts) =>
    buildPoolIndex(
      analysisById,
      new Map([...analysisById.keys()].map((id) => [id, approvedCounts.get(id) ?? 0])),
    ),
);

/**
 * Memoized selector building the Analysis Catalog's rows — one per distinct token analysis, with
 * its usage counts and locations — against the book named as the second argument. Only a change to
 * the analysis it reads or to the named book rebuilds the rows, so searching and sorting the result
 * never does.
 *
 * Rows are cached per book code asked for rather than in a single slot, so two components reading
 * different books do not thrash. Nothing evicts an entry, and the canon bounds how many there can
 * be.
 */
export const selectCatalogRows = createSelector(
  selectTokenAnalyses,
  selectTokenAnalysisLinks,
  selectAnalysisLanguage,
  (_state: AnalysisState, currentBook: string) => currentBook,
  (tokenAnalyses, tokenAnalysisLinks, analysisLanguage, currentBook) =>
    buildCatalogRows({ tokenAnalyses, tokenAnalysisLinks }, { analysisLanguage, currentBook }),
);

/**
 * What deleting a `TokenAnalysis` would do to the tokens that approve it, so an irreversible delete
 * can be confirmed with its concrete consequence rather than a generic "are you sure".
 */
export interface AnalysisDeletionOutcome {
  /**
   * `'blank'` when the affected tokens are left reading as unanalyzed, `'fallback'` when a
   * surviving homograph takes over and they read as that instead.
   */
  kind: 'blank' | 'fallback';
  /** How many tokens the deletion affects. */
  usageCount: number;
  /**
   * What the affected tokens will read once the deletion commits. Absent when the surviving peer
   * carries no gloss in the active analysis language, leaving no word to quote at the user.
   */
  fallbackGloss?: string;
}

/**
 * Reports what {@link deleteAnalysis} would do to the given row, for the confirmation to name.
 * Returns `undefined` when the id resolves to no payload, so a stale row cannot open a confirmation
 * for a record that is already gone.
 */
export function selectAnalysisDeletionOutcome(
  state: AnalysisState,
  analysisId: string,
): AnalysisDeletionOutcome | undefined {
  const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === analysisId);
  if (!analysis) return undefined;

  const approvedTokenCounts = selectApprovedTokenCountByAnalysisId(state);

  // Counted off the same index the catalog row counts by, so the confirmation and the row it opened
  // from cannot name two different numbers: both count the tokens an approval sits on rather than
  // the approvals themselves.
  const usageCount = approvedTokenCounts.get(analysisId) ?? 0;

  // The fallback is what the affected tokens come to read, so a record nothing approves has none
  // however many homographs the pool still offers for its form.
  if (usageCount === 0) return { kind: 'blank', usageCount };

  // Ask the engine, so the confirmation names the peer that actually wins. The payload is dropped
  // from the pool outright rather than discounted by one approval: a deletion removes all of its
  // approvals at once, and a discounted multi-token payload would compete to replace itself.
  const survivingPool = buildPoolIndex(
    selectAnalysisById(state),
    new Map([...approvedTokenCounts].filter(([id]) => id !== analysisId)),
  );
  const fallback = deriveTokenSuggestion(survivingPool, analysis.surfaceText);
  if (!fallback) return { kind: 'blank', usageCount };

  const gloss = fallback.suggested.gloss?.[state.analysisLanguage];
  return { kind: 'fallback', usageCount, ...(gloss ? { fallbackGloss: gloss } : {}) };
}

/**
 * The other analyses a row may be merged into: those sharing its normalized surface form, so merge
 * is offered only among genuine homographs and a row with no peers offers none. Ordered best-first,
 * putting the most-used peer at the head.
 *
 * An unused payload is both offered as a target and given peers of its own, matching what
 * {@link mergeAnalysisInto} accepts: it moves links whatever their status, so approval is no
 * condition of merging. Suggestion is where approval matters, and that is a separate question.
 */
export function selectAnalysisMergePeers(
  state: AnalysisState,
  analysisId: string,
): readonly TokenAnalysis[] {
  const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === analysisId);
  if (!analysis) return NO_MERGE_PEERS;
  /* v8 ignore next -- unreachable: every payload is filed, so a resolved row is in its own bucket */
  const bucket = selectHomographIndex(state).get(normalizeSurfaceForm(analysis.surfaceText)) ?? [];
  const peers = bucket.filter((e) => e.analysis.id !== analysisId).map((e) => e.analysis);
  return peers.length > 0 ? peers : NO_MERGE_PEERS;
}

/**
 * Returns the merged analysis the renderer shows for a token: its approved decision when one
 * exists, otherwise the engine's suggestion derived live from the approved-analysis pool, or
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
    const poolSuggestion = deriveTokenSuggestion(selectPoolIndex(state), surfaceText);
    return { status: 'approved', analysis, poolSuggestion };
  }
  const suggestion = deriveTokenSuggestion(selectPoolIndex(state), surfaceText);
  return suggestion ? { status: 'suggested', ...suggestion } : undefined;
}

/**
 * Returns the suggestion a token would resolve to if its own approval were removed — the preview
 * the gloss UI shows the instant an approved gloss is cleared, before the empty value commits on
 * blur. Re-derives this surface form's bucket with the token's approved payload discounted by one
 * approval (dropped when this was its last), so the previewed pick matches what the committed
 * deletion will surface rather than the approved payload's mere alternatives. Returns `undefined`
 * when the token has no approval (callers only consult this for an approved token) or when nothing
 * in the pool still matches once that approval is discounted.
 */
export function selectSuggestionAfterClearing(
  state: AnalysisState,
  tokenRef: string,
  surfaceText: string,
): ResolvedTokenAnalysis | undefined {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId === undefined) return undefined;
  const suggestion = deriveTokenSuggestion(selectPoolIndex(state), surfaceText, approvedId);
  return suggestion ? { status: 'suggested', ...suggestion } : undefined;
}

/**
 * Reports whether removing `tokenRef`'s morpheme breakdown would destroy gloss data no other token
 * still holds — the condition under which the morpheme editor confirms before resetting. True only
 * when at least one morpheme carries a gloss AND this token is the sole approved link to its
 * payload. A payload shared with other tokens is forked rather than emptied by `deleteMorphemes`,
 * so the co-linked tokens keep their morphemes and nothing is lost project-wide; a breakdown with
 * no glosses is bare segmentation that is cheap to retype. Sharing is judged by the same
 * approved-link count the write path tests before it forks, so the two can never disagree about
 * what "shared" means.
 */
export function selectMorphemeResetLosesGlosses(state: AnalysisState, tokenRef: string): boolean {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId === undefined) return false;
  const analysis = selectAnalysisById(state).get(approvedId);
  const hasGlossedMorpheme = analysis?.morphemes?.some((m) => m.gloss !== undefined) ?? false;
  if (!hasGlossedMorpheme) return false;
  // A payload referenced by more than one approved link is forked rather than emptied, so only a
  // sole link loses anything.
  /* v8 ignore next -- approvedId comes from the map the counts are built from, so it is always present */
  const approvedTokenCount = selectApprovedTokenCountByAnalysisId(state).get(approvedId) ?? 0;
  return approvedTokenCount <= 1;
}

/**
 * Reports whether `tokenRef` is the only approved holder of its payload, so a breakdown edit here
 * destroys what it drops instead of leaving it with co-linked tokens. False when the token has no
 * approval at all.
 *
 * Sharing is judged by the same approved-link count a breakdown write forks on, so the two can
 * never disagree about which edits are recoverable.
 */
export function selectMorphemePayloadIsSolelyOwned(
  state: AnalysisState,
  tokenRef: string,
): boolean {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId === undefined) return false;
  /* v8 ignore next -- approvedId comes from the map the counts are built from, so it is always present */
  const approvedTokenCount = selectApprovedTokenCountByAnalysisId(state).get(approvedId) ?? 0;
  return approvedTokenCount <= 1;
}

const EMPTY_MORPHEMES: readonly MorphemeAnalysis[] = [];

/**
 * Returns the morpheme array from the approved `TokenAnalysis` for `tokenRef`, or a shared
 * reference-stable empty array when no approved analysis exists or it has no morphemes.
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

/** Projects `phraseAnalysisLinks` out of `AnalysisState` for use as a `createSelector` input. */
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
 */
export function selectPhraseGloss(state: AnalysisState, phraseId: string): string {
  const pa = state.analysis.phraseAnalyses.find((p) => p.id === phraseId);
  return pa?.gloss?.[state.analysisLanguage] ?? '';
}

/**
 * Returns the approved free-translation string for the given segment in the active analysis
 * language, or `''` when no approved analysis exists or it has no free translation for the active
 * language. An approved link referencing a missing analysis is treated as absent (read-only here;
 * the orphan is repaired on the next write).
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
