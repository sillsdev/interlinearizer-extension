import type { Token } from 'interlinearizer';
import { memo, useEffect, useState } from 'react';
import { useGloss, useGlossDispatch } from './AnalysisStore';

/**
 * Renders a single word token as an inline chip with an editable gloss input below the surface
 * text. Gloss value and dispatch are read from {@link AnalysisStoreProvider} context via
 * {@link useGloss} and {@link useGlossDispatch}. The gloss is written to the store only on blur to
 * avoid creating a new analysis entry on every keystroke.
 *
 * @param props - Component props
 * @param props.token - The word token to render.
 * @param props.onFocus - Called when the gloss input receives focus.
 * @returns A styled label containing the surface text and a gloss input.
 */
export function TokenChip({
  token,
  onFocus,
}: Readonly<{ token: Token & { type: 'word' }; onFocus: () => void }>) {
  const committedGloss = useGloss(token.ref);
  const onGlossChange = useGlossDispatch();
  const [draft, setDraft] = useState(committedGloss);

  // Keep local draft in sync when the committed value changes externally (e.g. project switch).
  useEffect(() => {
    setDraft(committedGloss);
  }, [committedGloss]);

  return (
    <label className="tw:inline-flex tw:shrink-0 tw:flex-col tw:items-center tw:rounded tw:border tw:border-border tw:bg-muted tw:px-1.5 tw:py-0.5">
      <span className="tw:whitespace-nowrap tw:font-mono tw:text-sm tw:text-foreground tw:cursor-text">
        {token.surfaceText}
      </span>
      <input
        aria-label={`Gloss for ${token.surfaceText}`}
        className="tw:mt-0.5 tw:rounded tw:border tw:border-border tw:bg-background tw:px-1 tw:text-center tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-ring tw:focus:ring-1 tw:focus:ring-ring"
        style={{ fieldSizing: 'content', minWidth: '5ch' }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onGlossChange(token.ref, token.surfaceText, draft)}
        onFocus={onFocus}
        type="text"
      />
    </label>
  );
}

/**
 * Renders a non-word token (e.g. punctuation) as muted inline monospace text with no gloss input.
 *
 * @param props - Component props
 * @param props.token - The non-word token to render.
 * @returns A muted inline span.
 */
export function InertTokenChip({ token }: Readonly<{ token: Token }>) {
  return (
    <span className="tw:inline-block tw:font-mono tw:text-sm tw:text-muted-foreground">
      {token.surfaceText}
    </span>
  );
}

/** Memoized version of {@link TokenChip}; use in render-stable token lists. */
const MemoizedTokenChip = memo(TokenChip);
export default MemoizedTokenChip;

/** Memoized version of {@link InertTokenChip}; use in render-stable token lists. */
export const MemoizedInertTokenChip = memo(InertTokenChip);
