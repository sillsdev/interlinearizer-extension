import { EmptyState, Spinner } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import type { ConcordanceIndex } from '../hooks/useConcordanceIndex';

/** Localized string keys {@link TextReadingStatus} renders. */
export const TEXT_READING_STRING_KEYS = [
  '%interlinearizer_concordance_loading%',
  '%interlinearizer_concordance_error%',
] as const satisfies `%${string}%`[];

/** Props for {@link TextReadingStatus}. */
type TextReadingStatusProps = Readonly<{
  index: Pick<ConcordanceIndex, 'status' | 'isPartial' | 'booksRead' | 'bookCount'>;
  /** Prefixes the `-loading` and `-error` test ids the status is found by. */
  idPrefix: string;
  /** Resolved localizations covering at least {@link TEXT_READING_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/** How far reading the source text has got, or that it could not be read. */
export default function TextReadingStatus({
  index,
  idPrefix,
  localizedStrings,
}: TextReadingStatusProps) {
  if (index.status === 'error' || index.isPartial) {
    return (
      <EmptyState
        className="tw:px-3 tw:py-2"
        id={`${idPrefix}-error`}
        message={localizedStrings['%interlinearizer_concordance_error%']}
      />
    );
  }
  return (
    <p
      className="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:text-sm tw:text-muted-foreground"
      data-testid={`${idPrefix}-loading`}
      role="status"
    >
      <Spinner className="tw:size-4" />
      {formatReplacementString(localizedStrings['%interlinearizer_concordance_loading%'], {
        read: index.booksRead,
        total: index.bookCount,
      })}
    </p>
  );
}
