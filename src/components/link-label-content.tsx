import { formatReplacementStringToArray } from 'platform-bible-utils';
import { Fragment, type ReactNode } from 'react';

/**
 * Fills a link label's `{phrase}` placeholder with the selection set in bold, so a glance at the
 * tooltip tells the reader which words a click would join to rather than making them find them in
 * the sentence. A label carrying no placeholder comes back as its own text.
 *
 * The label arrives as one node, so it lays out as a single run of text with the phrase sitting in
 * the flow of the words around it.
 *
 * @returns One node carrying the whole label.
 */
export function linkLabelContent(label: string, phrase: string): ReactNode[] {
  return [
    <span key="label">
      {formatReplacementStringToArray(label, {
        phrase: <strong className="tw:font-semibold">{phrase}</strong>,
      }).map((part, index) => (
        // The parts are positional, and the array is rebuilt whenever the label changes.
        // eslint-disable-next-line react/no-array-index-key
        <Fragment key={index}>{part}</Fragment>
      ))}
    </span>,
  ];
}
