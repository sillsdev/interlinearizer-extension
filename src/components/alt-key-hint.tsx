import { isMacOs, Kbd } from 'platform-bible-react';
import { Fragment, type ReactNode } from 'react';
import { formatTemplateToArray } from '../utils/format-template';

/**
 * The glyph macOS prints on the Alt key, which the platform's keyboard-shortcuts guideline prefers
 * over the word on a shortcut chip. A symbol, so it stands outside localization.
 */
const MAC_KEY_SYMBOL = '⌥';

/** Not a localize key: the platform's key-name localization reaches Backspace and Delete alone. */
const ALT_KEY_WORD = 'Alt';

/**
 * Fills a hint's `{key}` placeholder with the host OS's own way of showing the Alt key, set apart
 * from the sentence as a key to press. A hint carrying no placeholder comes back as its own text,
 * so an empty one yields nothing at all.
 *
 * The hint arrives as one node, so a flex container lays the sentence out as a single inline run
 * with the key sitting in the flow of the words rather than as a column beside them.
 *
 * @returns One node carrying the whole hint, or nothing at all for an empty hint, so a caller can
 *   leave an empty tooltip unmounted.
 */
export function altKeyHint(hint: string): ReactNode[] {
  if (hint.length === 0) return [];
  return [
    <span key="hint">
      {formatTemplateToArray(hint, {
        key: <Kbd>{isMacOs() ? MAC_KEY_SYMBOL : ALT_KEY_WORD}</Kbd>,
      }).map((part, index) => (
        // The parts are positional, and the array is rebuilt whenever the hint changes.
        // eslint-disable-next-line react/no-array-index-key
        <Fragment key={index}>{part}</Fragment>
      ))}
    </span>,
  ];
}

/**
 * Tooltip content that reads as {@link altKeyHint}'s rendering of `hint` while Alt is up and as
 * `heldLabel` while Alt is held. An empty string contributes nothing.
 */
export function altHeldSwap(hint: string, heldLabel: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const up = altKeyHint(hint);
  if (up.length > 0)
    nodes.push(
      <span key="up" className="tw:alt-held:hidden">
        {up}
      </span>,
    );
  if (heldLabel.length > 0)
    nodes.push(
      <span key="held" className="tw:hidden tw:alt-held:inline">
        {heldLabel}
      </span>,
    );
  return nodes;
}
