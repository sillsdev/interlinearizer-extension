import { isMacOs, Kbd } from 'platform-bible-react';
import { formatReplacementStringToArray } from 'platform-bible-utils';
import { Fragment, type ReactNode } from 'react';

/**
 * The glyph macOS prints on the Alt key, which the platform's keyboard-shortcuts guideline prefers
 * over the word on a shortcut chip. A symbol, so it stands outside localization.
 */
const MAC_KEY_SYMBOL = '⌥';

/** Not a localize key: the platform's key-name localization reaches Backspace and Delete alone. */
const ALT_KEY_WORD = 'Alt';

/**
 * Fills a hint's `{key}` placeholder with the host OS's own way of showing the Alt key, set apart
 * from the sentence as a key to press. A hint still awaiting localization carries no placeholder
 * and comes back as its own bare text.
 *
 * @returns The hint's text and the key's `Kbd`, in reading order.
 */
export function altKeyHint(hint: string): ReactNode[] {
  return formatReplacementStringToArray(hint, {
    key: <Kbd>{isMacOs() ? MAC_KEY_SYMBOL : ALT_KEY_WORD}</Kbd>,
  }).map((part, index) => (
    // The parts are positional, and the array is rebuilt whenever the hint changes.
    // eslint-disable-next-line react/no-array-index-key
    <Fragment key={index}>{part}</Fragment>
  ));
}
