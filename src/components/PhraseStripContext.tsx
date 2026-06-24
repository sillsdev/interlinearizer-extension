/**
 * @file Render-scoped context shared by the two phrase strips (`SegmentView` and `ContinuousView`).
 *
 *   Holds the values that are identical for every phrase group and link slot within a single strip
 *   render: the edit-mode context and the hover-preview callbacks. These were previously threaded
 *   as individual props through `PhraseGroup`/`PhraseSlot` purely to reach the leaf components
 *   (`PhraseBox`, `TokenLinkIcon`) that actually use them. Delivering them via context lets the
 *   structural intermediaries stop declaring and forwarding props they never touch, so each
 *   remaining prop on `PhraseGroup`/`PhraseSlot` describes something genuinely per-group/per-slot.
 *
 *   Per-instance values (focus, highlight, arc offset, slot geometry) are intentionally **not** here
 *   — they vary per item and belong at the call site as props.
 */
import { createContext, useContext } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { PhraseAnalysisLink } from 'interlinearizer';
import type { PhraseMode } from '../types/phrase-mode';

/**
 * The stable, strip-wide context shared by every phrase group and link slot in one render. Both
 * strips build one value per render and wrap their token row in a {@link PhraseStripProvider}.
 */
export type PhraseStripContextValue = Readonly<{
  /** Current phrase-interaction mode; controls rendering and click behavior in all leaves. */
  phraseMode: PhraseMode;
  /** Setter for `phraseMode`; used by phrase boxes to enter edit / confirm-unlink modes. */
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  /** Token list of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseTokens: PhraseAnalysisLink['tokens'] | undefined;
  /** Segment id of the phrase being edited, or `undefined` outside edit mode. */
  editPhraseSegmentId: string | undefined;
  /** Token ref → segment id lookup; used in edit mode to disable cross-segment tokens. */
  tokenSegmentMap: ReadonlyMap<string, string>;
  /** Token ref → flat document index; used to keep merged phrase token lists in document order. */
  tokenDocOrder: ReadonlyMap<string, number>;
  /**
   * Token ref → the committed phrase link containing it, for the whole strip. Used by the
   * cross-segment link icon to resolve the phrase of a token it must reach across a verse-0
   * superscription (which sits between the icon's slot and its real link target).
   */
  phraseLinkByRef: ReadonlyMap<string, PhraseAnalysisLink>;
  /**
   * Called with a phraseId (or `undefined`) when a phrase or a link/unlink candidate is hovered, so
   * the parent can highlight the relevant phrase box and arcs. Merges what used to be two separate
   * callbacks (`onHoverPhrase` / `onHoverCandidatePhrase`) — both strips always passed the same
   * function for them.
   */
  onHoverPhrase: (phraseId: string | undefined) => void;
  /** Called with the candidate token refs (or `undefined`) when a link icon is hovered. */
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
 *
 * @param props - Component props.
 * @param props.value - The strip-wide context value.
 * @param props.children - The strip's token row.
 * @returns The children wrapped in the context provider.
 */
export function PhraseStripProvider({ value, children }: PhraseStripProviderProps) {
  return <PhraseStripContext.Provider value={value}>{children}</PhraseStripContext.Provider>;
}

/**
 * Reads the strip-wide phrase context. Must be called from inside a {@link PhraseStripProvider}.
 *
 * @returns The current {@link PhraseStripContextValue}.
 * @throws If called outside a {@link PhraseStripProvider}.
 */
export function usePhraseStripContext(): PhraseStripContextValue {
  const value = useContext(PhraseStripContext);
  if (value === undefined) {
    throw new Error('usePhraseStripContext must be used within a PhraseStripProvider');
  }
  return value;
}
