import type { TextReadStatus } from '../../types/text-read-status';

export const { TEXT_READING_STRING_KEYS } = jest.requireActual('../TextReadingStatus');

/** Stands in for the reading status, exposing the reading state it was handed. */
export default function TextReadingStatus({
  status,
}: Readonly<{ status: TextReadStatus | 'error' | undefined }>) {
  return (
    <p
      data-partial={status !== undefined && status !== 'error' && status.failedBookIds.length > 0}
      data-status={status === 'error' ? 'error' : 'loading'}
      data-testid="text-reading-status"
    />
  );
}
