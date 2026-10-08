import { EmptyState, Spinner } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import type { SourceText } from '../hooks/useSourceTextReader';

/** Localized string keys {@link TextReadingStatus} renders. */
export const TEXT_READING_STRING_KEYS = [
  '%interlinearizer_textReading_loading%',
  '%interlinearizer_textReading_error%',
] as const satisfies `%${string}%`[];

/** Props for {@link TextReadingStatus}. */
type TextReadingStatusProps = Readonly<{
  text: Pick<SourceText, 'status' | 'isPartial' | 'booksRead' | 'bookCount'>;
  /** Prefixes the `-loading` and `-error` test ids the status is found by. */
  idPrefix: string;
  /** Resolved localizations covering at least {@link TEXT_READING_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/** How far reading the source text has got, or that it could not be read. */
export default function TextReadingStatus({
  text,
  idPrefix,
  localizedStrings,
}: TextReadingStatusProps) {
  if (text.status === 'error' || text.isPartial) {
    return (
      <EmptyState
        className="tw:px-3 tw:py-2"
        id={`${idPrefix}-error`}
        message={localizedStrings['%interlinearizer_textReading_error%']}
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
      {formatReplacementString(localizedStrings['%interlinearizer_textReading_loading%'], {
        read: text.booksRead,
        total: text.bookCount,
      })}
    </p>
  );
}
