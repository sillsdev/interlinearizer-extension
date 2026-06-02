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
