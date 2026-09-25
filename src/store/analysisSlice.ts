import { createSelector, createSlice, current, type PayloadAction } from '@reduxjs/toolkit';
import type {
  Confidence,
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
import {
  analysesAreIdentical,
  morphemeCarriesAnnotation,
  phraseAnalysesAreIdentical,
  reconcileMorphemes,
} from '../utils/analysis-identity';
import { buildCatalogRows } from '../utils/analysis-query';
import { isEmptyMultiString } from '../utils/multi-string';
import {
  buildPoolIndex,
  deriveTokenSuggestion,
  withoutAnalyses,
  withPendingAnalyses,
  type ResolvedTokenAnalysis,
  type TokenSuggestion,
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
  /** Pre-generated UUID for the new occurrence's `PhraseAnalysisLink`. */
  id: string;
  /**
   * Pre-generated UUID for a new `PhraseAnalysis`, spent only when no content-identical payload
   * exists to share.
   */
  analysisId: string;
  /** Ordered `TokenSnapshot`s forming the phrase, in document order. */
  tokens: TokenSnapshot[];
  /** ISO 8601 stamp for the new records, produced by the `prepare` callback. */
  now: string;
}

/**
 * Fields the `prepare` callback adds to a per-occurrence phrase edit, which may have to move the
 * occurrence off a payload it shares before changing it.
 */
interface PhraseEditStamp {
  /** Pre-generated UUID for the private payload a shared one is forked onto. */
  forkId: string;
  /** ISO 8601 stamp for the records the edit touches. */
  now: string;
}

/** Payload for the {@link updatePhrase} action. */
interface UpdatePhrasePayload {
  /** `PhraseAnalysisLink.id` of the occurrence to update. */
  phraseId: string;
  /** Replacement ordered `TokenSnapshot`s, in document order. */
  tokens: TokenSnapshot[];
}

/** Payload for the {@link deletePhrase} action. */
interface DeletePhrasePayload {
  /** `PhraseAnalysisLink.id` of the occurrence to remove. */
  phraseId: string;
}

/** Payload for the {@link mergePhrases} action. */
interface MergePhrasesPayload {
  /** `PhraseAnalysisLink.id` of the occurrence to keep and grow; receives the merged token list. */
  targetPhraseId: string;
  /** The combined, document-ordered `TokenSnapshot`s for the target phrase. */
  tokens: TokenSnapshot[];
  /**
   * `PhraseAnalysisLink.id` of a neighboring occurrence whose tokens were folded into `tokens` and
   * that must be deleted in the same step. `undefined` when the absorbed neighbor was a free
   * (unphrased) token, so there is no phrase record to remove.
   */
  absorbedPhraseId?: string;
}

/** Payload for the {@link writePhraseGloss} action. */
interface WritePhraseGlossPayload {
  /** `PhraseAnalysisLink.id` of the occurrence to gloss. */
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

function findPhraseLink(state: AnalysisState, phraseId: string): PhraseAnalysisLink | undefined {
  return state.analysis.phraseAnalysisLinks.find((l) => l.id === phraseId);
}

function findPhraseAnalysis(
  state: AnalysisState,
  link: PhraseAnalysisLink,
): PhraseAnalysis | undefined {
  return state.analysis.phraseAnalyses.find((pa) => pa.id === link.analysisId);
}

/**
 * Removes a phrase occurrence, dropping its payload only once no other occurrence still references
 * it, so removing one phrase never orphans another's analysis.
 */
function detachPhraseLink(state: AnalysisState, link: PhraseAnalysisLink): void {
  const { analysisId } = link;
  state.analysis.phraseAnalysisLinks = state.analysis.phraseAnalysisLinks.filter(
    (l) => l.id !== link.id,
  );
  if (state.analysis.phraseAnalysisLinks.some((l) => l.analysisId === analysisId)) return;
  state.analysis.phraseAnalyses = state.analysis.phraseAnalyses.filter(
    (pa) => pa.id !== analysisId,
  );
}

/**
 * Reports whether an edit reaching `link`'s payload would also change what another occurrence, at
 * any status, reads.
 */
function isPhrasePayloadShared(state: AnalysisState, link: PhraseAnalysisLink): boolean {
  return state.analysis.phraseAnalysisLinks.some(
    (l) => l.id !== link.id && l.analysisId === link.analysisId,
  );
}

/**
 * Moves `link` onto a private copy of its shared payload, so an edit aimed at one occurrence leaves
 * the others reading what they did. The copy is dated by the write, being a record of its own.
 *
 * @returns The copy, safe to edit in the same reducer.
 */
function forkSharedPhrase(
  state: AnalysisState,
  link: PhraseAnalysisLink,
  analysis: PhraseAnalysis,
  cloneId: string,
  now: string,
): PhraseAnalysis {
  const source = current(analysis);
  state.analysis.phraseAnalyses.push({
    ...source,
    id: cloneId,
    createdAt: now,
    updatedAt: now,
    ...(source.gloss ? { gloss: { ...source.gloss } } : {}),
  });
  link.analysisId = cloneId;
  return state.analysis.phraseAnalyses[state.analysis.phraseAnalyses.length - 1];
}

/**
 * The payload an edit to `link`'s occurrence should write to: its own, or a private copy when other
 * occurrences share it.
 *
 * @returns `undefined` when the link names no payload.
 */
function editablePhraseAnalysis(
  state: AnalysisState,
  link: PhraseAnalysisLink,
  forkId: string,
  now: string,
): PhraseAnalysis | undefined {
  const analysis = findPhraseAnalysis(state, link);
  if (!analysis) return undefined;
  return isPhrasePayloadShared(state, link)
    ? forkSharedPhrase(state, link, analysis, forkId, now)
    : analysis;
}

/**
 * Re-converges an edited phrase payload onto an existing content-identical one, so an edit can
 * never leave the duplicate that creating a phrase avoids. Every occurrence of the edited payload
 * moves to the survivor, which keeps its own timestamps, as do the moved links. A no-op when the
 * edit left the payload unique.
 */
function mergeIntoIdenticalPhrase(state: AnalysisState, analysis: PhraseAnalysis): void {
  const other = state.analysis.phraseAnalyses.find(
    (pa) => pa.id !== analysis.id && phraseAnalysesAreIdentical(pa, analysis),
  );
  if (!other) return;
  state.analysis.phraseAnalysisLinks.forEach((l) => {
    if (l.analysisId === analysis.id) l.analysisId = other.id;
  });
  state.analysis.phraseAnalyses = state.analysis.phraseAnalyses.filter(
    (pa) => pa.id !== analysis.id,
  );
}

/**
 * Gives a phrase occurrence a new token run, re-deriving the surface form of the payload it reads
 * so that never goes stale. Other occurrences sharing the payload keep theirs. An occurrence whose
 * link names no payload still takes the new run.
 */
function reshapePhrase(
  state: AnalysisState,
  link: PhraseAnalysisLink,
  tokens: TokenSnapshot[],
  { forkId, now }: PhraseEditStamp,
): void {
  link.tokens = tokens;
  link.updatedAt = now;
  const target = editablePhraseAnalysis(state, link, forkId, now);
  if (!target) return;
  target.surfaceText = phraseSurfaceText(tokens);
  target.updatedAt = now;
  mergeIntoIdenticalPhrase(state, target);
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
 * Approves the non-approved link `tokenRef` already holds to `analysisId`, so a token taking on a
 * record it was offered keeps a single link to it. The link keeps its creation date and
 * `confidence` as recorded.
 *
 * @returns The approved link, or `undefined` when the token holds no such link.
 */
function approveHeldLink(
  state: AnalysisState,
  tokenRef: string,
  analysisId: string,
  surfaceText: string,
  now: string,
): TokenAnalysisLink | undefined {
  const held = state.analysis.tokenAnalysisLinks.findLast(
    (l) => l.status !== 'approved' && l.token.tokenRef === tokenRef && l.analysisId === analysisId,
  );
  if (!held) return undefined;
  held.status = 'approved';
  held.token.surfaceText = surfaceText;
  held.updatedAt = now;
  return held;
}

/**
 * Links a token to an approved `TokenAnalysis`, doing find-or-create so identical analyses are
 * shared rather than duplicated: if an existing payload is content-identical to `analysis`
 * ({@link analysesAreIdentical}), the token takes that payload and `analysis` is discarded;
 * otherwise `analysis` is appended as a new payload. Either way the token ends up with one approved
 * link to it, a non-approved link it already holds to the adopted payload being approved rather
 * than joined by a second. The link's token snapshot records _this_ token's surface text (from
 * `analysis.surfaceText`), not the shared payload's, so per-token drift detection stays accurate
 * even when a sentence-initial form links to a payload first created from a mid-sentence form.
 *
 * Adopting an existing payload leaves that payload's timestamps alone — no write lands on it —
 * while the link is stamped with the write time, so the shared analysis keeps the age of the record
 * and this token records when it took the analysis on. A held link keeps its creation date, the
 * token having first annotated then.
 */
function appendApprovedAnalysis(
  state: AnalysisState,
  analysis: TokenAnalysis,
  tokenRef: string,
  now: string,
): void {
  const existing = state.analysis.tokenAnalyses.find((ta) => analysesAreIdentical(ta, analysis));
  if (!existing) state.analysis.tokenAnalyses.push(analysis);
  else if (approveHeldLink(state, tokenRef, existing.id, analysis.surfaceText, now)) return;
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
 * Reports whether `analysisId`'s payload is linked, at any status, by a token other than `link`'s —
 * i.e. whether an edit or clear reaching it through `link`'s token would also change what a
 * different token reads or records.
 */
function isPayloadSharedByOtherLinks(
  state: AnalysisState,
  link: TokenAnalysisLink,
  analysisId: string,
): boolean {
  return state.analysis.tokenAnalysisLinks.some(
    (l) => l.analysisId === analysisId && l.token.tokenRef !== link.token.tokenRef,
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
 * Leaves a token holding one link to `analysisId` where it held several, keeping the link the read
 * selectors surface and approving it if any it supersedes was, so the "at most one approved link
 * per token" invariant holds across the collapse.
 *
 * The survivor keeps the token's first annotation date and, where it is raised to approved, the
 * superseded approval's `confidence` — so a collapse retires a link without retiring what it
 * recorded.
 */
function coalesceLinksPerToken(state: AnalysisState, analysisId: string, now: string): void {
  const survivorByToken = new Map<string, TokenAnalysisLink>();
  state.analysis.tokenAnalysisLinks.forEach((l) => {
    if (l.analysisId !== analysisId) return;
    const superseded = survivorByToken.get(l.token.tokenRef);
    if (superseded) {
      if (superseded.createdAt < l.createdAt) l.createdAt = superseded.createdAt;
      if (superseded.status === 'approved' && l.status !== 'approved') {
        l.status = 'approved';
        l.updatedAt = now;
        if (superseded.confidence === undefined) delete l.confidence;
        else l.confidence = superseded.confidence;
      }
    }
    survivorByToken.set(l.token.tokenRef, l);
  });
  const survivors = new Set(survivorByToken.values());
  state.analysis.tokenAnalysisLinks = state.analysis.tokenAnalysisLinks.filter(
    (l) => l.analysisId !== analysisId || survivors.has(l),
  );
}

/**
 * Re-converges a just-edited payload onto an existing content-identical one, so an in-place edit
 * can never leave two identical payloads the way the create path's find-or-create prevents on first
 * write. When another `TokenAnalysis` is now {@link analysesAreIdentical} to `analysis`, every link
 * pointing at `analysis` is repointed to that payload and `analysis` is dropped — collapsing a
 * homograph instance that was edited to match a sibling back onto one shared payload (frequency
 * re-merged, no duplicate suggestion). A no-op when the edit left the payload unique.
 *
 * A token that linked both payloads is left holding one link, the two having come to name the same
 * record, dated by the earlier of the two.
 *
 * The surviving payload keeps its own timestamps and the repointed links keep theirs: no write was
 * aimed at the survivor or at any token's annotation, only at which record holds the content.
 *
 * `settleProvenance` moves that boundary for a write that chose the survivor's confidence, which
 * identity excludes and the collapse would otherwise leave saying whatever it already said. An edit
 * that converged incidentally chose nothing and leaves it alone.
 *
 * Leaves the survivor in {@link AnalysisState.lastCollapseSurvivorId}.
 */
function mergeIntoIdenticalPayload(
  state: AnalysisState,
  analysis: TokenAnalysis,
  now: string,
  settleProvenance = false,
): void {
  const other = state.analysis.tokenAnalyses.find(
    (ta) => ta !== analysis && analysesAreIdentical(ta, analysis),
  );
  if (!other) return;
  if (settleProvenance) {
    if (analysis.confidence === undefined) delete other.confidence;
    else other.confidence = analysis.confidence;
    other.updatedAt = now;
  }
  state.analysis.tokenAnalysisLinks.forEach((l) => {
    if (l.analysisId === analysis.id) l.analysisId = other.id;
  });
  coalesceLinksPerToken(state, other.id, now);
  state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter((ta) => ta !== analysis);
  state.lastCollapseSurvivorId = other.id;
}

/**
 * What a merge settles the surviving analysis says. Every field is written as given and absence
 * clears what the record held, a missing value being one the merge decided against rather than one
 * it had nothing to say about.
 */
export interface MergedContent {
  /** Gloss in the store's analysis language, blank clearing it. */
  gloss: string;
  /**
   * Analysis `gloss` was taken from, whose sense the survivor keeps resolving it through. Absent
   * when the reader typed the gloss, which leaves the survivor no sense.
   */
  glossFromAnalysisId?: string;
  morphemes: readonly MorphemeAnalysis[];
  pos?: string;
  features?: Readonly<Record<string, string>>;
  confidence?: Confidence;
}

/**
 * Carries the glosses outside `lang` off the donors onto the survivor, which keeps its own wherever
 * it has them, and settles the sense the survivor's gloss resolves through.
 *
 * @param survivor Mutated in place.
 * @param donors The records being dropped, most-preferred first.
 * @param lang BCP 47 tag the merge was conducted in, the one gloss this leaves alone.
 * @param glossFrom The analysis the settled gloss came from, whose sense the survivor takes;
 *   `undefined` for a gloss answering to no record, which leaves the survivor without one.
 */
function carryOverUnsettledContent(
  survivor: TokenAnalysis,
  donors: readonly TokenAnalysis[],
  lang: string,
  glossFrom: TokenAnalysis | undefined,
): void {
  survivor.glossSenseRef = glossFrom?.glossSenseRef;

  donors.forEach((donor) => {
    Object.entries(donor.gloss ?? {}).forEach(([tag, gloss]) => {
      if (tag === lang) return;
      if (!survivor.gloss) survivor.gloss = {};
      if (survivor.gloss[tag] === undefined) survivor.gloss[tag] = gloss;
    });
  });
}

/**
 * Copies a merged morpheme, leaving it unglossed in `lang` where the gloss holds nothing that
 * renders — analysis identity must not see a difference the reader cannot.
 */
function copyMergedMorpheme(morpheme: MorphemeAnalysis, lang: string): MorphemeAnalysis {
  const copy = { ...morpheme };
  const gloss = copy.gloss?.[lang];
  if (gloss !== undefined && gloss.trim() === '') {
    copy.gloss = { ...copy.gloss };
    delete copy.gloss[lang];
    if (Object.keys(copy.gloss).length === 0) delete copy.gloss;
  }
  return copy;
}

/** Writes merged content onto an analysis, clearing each field the merge settled on nothing for. */
function applyMergedContent(analysis: TokenAnalysis, content: MergedContent, lang: string): void {
  if (content.gloss.trim() === '') {
    if (analysis.gloss) {
      delete analysis.gloss[lang];
      if (Object.keys(analysis.gloss).length === 0) delete analysis.gloss;
    }
  } else {
    if (!analysis.gloss) analysis.gloss = {};
    analysis.gloss[lang] = content.gloss;
  }

  if (content.morphemes.length === 0) delete analysis.morphemes;
  else analysis.morphemes = content.morphemes.map((m) => copyMergedMorpheme(m, lang));

  if (content.pos === undefined) delete analysis.pos;
  else analysis.pos = content.pos;

  if (content.features === undefined) delete analysis.features;
  else analysis.features = { ...content.features };

  if (content.confidence === undefined) delete analysis.confidence;
  else analysis.confidence = content.confidence;
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
 * Empties one language's gloss, dropping the gloss and the analysis-wide `glossSenseRef` once no
 * language is left holding usable text — a sibling left holding only whitespace counts for neither,
 * so the sense is never stranded on a gloss nothing renders.
 */
function clearAnalysisGloss(analysis: TokenAnalysis, lang: string): void {
  if (analysis.gloss) {
    delete analysis.gloss[lang];
    if (isEmptyMultiString(analysis.gloss)) delete analysis.gloss;
  }
  if (!analysis.gloss) delete analysis.glossSenseRef;
}

/**
 * The annotated forms a re-split to `forms` would strand: those whose morpheme carries a gloss or a
 * lexicon reference and which the new breakdown leaves no morpheme to hold, in the order the old
 * breakdown listed them. Empty when the re-split keeps every annotated form, which is the common
 * case.
 *
 * Forms are matched as a re-split itself matches them — by form, first-come-first-served within a
 * repeated form — so the answer can never disagree with what the write goes on to drop. A form is
 * counted once per occurrence: re-splitting "ba ba" to a single "ba" strands the second.
 *
 * Bare forms are left out. Losing one costs only the segmentation, which the reader is retyping
 * anyway, and prompting about it would train them to click through the prompt that does carry a
 * loss.
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
    else if (morphemeCarriesAnnotation(morpheme)) lost.push(morpheme.form);
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
       * editing can never leave the duplicate the create path's find-or-create avoids. Otherwise
       * the token is linked to a content-identical record where one exists, or to a new one (an
       * orphaned approved link is repaired first). The token's non-approved links are left
       * untouched, except one to the record it takes, which is approved.
       *
       * A blank `value` (empty or whitespace) is treated as clearing the gloss rather than writing
       * junk: the active language's entry is removed, and when that leaves the analysis with no
       * content, the record and its link are removed entirely. The clear forks a shared payload
       * just as an edit does, so the co-linked tokens keep the shared gloss rather than being
       * stranded on an emptied payload. A blank write to a token with no approved analysis is a
       * no-op, so a focus/blur cycle on an empty gloss never creates a record.
       *
       * A gloss the reader typed resolves through no lexicon sense of theirs, so a rewrite drops
       * the payload's `glossSenseRef`. A clear drops it only once no language still holds usable
       * gloss text, the sense belonging to the analysis rather than to the emptied language.
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
            clearAnalysisGloss(target, lang);
            // When the clear empties the analysis, detach it; otherwise the cleared payload (e.g. one
            // left holding only morphemes) can be identical to an existing sibling, so re-converge —
            // mirroring writeMorphemeGloss's clear path so a clear never leaves a duplicate the
            // suggestion pool would double-count.
            if (isEmptyTokenAnalysis(target)) detachTokenAnalysisLink(state, target, link);
            else mergeIntoIdenticalPayload(state, target, now);
            return;
          }
          if (!target.gloss) target.gloss = {};
          target.gloss[lang] = value;
          delete target.glossSenseRef;
          // An in-place edit can make this payload identical to an existing one (e.g. a homograph
          // instance re-glossed to match its sibling); re-converge so the dedupe the create path
          // guarantees on first write also holds after edits.
          mergeIntoIdenticalPayload(state, target, now);
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
          mergeIntoIdenticalPayload(state, target, now);
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
        mergeIntoIdenticalPayload(state, target, now);
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
        mergeIntoIdenticalPayload(state, target, now);
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
     *
     * A gloss the reader typed resolves through no lexicon sense of theirs, so a rewrite drops the
     * record's `glossSenseRef`. A clear drops it only once no language still holds usable gloss
     * text, the sense belonging to the analysis rather than to the emptied language.
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
          clearAnalysisGloss(analysis, lang);
        } else {
          if (!analysis.gloss) analysis.gloss = {};
          analysis.gloss[lang] = value;
          delete analysis.glossSenseRef;
        }
        analysis.updatedAt = now;

        // Removed outright rather than left as an empty payload the pool would still carry.
        if (isEmptyTokenAnalysis(analysis)) {
          removeAnalysisAndLinks(state, analysisId);
          return;
        }
        mergeIntoIdenticalPayload(state, analysis, now);
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
        mergeIntoIdenticalPayload(state, analysis, now);
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
        mergeIntoIdenticalPayload(state, analysis, now);
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
     * Folds several `TokenAnalysis` records into one and writes the content they agreed on onto it,
     * so a reader consolidating a form's homographs settles what the survivor says in the same
     * stroke that gathers the tokens onto it.
     *
     * Settling the content and gathering the links is indivisible: no state is reachable in which
     * the survivor has been rewritten but the records it is absorbing still hold their tokens.
     *
     * The survivor is stamped, content having been written to it. A merged id that resolves to no
     * payload is skipped, and one naming the survivor is ignored rather than dropping the record
     * the merge is keeping. No-ops entirely when the survivor resolves to no payload, there being
     * nothing to write onto.
     *
     * Where a token held links to both a merged record and the survivor it is left holding one,
     * approved if either was and keeping that approval's `confidence` and the earlier `createdAt`.
     * A survivor whose settled content matches a record the merge did not fold in collapses onto
     * it, so consolidating can never leave two payloads saying the same thing.
     *
     * Glosses in languages besides the one the merge was conducted in are carried off the records
     * being dropped rather than going with them, the survivor's own standing where it holds them.
     * `mergedAnalysisIds` ranks the donors most-preferred first, deciding which of them a carried
     * value comes from. The sense reference instead follows the settled gloss, resting with
     * whichever record supplied it and clearing for a gloss the reader typed.
     *
     * A merge settling on no content at all takes the survivor with it, releasing every gathered
     * token to the suggestion pool rather than leaving them approved against a blank record. A
     * survivor left holding only carried-over content is content enough to keep.
     */
    mergeAnalysesInto: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: {
        survivorAnalysisId: string;
        mergedAnalysisIds: readonly string[];
        content: MergedContent;
      }) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(
        state,
        action: PayloadAction<{
          survivorAnalysisId: string;
          mergedAnalysisIds: readonly string[];
          content: MergedContent;
          now: string;
        }>,
      ) {
        const { survivorAnalysisId, mergedAnalysisIds, content, now } = action.payload;
        const survivor = state.analysis.tokenAnalyses.find((ta) => ta.id === survivorAnalysisId);
        if (!survivor) return;
        state.lastCollapseSurvivorId = undefined;

        const merged = new Set(
          mergedAnalysisIds.filter(
            (id) =>
              id !== survivorAnalysisId && state.analysis.tokenAnalyses.some((ta) => ta.id === id),
          ),
        );

        // Resolved while the donors are still standing.
        const donors = [...merged]
          .map((id) => state.analysis.tokenAnalyses.find((ta) => ta.id === id))
          .filter((ta) => ta !== undefined);

        const glossFrom =
          content.glossFromAnalysisId === undefined
            ? undefined
            : state.analysis.tokenAnalyses.find((ta) => ta.id === content.glossFromAnalysisId);

        applyMergedContent(survivor, content, state.analysisLanguage);
        carryOverUnsettledContent(survivor, donors, state.analysisLanguage, glossFrom);
        survivor.updatedAt = now;

        state.analysis.tokenAnalysisLinks.forEach((l) => {
          if (merged.has(l.analysisId)) {
            l.analysisId = survivorAnalysisId;
            l.updatedAt = now;
          }
        });
        coalesceLinksPerToken(state, survivorAnalysisId, now);
        state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter(
          (ta) => !merged.has(ta.id),
        );

        // Merged away to nothing, the record goes rather than holding every gathered token at a
        // blank approval, which would render as no gloss and block the pool from offering one.
        if (isEmptyTokenAnalysis(survivor)) {
          removeAnalysisAndLinks(state, survivorAnalysisId);
          return;
        }

        mergeIntoIdenticalPayload(state, survivor, now, true);
      },
    },
    /**
     * Approves a shared `TokenAnalysis` payload for a token — the persisted half of accepting a
     * suggestion or promoting a candidate (see {@link selectResolvedTokenAnalysis}). No new payload
     * is created (unlike {@link writeGloss}'s find-or-create); the chosen payload's approval
     * frequency rises by one and the token's derived suggestion disappears now that it carries its
     * own approved decision.
     *
     * A token already linking the payload without approving it — an import's unreviewed record — is
     * approved by flipping that link's `status`, so it never ends up holding two links to one
     * payload. Its `confidence` is left as recorded.
     *
     * When the token already has an approved analysis the existing link is **repointed** to the
     * chosen payload rather than a second link being appended, so the "at most one approved link
     * per token" invariant is preserved while still letting an already-approved homograph be
     * promoted to a different analysis (the affordance {@link selectResolvedTokenAnalysis} offers on
     * approved tokens). The repoint lands on the same link the read selectors surface, and an
     * orphaned approved link is healed first rather than blocking the promotion. When the existing
     * approval already points at the chosen payload the repoint is a no-op. The old payload is
     * reclaimed once no link references it, so a promotion never strands an unlinked payload.
     *
     * An `analysisId` that resolves to no stored payload is rejected (no-op) rather than approved
     * as a fresh orphan. The link's snapshot records _this_ token's `surfaceText` (not the shared
     * payload's), matching the create path so per-token drift detection stays accurate.
     *
     * Only the link is stamped, and a promotion refreshes just its `updatedAt`: the link dates this
     * token's first annotation, which neither a change of payload nor a flip resets. The approved
     * payload is adopted as it stands, so its own timestamps keep reporting the age of the record
     * rather than the moment this token accepted it.
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
        if (resolved?.link.analysisId === analysisId) return;

        const pending = approveHeldLink(state, tokenRef, analysisId, surfaceText, now);
        if (pending) {
          if (resolved) {
            if (resolved.link.createdAt < pending.createdAt)
              pending.createdAt = resolved.link.createdAt;
            state.analysis.tokenAnalysisLinks = state.analysis.tokenAnalysisLinks.filter(
              (l) => l !== resolved.link,
            );
          }
        } else if (resolved) {
          resolved.link.analysisId = analysisId;
          resolved.link.token.surfaceText = surfaceText;
          resolved.link.updatedAt = now;
        } else {
          state.analysis.tokenAnalysisLinks.push({
            analysisId,
            createdAt: now,
            updatedAt: now,
            status: 'approved',
            token: { tokenRef, surfaceText },
          });
        }

        if (
          resolved &&
          !state.analysis.tokenAnalysisLinks.some((l) => l.analysisId === resolved.analysis.id)
        ) {
          state.analysis.tokenAnalyses = state.analysis.tokenAnalyses.filter(
            (ta) => ta !== resolved.analysis,
          );
        }
      },
    },
    createPhrase: {
      /**
       * Generates UUIDs for the new link and a potential new `PhraseAnalysis` before the action
       * reaches the reducer, keeping the reducer pure.
       */
      prepare(tokens: TokenSnapshot[]) {
        return {
          payload: {
            id: crypto.randomUUID(),
            analysisId: crypto.randomUUID(),
            tokens,
            now: nowIso(),
          },
        };
      },
      /**
       * Adds an approved phrase occurrence over `tokens`. It shares a content-identical payload
       * where one exists, adopting it as it stands, and otherwise gets a new one.
       */
      reducer(state, action: PayloadAction<CreatePhrasePayload>) {
        const { id, analysisId, tokens, now } = action.payload;
        const created: PhraseAnalysis = {
          id: analysisId,
          createdAt: now,
          updatedAt: now,
          surfaceText: phraseSurfaceText(tokens),
        };
        const existing = state.analysis.phraseAnalyses.find((pa) =>
          phraseAnalysesAreIdentical(pa, created),
        );
        if (!existing) state.analysis.phraseAnalyses.push(created);
        state.analysis.phraseAnalysisLinks.push({
          id,
          analysisId: existing?.id ?? analysisId,
          createdAt: now,
          updatedAt: now,
          status: 'approved',
          tokens,
        });
      },
    },
    /**
     * Gives one phrase occurrence a new token run, keeping its gloss and re-deriving the payload's
     * surface form so that never goes stale. The edit is per-occurrence: other occurrences sharing
     * the payload keep their surface form. An empty `tokens` removes the occurrence, so a
     * zero-token phrase can never persist.
     */
    updatePhrase: {
      /**
       * Reads the clock and mints an id for a forked payload before the action reaches the reducer,
       * keeping the reducer pure.
       */
      prepare(arg: UpdatePhrasePayload) {
        return { payload: { ...arg, forkId: crypto.randomUUID(), now: nowIso() } };
      },
      reducer(state, action: PayloadAction<UpdatePhrasePayload & PhraseEditStamp>) {
        const { phraseId, tokens } = action.payload;
        const link = findPhraseLink(state, phraseId);
        if (!link) return;
        if (tokens.length === 0) detachPhraseLink(state, link);
        else reshapePhrase(state, link, tokens, action.payload);
      },
    },
    /**
     * Removes one phrase occurrence. Its payload goes with it only when no other occurrence shares
     * it.
     */
    deletePhrase(state, action: PayloadAction<DeletePhrasePayload>) {
      const link = findPhraseLink(state, action.payload.phraseId);
      if (link) detachPhraseLink(state, link);
    },
    /**
     * Merges a neighboring phrase (or a free token) into the target phrase as a single atomic
     * mutation: the target takes the supplied merged token run, as {@link updatePhrase} would give
     * it, and the absorbed neighbor, when given, is removed as {@link deletePhrase} would remove it.
     * One reducer means no save can observe the neighbor's tokens in two phrases at once.
     *
     * No-ops when `absorbedPhraseId === targetPhraseId`, which would otherwise delete the phrase it
     * grows.
     */
    mergePhrases: {
      /**
       * Reads the clock and mints an id for a forked payload before the action reaches the reducer,
       * keeping the reducer pure.
       */
      prepare(arg: MergePhrasesPayload) {
        return { payload: { ...arg, forkId: crypto.randomUUID(), now: nowIso() } };
      },
      reducer(state, action: PayloadAction<MergePhrasesPayload & PhraseEditStamp>) {
        const { targetPhraseId, tokens, absorbedPhraseId } = action.payload;
        if (absorbedPhraseId !== undefined && absorbedPhraseId === targetPhraseId) return;

        // Removed first, so a payload only the two shared stays with the target rather than forking.
        const absorbed =
          absorbedPhraseId === undefined ? undefined : findPhraseLink(state, absorbedPhraseId);
        if (absorbed) detachPhraseLink(state, absorbed);
        const link = findPhraseLink(state, targetPhraseId);
        if (link) reshapePhrase(state, link, tokens, action.payload);
      },
    },
    /**
     * Writes one phrase occurrence's gloss in the active analysis language. The edit is
     * per-occurrence: other occurrences sharing the payload keep their gloss, and an edit that
     * matches another payload joins it. A blank `value` (empty or whitespace) clears the language's
     * gloss rather than storing junk, leaving the phrase itself in place. No-ops when the
     * occurrence or its payload is not found.
     */
    writePhraseGloss: {
      /**
       * Reads the clock and mints an id for a forked payload before the action reaches the reducer,
       * keeping the reducer pure.
       */
      prepare(arg: WritePhraseGlossPayload) {
        return { payload: { ...arg, forkId: crypto.randomUUID(), now: nowIso() } };
      },
      reducer(state, action: PayloadAction<WritePhraseGlossPayload & PhraseEditStamp>) {
        const { phraseId, value, forkId, now } = action.payload;
        const link = findPhraseLink(state, phraseId);
        const target = link && editablePhraseAnalysis(state, link, forkId, now);
        if (!link || !target) return;
        const lang = state.analysisLanguage;
        if (value.trim() !== '') {
          if (!target.gloss) target.gloss = {};
          target.gloss[lang] = value;
        } else if (target.gloss) {
          delete target.gloss[lang];
          if (isEmptyMultiString(target.gloss)) delete target.gloss;
        }
        target.updatedAt = now;
        link.updatedAt = now;
        mergeIntoIdenticalPhrase(state, target);
      },
    },
    /**
     * Approves a persisted phrase occurrence by flipping its link's `status`, leaving its
     * `confidence` as recorded. Refused while any of its tokens belongs to an approved phrase, so
     * no token ends up in two. A no-op for an unknown or already-approved occurrence.
     */
    approvePhrase: {
      /** Reads the clock before the action reaches the reducer, keeping the reducer pure. */
      prepare(arg: { phraseId: string }) {
        return { payload: { ...arg, now: nowIso() } };
      },
      reducer(state, action: PayloadAction<{ phraseId: string; now: string }>) {
        const { phraseId, now } = action.payload;
        const links = state.analysis.phraseAnalysisLinks;
        const link = links.find((l) => l.id === phraseId);
        if (!link || link.status === 'approved') return;
        const tokenRefs = new Set(link.tokens.map((t) => t.tokenRef));
        const overlapsApproved = links.some(
          (l) => l.status === 'approved' && l.tokens.some((t) => tokenRefs.has(t.tokenRef)),
        );
        if (overlapsApproved) return;
        link.status = 'approved';
        link.updatedAt = now;
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
  mergeAnalysesInto,
  approveAnalysisForToken,
  createPhrase,
  updatePhrase,
  deletePhrase,
  mergePhrases,
  writePhraseGloss,
  approvePhrase,
  writeSegmentFreeTranslation,
} = analysisSlice.actions;
export default analysisSlice.reducer;

// #endregion

// #region Selectors

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

const NO_PENDING: readonly TokenAnalysis[] = [];

/**
 * Memoized selector mapping each token to the payloads its persisted non-approved links hold — what
 * an import records without approving — best-first: `'suggested'` links ahead of the rest, each in
 * link order. `'rejected'` and orphaned links are left out, and a payload a token links twice is
 * listed once.
 */
const selectPendingAnalysesByTokenRef = createSelector(
  selectTokenAnalysisLinks,
  selectAnalysisById,
  (links, byId) => {
    const index = new Map<string, TokenAnalysis[]>();
    const file = (link: TokenAnalysisLink) => {
      const analysis = byId.get(link.analysisId);
      if (!analysis) return;
      const pending = index.get(link.token.tokenRef);
      if (!pending) index.set(link.token.tokenRef, [analysis]);
      else if (!pending.includes(analysis)) pending.push(analysis);
    };
    links.forEach((l) => {
      if (l.status === 'suggested') file(l);
    });
    links.forEach((l) => {
      if (l.status === 'candidate' || l.status === 'stale') file(l);
    });
    return index;
  },
);

/** Memoized selector mapping each token to the ids of the payloads it links as `'rejected'`. */
const selectRejectedAnalysisIdsByTokenRef = createSelector(selectTokenAnalysisLinks, (links) => {
  const index = new Map<string, Set<string>>();
  links.forEach((l) => {
    if (l.status !== 'rejected') return;
    const rejected = index.get(l.token.tokenRef);
    if (rejected) rejected.add(l.analysisId);
    else index.set(l.token.tokenRef, new Set([l.analysisId]));
  });
  return index;
});

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
 * Memoized selector mapping each `TokenAnalysis.id` to the number of distinct tokens linking it at
 * any status — the tokens a per-token edit must fork around.
 */
const selectLinkedTokenCountByAnalysisId = createSelector(selectTokenAnalysisLinks, (links) => {
  const tokenRefsById = new Map<string, Set<string>>();
  links.forEach((l) => {
    const tokenRefs = tokenRefsById.get(l.analysisId);
    if (tokenRefs) tokenRefs.add(l.token.tokenRef);
    else tokenRefsById.set(l.analysisId, new Set([l.token.tokenRef]));
  });
  return new Map([...tokenRefsById].map(([id, tokenRefs]) => [id, tokenRefs.size]));
});

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
   * `'blank'` when the affected tokens are left reading as unanalyzed, `'fallback'` when another
   * analysis takes over for any of them or, where `uncertain`, may.
   */
  kind: 'blank' | 'fallback';
  /** How many tokens the deletion affects. */
  usageCount: number;
  /**
   * What the affected tokens will read once the deletion commits. Absent when `uncertain`, or when
   * the analysis they will read carries no gloss in the active analysis language, leaving no word
   * to quote at the user.
   */
  fallbackGloss?: string;
  /**
   * Whether the affected tokens may not all come to read the same thing — because they would read
   * different analyses, or some cannot be read to tell.
   */
  uncertain?: boolean;
  /**
   * How many tokens record this analysis without approving it — an import's unreviewed records,
   * offered to those tokens as suggestions. They go with the deletion like the approvals do.
   */
  unappliedCount: number;
}

/**
 * Reports what {@link deleteAnalysis} would do to the given row, for the confirmation to name.
 * Returns `undefined` when the id resolves to no payload, so a stale row cannot open a confirmation
 * for a record that is already gone.
 *
 * Judges each affected token's fallback as the renderer will: its own surviving unapproved records
 * first, then the pool's match for its text as it now stands less any analysis it rejected, read
 * through `liveSurfaceText` — which covers the loaded book alone, giving `undefined` for a ref in
 * any other.
 */
export function selectAnalysisDeletionOutcome(
  state: AnalysisState,
  analysisId: string,
  liveSurfaceText: (tokenRef: string) => string | undefined,
): AnalysisDeletionOutcome | undefined {
  const analysis = state.analysis.tokenAnalyses.find((ta) => ta.id === analysisId);
  if (!analysis) return undefined;

  const approvedTokenCounts = selectApprovedTokenCountByAnalysisId(state);

  // Counted off the same index the catalog row counts by, so the confirmation and the row it opened
  // from cannot name two different numbers: both count the tokens an approval sits on rather than
  // the approvals themselves.
  //
  // Non-approved links are left out of this number though the deletion drops them too: they are not
  // places the analysis is applied, so counting one here would name a consequence no token displays.
  const usageCount = approvedTokenCounts.get(analysisId) ?? 0;

  // Counted by distinct token, matching usageCount, so a token an import recorded twice reads as the
  // one place it is that the deletion touches.
  const unappliedCount = new Set(
    state.analysis.tokenAnalysisLinks
      .filter((l) => l.analysisId === analysisId && l.status !== 'approved')
      .map((l) => l.token.tokenRef),
  ).size;

  // The fallback is what the affected tokens come to read, so a record nothing approves has none
  // however many homographs the pool still offers for its form.
  if (usageCount === 0) return { kind: 'blank', usageCount, unappliedCount };

  // Ask the engine, so the confirmation names the peer that actually wins. The payload is dropped
  // from the pool outright rather than discounted by one approval: a deletion removes all of its
  // approvals at once, and a discounted multi-token payload would compete to replace itself.
  const survivingPool = buildPoolIndex(
    selectAnalysisById(state),
    new Map([...approvedTokenCounts].filter(([id]) => id !== analysisId)),
  );

  // A token reads its own record whatever its text, so only a pool pick needs the live form.
  const pendingByToken = selectPendingAnalysesByTokenRef(state);
  const rejectedByToken = selectRejectedAnalysisIdsByTokenRef(state);
  const picks = new Set<TokenAnalysis | undefined>();
  let unreadable = false;
  state.analysis.tokenAnalysisLinks.forEach((l) => {
    if (l.analysisId !== analysisId || l.status !== 'approved') return;
    const { tokenRef } = l.token;
    const recorded = pendingByToken.get(tokenRef)?.find((ta) => ta.id !== analysisId);
    if (recorded) {
      picks.add(recorded);
      return;
    }
    const live = liveSurfaceText(tokenRef);
    if (live === undefined) {
      unreadable = true;
      return;
    }
    picks.add(
      withoutAnalyses(deriveTokenSuggestion(survivingPool, live), rejectedByToken.get(tokenRef))
        ?.suggested,
    );
  });

  if (unreadable || picks.size > 1)
    return { kind: 'fallback', usageCount, unappliedCount, uncertain: true };
  const [pick] = picks;
  if (!pick) return { kind: 'blank', usageCount, unappliedCount };

  const gloss = pick.gloss?.[state.analysisLanguage];
  return {
    kind: 'fallback',
    usageCount,
    unappliedCount,
    ...(gloss ? { fallbackGloss: gloss } : {}),
  };
}

/**
 * What `tokenRef` is offered: its own persisted non-approved analyses ranked ahead of the `pool`
 * offer, less any analysis the token rejected.
 */
function offerForToken(
  state: AnalysisState,
  tokenRef: string,
  pool: TokenSuggestion | undefined,
): TokenSuggestion | undefined {
  return withPendingAnalyses(
    selectPendingAnalysesByTokenRef(state).get(tokenRef) ?? NO_PENDING,
    withoutAnalyses(pool, selectRejectedAnalysisIdsByTokenRef(state).get(tokenRef)),
  );
}

/**
 * Returns the merged analysis the renderer shows for a token: its approved decision when one
 * exists, otherwise what it is offered, or `undefined` when the token has neither. What a token is
 * offered is its own persisted non-approved analyses ranked ahead of the pool's match for its
 * surface form, less any analysis it rejected. This is the single source the gloss renderer reads —
 * it never combines stored decisions and the derived view itself. An approved token carries the
 * offer only as promotable alternatives, so a confirmed token never shows a suggestion.
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
  const offered = offerForToken(
    state,
    tokenRef,
    deriveTokenSuggestion(selectPoolIndex(state), surfaceText),
  );
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId !== undefined) {
    const analysis = selectAnalysisById(state).get(approvedId);
    /* v8 ignore next -- approvedId comes from the byId-filtered approved map, so the payload is present */
    if (!analysis) return undefined;
    return { status: 'approved', analysis, alternatives: offered };
  }
  return offered ? { status: 'suggested', ...offered } : undefined;
}

/**
 * Returns the suggestion a token would resolve to if its own approval were removed — the preview
 * the gloss UI shows the instant an approved gloss is cleared, before the empty value commits on
 * blur. Re-derives this surface form's bucket with the token's approved payload discounted by one
 * approval (dropped when this was its last), so the previewed pick matches what the committed
 * deletion will surface rather than the approved payload's mere alternatives. The token's own
 * persisted non-approved analyses rank ahead and those it rejected are left out, as once the
 * deletion commits. Returns `undefined` when the token has no approval (callers only consult this
 * for an approved token) or when nothing is left to offer once that approval is discounted.
 */
export function selectSuggestionAfterClearing(
  state: AnalysisState,
  tokenRef: string,
  surfaceText: string,
): ResolvedTokenAnalysis | undefined {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId === undefined) return undefined;
  const suggestion = offerForToken(
    state,
    tokenRef,
    deriveTokenSuggestion(selectPoolIndex(state), surfaceText, approvedId),
  );
  return suggestion ? { status: 'suggested', ...suggestion } : undefined;
}

/**
 * Reports whether removing `tokenRef`'s morpheme breakdown would destroy annotation no other token
 * still holds — the condition under which the morpheme editor confirms before resetting. True only
 * when at least one morpheme carries a gloss or a lexicon reference AND no other token links its
 * approved payload. A payload shared with other tokens is forked rather than emptied, so the
 * co-linked tokens keep their morphemes and nothing is lost project-wide; an unannotated breakdown
 * is bare segmentation that is cheap to retype. Sharing is judged by the same linked-token count
 * the write path tests before it forks, so the two can never disagree about what "shared" means.
 */
export function selectMorphemeResetLosesAnnotation(
  state: AnalysisState,
  tokenRef: string,
): boolean {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId === undefined) return false;
  const analysis = selectAnalysisById(state).get(approvedId);
  const hasAnnotatedMorpheme = analysis?.morphemes?.some(morphemeCarriesAnnotation) ?? false;
  if (!hasAnnotatedMorpheme) return false;
  // A payload another token links is forked rather than emptied, so only a sole owner loses anything.
  /* v8 ignore next -- this token's own link is among those counted, so approvedId is always present */
  const linkedTokenCount = selectLinkedTokenCountByAnalysisId(state).get(approvedId) ?? 0;
  return linkedTokenCount <= 1;
}

