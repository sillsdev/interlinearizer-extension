import type { ConcordanceIndex } from '../../hooks/useConcordanceIndex';

export const { TEXT_READING_STRING_KEYS } = jest.requireActual('../TextReadingStatus');

/** Stands in for the reading status, exposing the index state it was handed. */
export default function TextReadingStatus({
  index,
}: Readonly<{ index: Pick<ConcordanceIndex, 'status' | 'booksRead' | 'bookCount'> }>) {
  return (
    <p data-status={index.status} data-testid="text-reading-status">
      {`${index.booksRead} of ${index.bookCount}`}
    </p>
  );
}
