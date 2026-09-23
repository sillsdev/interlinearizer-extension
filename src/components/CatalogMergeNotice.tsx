import { X } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';

/** Localized string keys the merge notice renders. */
export const MERGE_NOTICE_STRING_KEYS = [
  '%interlinearizer_analysisCatalog_merged%',
  '%interlinearizer_analysisCatalog_mergedNoGloss%',
  '%interlinearizer_analysisCatalog_mergedDismiss%',
  '%interlinearizer_analysisCatalog_draftStranded%',
] as const satisfies `%${string}%`[];

/** What a merge-on-edit left standing, for the notice to name. */
export interface MergeNotice {
  /** The surviving analysis's id, which the listing scrolls to. */
  survivingAnalysisId: string;
  /** What the survivor reads as, `''` when it carries no gloss in the active language. */
  survivingGloss: string;
  /** The survivor's surface form, named in place of the gloss when it has none. */
  surfaceText: string;
  /** The survivor's usage count once the collapsed record's tokens joined it. */
  usageCount: number;
}

/**
 * A breakdown draft whose analysis was removed by an edit made outside the panel, for the notice to
 * report. Carries the form rather than the id, the record it was keyed to being gone.
 */
export interface StrandedDraftNotice {
  /** The removed analysis's surface form, which the notice names it by. */
  surfaceText: string;
}

/** Props for {@link CatalogMergeNotice}. */
type CatalogMergeNoticeProps = Readonly<{
  notice: MergeNotice;
  /** Dismisses the notice. */
  onDismiss: () => void;
  /** Resolved localizations covering at least {@link MERGE_NOTICE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>;

/** Props for {@link NoticeBanner}. */
type NoticeBannerProps = Readonly<{
  message: string;
  /** Dismisses the notice. */
  onDismiss: () => void;
  /** Accessible name of the dismiss control. */
  dismissLabel: string;
  testId: string;
}>;

/**
 * The banner every catalog notice is shown in: a dismissable strip above the listing, announced
 * after the edit it explains rather than interrupting the field the reader is still in.
 */
function NoticeBanner({ message, onDismiss, dismissLabel, testId }: NoticeBannerProps) {
  return (
    <div
      aria-live="polite"
      className="tw:flex tw:items-center tw:gap-2 tw:border-b tw:border-border tw:bg-accent/50 tw:px-3 tw:py-2"
      data-testid={testId}
    >
      <p className="tw:flex-1 tw:min-w-0 tw:text-xs">{message}</p>
      <Button
        aria-label={dismissLabel}
        data-testid={`${testId}-dismiss`}
        onClick={onDismiss}
        size="icon"
        variant="ghost"
      >
        <X className="tw:size-3" />
      </Button>
    </div>
  );
}

/**
 * Reports that an edit made outside the panel removed the analysis a breakdown draft was keyed to,
 * taking the draft with it.
 *
 * Reports the loss rather than offering to restore it: nothing else on screen would say where the
 * work the reader was typing went, and there is no record left to save it against.
 */
export function CatalogStrandedDraftNotice({
  notice,
  onDismiss,
  localizedStrings,
}: Readonly<{
  notice: StrandedDraftNotice;
  /** Dismisses the notice. */
  onDismiss: () => void;
  /** Resolved localizations covering at least {@link MERGE_NOTICE_STRING_KEYS}. */
  localizedStrings: LanguageStrings;
}>) {
  return (
    <NoticeBanner
      dismissLabel={localizedStrings['%interlinearizer_analysisCatalog_mergedDismiss%']}
      message={formatReplacementString(
        localizedStrings['%interlinearizer_analysisCatalog_draftStranded%'],
        { form: notice.surfaceText },
      )}
      onDismiss={onDismiss}
      testId="catalog-stranded-draft-notice"
    />
  );
}

/**
 * Reports that an edit collapsed one row into another, naming where the edit went and what the
 * surviving row now counts.
 *
 * Without this the row the reader was editing simply disappears while an unrelated row's count
 * jumps, which reads as data loss rather than as the convergence it is. It persists until dismissed
 * or superseded rather than fading, because the reader may be looking anywhere in the list when
 * their edit commits.
 *
 * Reaches a screen reader after the edit it explains rather than interrupting the field the reader
 * is still in.
 */
export default function CatalogMergeNotice({
  notice,
  onDismiss,
  localizedStrings,
}: CatalogMergeNoticeProps) {
  const { survivingGloss, surfaceText, usageCount } = notice;

  // Named by its gloss where it has one, since that is what the reader was editing toward; by its
  // form otherwise, a notice that named neither leaving nothing to recognize the row by.
  const message = survivingGloss
    ? formatReplacementString(localizedStrings['%interlinearizer_analysisCatalog_merged%'], {
        gloss: survivingGloss,
        count: usageCount,
      })
    : formatReplacementString(localizedStrings['%interlinearizer_analysisCatalog_mergedNoGloss%'], {
        form: surfaceText,
        count: usageCount,
      });

  return (
    <NoticeBanner
      dismissLabel={localizedStrings['%interlinearizer_analysisCatalog_mergedDismiss%']}
      message={message}
      onDismiss={onDismiss}
      testId="catalog-merge-notice"
    />
  );
}
