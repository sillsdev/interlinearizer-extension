/** @file Shared phrase-box wrapper used around word tokens. */
import type { Token } from 'interlinearizer';
import TokenChip from './TokenChip';

/**
 * Wraps one or more tokens in a phrase-level visual container. When used inside
 * {@link ContinuousView}, focus styling is applied via a `data-focused` attribute on the parent span
 * rather than through this component, so that the visual update is synchronous and independent of
 * React's render cycle.
 *
 * @param props - Component props
 * @param props.onClick - Optional click handler; when provided the box renders as a button
 * @param props.tokens - Tokens belonging to this phrase
 * @returns A bordered inline container
 */
export default function PhraseBox({
  onClick,
  tokens,
}: Readonly<{
  onClick?: () => void;
  tokens: Token[];
}>) {
  const baseClass =
    'tw-inline-flex tw-items-center tw-rounded tw-border-2 tw-border-border/40 tw-bg-muted/20 tw-px-1 tw-py-0.5';
  const innerContent = (
    <span className="tw-inline-flex tw-items-center tw-gap-1">
      {tokens.map((token) => (
        <TokenChip key={token.id} token={token} />
      ))}
    </span>
  );

  if (onClick) {
    return (
      <button
        className={`${baseClass} tw-cursor-pointer tw-text-left tw-outline-none hover:tw-bg-muted/30 focus-visible:tw-outline-none`}
        data-phrase-box="true"
        onClick={onClick}
        type="button"
      >
        {innerContent}
      </button>
    );
  }

  return (
    <span className={baseClass} data-phrase-box="true">
      {innerContent}
    </span>
  );
}
