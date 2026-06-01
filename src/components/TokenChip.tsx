import type { Token } from 'interlinearizer';
import { X } from 'lucide-react';
import { memo, type MouseEventHandler, useEffect, useRef, useState } from 'react';
import { useGloss, useGlossDispatch } from './AnalysisStore';

/**
 * Renders a single word token as an inline chip with an editable gloss input below the surface
 * text. Gloss value and dispatch are read from {@link AnalysisStoreProvider} context via
 * {@link useGloss} and {@link useGlossDispatch}. The gloss is written to the store only on blur, and
 * only when the draft differs from the committed value, to avoid creating empty analysis entries on
 * focus/blur cycles with no edits.
 *
 * @param props - Component props
 * @param props.token - The word token to render.
 * @param props.onFocus - Called when the gloss input receives focus.
 * @param props.disabled - When true, the gloss input is read-only and non-interactive.
 * @param props.onRemove - When provided, renders a small ✕ button in the top-right corner of the
 *   chip; clicking it calls this callback to remove the token from its phrase.
 * @param props.isSplitFree - When true, this token would become free (solo) if the currently
 *   hovered split/unlink button were clicked; previewed with a destructive border on the chip.
 * @returns A styled label containing the surface text and a gloss input.
 */
export function TokenChip({
  token,
  onFocus,
  disabled = false,
  onRemove,
  isSplitFree = false,
}: Readonly<{
  token: Token & { type: 'word' };
  onFocus: () => void;
  disabled?: boolean;
  onRemove?: () => void;
  isSplitFree?: boolean;
}>) {
  const committedGloss = useGloss(token.ref);
  const onGlossChange = useGlossDispatch();
  const [draft, setDraft] = useState(committedGloss);
  // Tracks whether the X button itself is hovered, so only that button hover reddens the border.
  const [isRemoveHovered, setIsRemoveHovered] = useState(false);
  // Reset remove-hover state when onRemove is cleared so the red border doesn't linger.
  const prevOnRemoveRef = useRef(onRemove);
  useEffect(() => {
    if (prevOnRemoveRef.current !== onRemove) {
      prevOnRemoveRef.current = onRemove;
      if (!onRemove && isRemoveHovered) setIsRemoveHovered(false);
    }
  }, [onRemove, isRemoveHovered]);

  // Keep local draft in sync when the committed value changes externally (e.g. project switch).
  useEffect(() => {
    setDraft(committedGloss);
  }, [committedGloss]);

  const handleMouseDown: MouseEventHandler<HTMLInputElement> = (e) => {
    // Prevent the browser's built-in focus-and-scroll so only the React-controlled
    // smooth scrollIntoView fires. We re-focus manually with preventScroll instead.
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
  };

  // The X button is positioned outside the <label> so its implicit labeled control stays the gloss
  // input, not the button. Otherwise clicking anywhere on the chip (label-association behavior)
  // would trigger the X button instead of focusing the input.
  return (
    <span className="tw:relative tw:inline-flex tw:shrink-0">
      {onRemove && (
        <button
          aria-label={`Remove ${token.surfaceText} from phrase`}
          className={`tw:absolute tw:-top-1.5 tw:-right-1.5 tw:z-10 tw:flex tw:h-3.5 tw:w-3.5 tw:items-center tw:justify-center tw:rounded-full tw:border tw:bg-background${isRemoveHovered ? ' tw:border-destructive tw:text-destructive' : ' tw:border-border tw:text-muted-foreground'}`}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onRemove();
          }}
          onMouseEnter={() => setIsRemoveHovered(true)}
          onMouseLeave={() => setIsRemoveHovered(false)}
        >
          <X className="tw:h-2.5 tw:w-2.5" />
        </button>
      )}
      <label
        className={`tw:inline-flex tw:flex-col tw:items-center tw:rounded tw:border tw:bg-muted tw:px-1.5 tw:py-0.5${isRemoveHovered || isSplitFree ? ' tw:border-destructive' : ' tw:border-border'}${disabled ? ' tw:pointer-events-none' : ''}`}
      >
        <span className="tw:whitespace-nowrap tw:font-mono tw:text-sm tw:text-foreground tw:cursor-text">
          {token.surfaceText}
        </span>
        <input
          aria-label={`Gloss for ${token.surfaceText}`}
          className="tw:mt-0.5 tw:rounded tw:border tw:border-border tw:bg-background tw:px-1 tw:text-center tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-ring tw:focus:ring-1 tw:focus:ring-ring tw:disabled:opacity-50 tw:disabled:cursor-default"
          disabled={disabled}
          placeholder="gloss"
          style={{ fieldSizing: 'content', minWidth: '5ch' }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (!disabled && draft !== committedGloss)
              onGlossChange(token.ref, token.surfaceText, draft);
          }}
          onFocus={disabled ? undefined : onFocus}
          onMouseDown={disabled ? undefined : handleMouseDown}
          type="text"
        />
      </label>
    </span>
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
    <span className="tw:inline-block tw:font-mono tw:text-sm tw:text-muted-foreground tw:pt-0.5">
      {token.surfaceText}
    </span>
  );
}

/** Memoized version of {@link TokenChip}; use in render-stable token lists. */
const MemoizedTokenChip = memo(TokenChip);
export default MemoizedTokenChip;

/** Memoized version of {@link InertTokenChip}; use in render-stable token lists. */
export const MemoizedInertTokenChip = memo(InertTokenChip);
