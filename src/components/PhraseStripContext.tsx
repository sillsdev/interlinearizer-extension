import { createContext, useContext } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { PhraseAnalysisLink } from 'interlinearizer';
import type { PhraseMode } from '../types/phrase-mode';

/**
 * The accessible labels a word token's chip and morpheme rows format for themselves, each with its
 * `{token}`, `{form}`, or `{gloss}` placeholder still unfilled.
 *
 * Bundled so one strip-wide lookup serves every chip: a strip carries a chip per word token, and a
 * localization subscription apiece would cost a round trip apiece on every mount.
 */
export type TokenChipLabels = Readonly<{
  /** Accessible label for a token's gloss input. */
  tokenGloss: string;
  /** Accessible label for the button that summons a token's suggestion dropdown. */
  showSuggestions: string;
  /** Accessible label for the breakdown trigger on a token that has no morphemes yet. */
  defineMorphemes: string;
  /** Accessible label for the whole-breakdown control on a token that has morphemes. */
  editMorphemes: string;
  /** Accessible label for a single morpheme's gloss input. */
  morphemeGloss: string;
  /** Accessible label for the dropdown row that approves a token's suggested gloss. */
  acceptSuggestion: string;
  /** Accessible label for a dropdown row that promotes a candidate gloss. */
  promoteSuggestion: string;
}>;

/**
 * The localize key each {@link TokenChipLabels} field resolves from. Doubles as the pre-resolution
 * value of the bundle: the localization hook yields every key as its own value until its lookup
 * lands, so a chip rendered before (or without) a strip's fetch shows exactly what it would show in
 * that first frame.
 */
export const TOKEN_CHIP_LABEL_KEYS = {
  tokenGloss: '%interlinearizer_tokenChip_glossLabel%',
  showSuggestions: '%interlinearizer_tokenChip_showSuggestions%',
  defineMorphemes: '%interlinearizer_tokenChip_defineMorphemes%',
  editMorphemes: '%interlinearizer_tokenChip_editMorphemes%',
  morphemeGloss: '%interlinearizer_morphemeGloss_label%',
  acceptSuggestion: '%interlinearizer_suggestion_accept%',
  promoteSuggestion: '%interlinearizer_suggestion_promote%',
} as const satisfies Record<keyof TokenChipLabels, `%${string}%`>;

/**
 * The stable, strip-wide context for one render of a token row: a single value is built per render
 * and provided around the row via {@link PhraseStripProvider}, reaching every phrase group and link
 * slot beneath it.
 *
 * It holds the values identical across a whole strip render — the edit-mode context and the
 * hover-preview callbacks — so the structural intermediaries never forward props they don't touch,
 * and each prop that remains on them describes something genuinely per-group or per-slot.
 *
 * Per-instance values such as focus, highlight, arc offset, and slot geometry are deliberately
 * **not** here: they vary per item and belong at the call site as props.
 */
