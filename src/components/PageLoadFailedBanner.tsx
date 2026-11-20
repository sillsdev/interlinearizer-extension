import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import type { PageFailure } from '../types/segment-pages';

const STRING_KEYS = [
  '%interlinearizer_pageLoad_failed%',
  '%interlinearizer_pageLoad_retrying%',
  '%interlinearizer_pageLoad_retry%',
] as const satisfies `%${string}%`[];

/**
 * A row across a view saying which part of its text could not be loaded, with a button that asks
 * for that text again. It takes its own row rather than covering the view, because the text that
 * failed is often not the text in sight.
 */
export default function PageLoadFailedBanner({
  places,
  failure,
  onRetry,
}: Readonly<{
  /** The book and verses that could not be loaded, such as `Joshua 13:18–14:3`. */
  places: string;
  /** Where the loading of those verses stands. */
  failure: PageFailure;
  /** Asks again for the text that failed. */
  onRetry: () => void;
}>) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  const messageKey = failure.isRetrying
    ? '%interlinearizer_pageLoad_retrying%'
    : '%interlinearizer_pageLoad_failed%';
  return (
    <div
      className="tw:flex tw:items-center tw:gap-2 tw:border-b tw:border-border tw:bg-muted/40 tw:px-3 tw:py-1.5"
      role="alert"
    >
      <span className="tw:min-w-0 tw:text-sm tw:text-muted-foreground">
        {formatReplacementString(localizedStrings[messageKey], { places })}
      </span>
      <Button
        className="tw:ml-auto"
        disabled={failure.isRetrying}
        onClick={onRetry}
        size="sm"
        variant="secondary"
      >
        {localizedStrings['%interlinearizer_pageLoad_retry%']}
      </Button>
    </div>
  );
}