/**
 * Reports whether no token besides `tokenRef` links its approved payload, so a breakdown edit here
 * destroys what it drops instead of leaving it with co-linked tokens. False when the token has no
 * approval at all.
 *
 * Sharing is judged by the same linked-token count a breakdown write forks on, so the two can never
 * disagree about which edits are recoverable.
 */
export function selectMorphemePayloadIsSolelyOwned(
  state: AnalysisState,
  tokenRef: string,
): boolean {
  const approvedId = selectApprovedIdByTokenRef(state).get(tokenRef);
  if (approvedId === undefined) return false;
  /* v8 ignore next -- this token's own link is among those counted, so approvedId is always present */
  const linkedTokenCount = selectLinkedTokenCountByAnalysisId(state).get(approvedId) ?? 0;
  return linkedTokenCount <= 1;
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
 * Memoized selector returning the persisted `PhraseAnalysisLink`s not yet approved — what an import
 * records without approving — leaving out `'rejected'` ones.
 */
export const selectPendingPhraseLinks = createSelector(selectPhraseAnalysisLinksRaw, (links) =>
  links.filter((l) => l.status !== 'approved' && l.status !== 'rejected'),
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
 * Memoized selector that builds a `Map` from `PhraseAnalysisLink.id` to approved
 * `PhraseAnalysisLink` for O(1) lookup of a phrase occurrence. Recomputes only when approved phrase
 * links change.
 */
export const selectPhraseLinkById = createSelector(
  selectPhraseLinks,
  (links) => new Map(links.map((link) => [link.id, link])),
);

/**
 * Returns the gloss the phrase occurrence `phraseId` reads in the active analysis language, or `''`
 * when the occurrence or its payload is not found or it has no gloss for the active language.
 */
export function selectPhraseGloss(state: AnalysisState, phraseId: string): string {
  const link = state.analysis.phraseAnalysisLinks.find((l) => l.id === phraseId);
  if (!link) return '';
  const pa = state.analysis.phraseAnalyses.find((p) => p.id === link.analysisId);
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

/** Projects `segmentAnalysisLinks` out of `AnalysisState` for use as a `createSelector` input. */
const selectSegmentAnalysisLinks = (state: AnalysisState) => state.analysis.segmentAnalysisLinks;

/** Projects `segmentAnalyses` out of `AnalysisState` for use as a `createSelector` input. */
const selectSegmentAnalyses = (state: AnalysisState) => state.analysis.segmentAnalyses;

/**
 * Memoized selector returning the free translation of every segment carrying a non-empty one in the
 * active analysis language, keyed by segment id.
 */
export const selectFreeTranslationsBySegment = createSelector(
  selectSegmentAnalysisLinks,
  selectSegmentAnalyses,
  selectAnalysisLanguage,
  (links, analyses, language) => {
    const translatedById = new Map(
      analyses.map((a) => [a.id, a.freeTranslation?.[language] ?? '']),
    );
    const bySegment = new Map<string, string>();
    links.forEach((link) => {
      if (link.status !== 'approved') return;
      const text = translatedById.get(link.analysisId) ?? '';
      if (text !== '') bySegment.set(link.segmentId, text);
    });
    return bySegment;
  },
);

// #endregion
