import type { SourceText } from '../../hooks/useSourceTextReader';

export const { TEXT_READING_STRING_KEYS } = jest.requireActual('../TextReadingStatus');

/** Stands in for the reading status, exposing the reading state it was handed. */
export default function TextReadingStatus({
  text,
}: Readonly<{ text: Pick<SourceText, 'status' | 'isPartial'> }>) {
  return (
    <p
      data-partial={text.isPartial}
      data-status={text.status}
      data-testid="text-reading-status"
    />
  );
}
