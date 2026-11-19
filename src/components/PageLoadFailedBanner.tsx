import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import type { PageFailure, PageFailureCause } from '../types/segment-pages';

const STRING_KEYS = [
  '%interlinearizer_pageLoad_failed%',
  '%interlinearizer_pageLoad_failedAgain%',
  '%interlinearizer_pageLoad_retrying%',
  '%interlinearizer_pageLoad_cause_text%',
  '%interlinearizer_pageLoad_cause_analysis%',
  '%interlinearizer_pageLoad_cause_app%',
  '%interlinearizer_pageLoad_retry%',
] as const satisfies `%${string}%`[];

const CAUSE_KEYS = {
  text: '%interlinearizer_pageLoad_cause_text%',
  analysis: '%interlinearizer_pageLoad_cause_analysis%',
  app: '%interlinearizer_pageLoad_cause_app%',
} as const satisfies Record<PageFailureCause, (typeof STRING_KEYS)[number]>;

/**
 * A row across a view saying which part of its text could not be loaded and why, with a button that
 * asks for that text again. It takes its own row rather than covering the view, because the text
 * that failed is often not the text in sight.
 */
export default function PageLoadFailedBanner({
  places,
  failure,
  onRetry,
}: Readonly<{
  /** The book and verses that could not be loaded, such as `Joshua 13:18–14:3`. */
  places: string;
  /** How the loading of those verses failed. */
  failure: PageFailure;
  /** Asks again for the text that failed. */
  onRetry: () => void;
}>) {
  const [localizedStrings] = useLocalizedStrings(STRING_KEYS);
  let messageKey: (typeof STRING_KEYS)[number] = '%interlinearizer_pageLoad_failed%';
  if (failure.isRetrying) messageKey = '%interlinearizer_pageLoad_retrying%';
  else if (failure.failedAgain) messageKey = '%interlinearizer_pageLoad_failedAgain%';
  return (
    <div
      className="tw:flex tw:items-center tw:gap-2 tw:border-b tw:border-border tw:bg-muted/40 tw:px-3 tw:py-1.5"
      role="alert"
    >
      <div className="tw:flex tw:min-w-0 tw:flex-col">
        <span className="tw:text-sm tw:text-muted-foreground">
          {formatReplacementString(localizedStrings[messageKey], { places })}
        </span>
        {!failure.isRetrying && (
          <span className="tw:text-xs tw:break-words tw:text-muted-foreground">
            {localizedStrings[CAUSE_KEYS[failure.cause]]}
          </span>
        )}
      </div>
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