export type PhraseStripContextValue = Readonly<{
  /** Current phrase-interaction mode; controls rendering and click behavior in all leaves. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; entering edit or confirm-unlink mode goes through it. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Token list of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseTokens: PhraseAnalysisLink['tokens'] | undefined;
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseSegmentId: string | undefined;
  /** Token ref → segment id lookup; used in edit mode to disable cross-segment tokens. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /**
   * Token ref → flat document index; used to keep merged phrase token lists in document order, and
   * to pick which fragment of a phrase carries its gloss input. Must cover every word token the
   * strip renders: a phrase none of whose tokens appear here gets no gloss input on any fragment.
   */
  tokenDocOrder: ReadonlyMap<string, number>;
  /**
   * Called with a phraseId (or `undefined`) when a phrase or a link/unlink candidate is hovered, so
   * the parent can highlight the relevant phrase box and arcs.
   */
  onHoverPhrase: (phraseId: string | undefined) => void;
  /**
   * Called with the candidate token refs (or `undefined`) when a link icon or a boundary
   * merge/split control is hovered; the affected groups render the strong candidate preview style.
   */
  onHoverCandidateTokens: (refs: readonly string[] | undefined) => void;
  /** Called with the would-be-free token refs (or `undefined`) when a split/unlink icon is hovered. */
  onHoverSplitFreeTokens: (refs: readonly string[] | undefined) => void;
  /**
   * When `true`, the link/unlink buttons in the slots between phrase boxes are hidden in segments
   * other than the active verse (see {@link activeSegmentId}). These buttons sit _between_ phrases,
   * so they are governed by segment, not by phrase focus. Works the same in both strips.
   */
  hideInactiveLinkButtons: boolean;
  /**
   * When `true`, the interactive controls that belong to a phrase — the split-arc button, the
   * intra-phrase unlink icons between a phrase's own tokens, the remove-token (✕) button, and the
   * floating edit/unlink controls pill — are hidden on every phrase except the focused one.
   * Non-focused phrases still change style on hover but expose no interactive controls. Keyed off
   * phrase focus, not segment, so it behaves identically in both strips.
   */
  simplifyPhrases: boolean;
  /**
   * Segment id of the currently active verse, or `undefined` when nothing is active. A link slot
   * counts as "in the active segment" when either neighboring phrase box belongs to this segment.
   * Used together with {@link hideInactiveLinkButtons} to suppress link buttons outside the active
   * verse in both strips.
   */
  activeSegmentId: string | undefined;
  /** Tooltip shown on disabled link buttons because they are outside the currently focused segment. */
  crossSegmentLinkTooltip: string;
  /**
   * Accessible label for the link button between two tokens, fetched once per strip rather than per
   * slot (a strip renders one link icon between every pair of adjacent tokens).
   */
  linkTokensLabel: string;
  /** Accessible label for the unlink button between two tokens already in one phrase. */
  unlinkTokensLabel: string;
  /** Accessible label for a phrase box's gloss input, fetched once per strip rather than per phrase. */
  phraseGlossLabel: string;
  /** Accessible label for the edit button on a phrase's floating controls pill. */
  phraseEditLabel: string;
  /** Accessible label for the unlink button on a phrase's floating controls pill. */
  phraseUnlinkLabel: string;
  /**
   * Accessible label for removing a token from its phrase, with `{token}` still to be substituted
   * for the token's surface text. One label covers every route to that affordance, so the wording
   * cannot drift between them.
   */
  removeTokenFromPhraseTemplate: string;
  /**
   * Accessible label for adding a free token to the phrase being edited, with `{token}` still to be
   * substituted for the token's surface text.
   */
  addTokenToPhraseTemplate: string;
  /**
   * Label and concise tooltip for the merge boundary button, fetched once per strip rather than per
   * slot (every between-group slot renders its own boundary control).
   */
  boundaryMergeLabel: string;
  /**
   * Tooltip advertising the Alt-split gesture on the merge button while Alt is up, with its `{key}`
   * placeholder still unfilled.
   */
  boundaryMergeAltHint: string;
  /** Label and tooltip for the Alt-gated split marker. */
  boundarySplitLabel: string;
  /**
   * Placeholder text for every gloss input (token- and phrase-level), fetched once per strip rather
   * than per chip. Gloss inputs are `field-sizing: content`, so their width depends on the
   * placeholder; fetching per chip would let each mount render narrow until its async string
   * resolves, shifting the strip and mis-measuring arcs. Empty string until the strip's own fetch
   * resolves (one strip-wide reflow at most, behind the initial fade).
   */
  glossPlaceholder: string;
  /** Labels every word token's chip formats for itself, resolved once per strip. */
  tokenChipLabels: TokenChipLabels;
  /**
   * When `true`, the sliding-door transition on link-slot wrappers is suppressed (duration set to
   * 0ms). Set during external navigation and initial mount so the layout snaps to its final state
   * before the strip fades in, rather than animating while the strip is becoming visible.
   */
  skipLinkTransition: boolean;
  /**
   * When `true`, each word token displays its morpheme breakdown and per-morpheme glosses beneath
   * the token-level gloss input.
   */
  showMorphology: boolean;
}>;

/** The phrase-strip context. `undefined` outside a provider so consumers can fail loudly. */
const PhraseStripContext = createContext<PhraseStripContextValue | undefined>(undefined);

/** Props for {@link PhraseStripProvider}. */
type PhraseStripProviderProps = Readonly<{
  /** The strip-wide context value; callers should memoize it to preserve leaf memoization. */
  value: PhraseStripContextValue;
  /** The strip's token row. */
  children: ReactNode;
}>;

/**
 * Provides the strip-wide {@link PhraseStripContextValue} to every phrase group and link slot
 * rendered beneath it. One provider per strip render.
 */
export function PhraseStripProvider({ value, children }: PhraseStripProviderProps) {
  return <PhraseStripContext.Provider value={value}>{children}</PhraseStripContext.Provider>;
}

/**
 * Reads the strip-wide phrase context. Must be called from inside a {@link PhraseStripProvider}.
 *
 * @throws If called outside a {@link PhraseStripProvider}.
 */
export function usePhraseStripContext(): PhraseStripContextValue {
  const value = useContext(PhraseStripContext);
  if (value === undefined) {
    throw new Error('usePhraseStripContext must be used within a PhraseStripProvider');
  }
  return value;
}
