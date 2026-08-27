import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { formatReplacementString } from 'platform-bible-utils';
import type { Pt9ClusterDropReason, Pt9ImportReport } from '../../converters/pt9';
import { ModalShell } from './ModalShell';

/** Localized string keys requested for this modal's rendered text. */
const PT9_IMPORT_MODAL_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_pt9ImportModal_title%',
  '%interlinearizer_pt9ImportModal_syncTitle%',
  '%interlinearizer_pt9ImportModal_importing%',
  '%interlinearizer_pt9ImportModal_syncing%',
  '%interlinearizer_pt9ImportModal_failed%',
  '%interlinearizer_pt9ImportModal_tooLarge%',
  '%interlinearizer_pt9ImportModal_languages_label%',
  '%interlinearizer_pt9ImportModal_books_label%',
  '%interlinearizer_pt9ImportModal_imported_label%',
  '%interlinearizer_pt9ImportModal_importedCounts%',
  '%interlinearizer_pt9ImportModal_phraseCounts%',
  '%interlinearizer_pt9ImportModal_notImported_label%',
  '%interlinearizer_pt9ImportModal_notImportedCount%',
  '%interlinearizer_pt9ImportModal_reason_verseNotFound%',
  '%interlinearizer_pt9ImportModal_reason_formMismatch%',
  '%interlinearizer_pt9ImportModal_reason_lemmaOrOther%',
  '%interlinearizer_pt9ImportModal_reason_duplicateCluster%',
  '%interlinearizer_pt9ImportModal_reason_unparseableLexemeId%',
  '%interlinearizer_pt9ImportModal_missingBooks%',
  '%interlinearizer_pt9ImportModal_open%',
  '%interlinearizer_pt9ImportModal_close%',
];

/**
 * What the import modal currently shows: the run in progress, its report, or its failure. A
 * `tooLarge` failure reason swaps the generic failure line for the message that the source
 * project's interlinear data exceeds what an import can currently handle.
 */
export type Pt9ImportModalPhase =
  | { kind: 'running' }
  | { kind: 'report'; report: Pt9ImportReport }
  | { kind: 'error'; reason?: 'tooLarge' };

/** Every drop reason, for typed iteration over a book report's `clusterDrops`. */
const DROP_REASONS: readonly Pt9ClusterDropReason[] = [
  'verseNotFound',
  'formMismatch',
  'lemmaOrOther',
  'duplicateCluster',
  'unparseableLexemeId',
];

/** The counts and lists the report summary renders, folded from the per-language reports. */
type ReportTotals = {
  languages: string[];
  books: string[];
  missingBooks: string[];
  clustersTotal: number;
  clustersConverted: number;
  phrasesConverted: number;
  drops: { reason: Pt9ClusterDropReason; count: number }[];
};

/** Folds the per-language, per-book report into the totals the summary shows. */
function foldReport(report: Pt9ImportReport): ReportTotals {
  const books: string[] = [];
  const missingBooks: string[] = [];
  let clustersTotal = 0;
  let clustersConverted = 0;
  let phrasesConverted = 0;
  const dropCounts = new Map<Pt9ClusterDropReason, number>();
  report.languages.forEach((language) => {
    language.books.forEach((book) => {
      if (!books.includes(book.bookId)) books.push(book.bookId);
      if (!book.bookFound && !missingBooks.includes(book.bookId)) missingBooks.push(book.bookId);
      clustersTotal += book.clustersTotal;
      clustersConverted += book.clustersConverted;
      phrasesConverted += book.phrasesConverted;
      DROP_REASONS.forEach((reason) => {
        const count = book.clusterDrops[reason];
        if (count > 0) dropCounts.set(reason, (dropCounts.get(reason) ?? 0) + count);
      });
    });
  });
  const drops = [...dropCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  return {
    languages: report.languages.map((language) => language.tag),
    books,
    missingBooks,
    clustersTotal,
    clustersConverted,
    phrasesConverted,
    drops,
  };
}

/** One labeled row of the report summary. */
function ReportRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <p className="tw:text-sm">
      <span className="tw:font-medium">{label}: </span>
      <span className="tw:text-muted-foreground">{value}</span>
    </p>
  );
}

/**
 * The modal shown while Paratext 9 interlinear data imports or syncs, and afterward: a running
 * phase (not dismissable - the run is in flight), then either the report summary or a failure line.
 * The caller owns the run itself and feeds the phase in.
 *
 * @param props.phase - What to show: the run in progress, its report, or its failure.
 * @param props.mode - `import` titles the modal as an import and offers Open on the report; `sync`
 *   titles it as a sync and offers only Close (the project is already open).
 * @param props.onOpen - Called when the user opens the imported project from the report; only
 *   rendered in `import` mode.
 * @param props.onClose - Called when the user dismisses the report or failure.
 */
export function Pt9ImportModal({
  phase,
  mode,
  onOpen,
  onClose,
}: Readonly<{
  phase: Pt9ImportModalPhase;
  mode: 'import' | 'sync';
  onOpen?: () => void;
  onClose: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(PT9_IMPORT_MODAL_STRING_KEYS);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const title =
    mode === 'import'
      ? localizedStrings['%interlinearizer_pt9ImportModal_title%']
      : localizedStrings['%interlinearizer_pt9ImportModal_syncTitle%'];

  if (phase.kind === 'running') {
    return (
      <ModalShell titleTestId="pt9-import-modal-title" title={title} width="tw:w-96">
        <p className="tw:text-sm tw:text-muted-foreground" data-testid="pt9-import-running">
          {mode === 'import'
            ? localizedStrings['%interlinearizer_pt9ImportModal_importing%']
            : localizedStrings['%interlinearizer_pt9ImportModal_syncing%']}
        </p>
      </ModalShell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <ModalShell
        titleTestId="pt9-import-modal-title"
        title={title}
        width="tw:w-96"
        onClose={onClose}
      >
        <p className="tw:text-sm tw:text-destructive" data-testid="pt9-import-error">
          {phase.reason === 'tooLarge'
            ? localizedStrings['%interlinearizer_pt9ImportModal_tooLarge%']
            : localizedStrings['%interlinearizer_pt9ImportModal_failed%']}
        </p>
        <div className="tw:modal-actions tw:mt-4">
          <Button onClick={onClose}>
            {localizedStrings['%interlinearizer_pt9ImportModal_close%']}
          </Button>
        </div>
      </ModalShell>
    );
  }

  const totals = foldReport(phase.report);
  const dropTotal = totals.drops.reduce((sum, drop) => sum + drop.count, 0);
  // Plain-word labels for the dominant reasons; the full per-reason detail stays in the command's
  // JSON report for logs.
  const reasonText = totals.drops
    .slice(0, 2)
    .map(
      (drop) =>
        `${drop.count} ${localizedStrings[`%interlinearizer_pt9ImportModal_reason_${drop.reason}%`]}`,
    )
    .join('; ');

  return (
    <ModalShell
      titleTestId="pt9-import-modal-title"
      title={title}
      width="tw:w-96"
      onClose={onClose}
    >
      <div className="tw:flex tw:flex-col tw:gap-1" data-testid="pt9-import-report">
        <ReportRow
          label={localizedStrings['%interlinearizer_pt9ImportModal_languages_label%']}
          value={totals.languages.join(', ')}
        />
        <ReportRow
          label={localizedStrings['%interlinearizer_pt9ImportModal_books_label%']}
          value={totals.books.join(', ')}
        />
        <ReportRow
          label={localizedStrings['%interlinearizer_pt9ImportModal_imported_label%']}
          value={`${formatReplacementString(
            localizedStrings['%interlinearizer_pt9ImportModal_importedCounts%'],
            { converted: String(totals.clustersConverted), total: String(totals.clustersTotal) },
          )}${
            totals.phrasesConverted > 0
              ? `, ${formatReplacementString(
                  localizedStrings['%interlinearizer_pt9ImportModal_phraseCounts%'],
                  { phrases: String(totals.phrasesConverted) },
                )}`
              : ''
          }`}
        />
        {dropTotal > 0 && (
          <ReportRow
            label={localizedStrings['%interlinearizer_pt9ImportModal_notImported_label%']}
            value={formatReplacementString(
              localizedStrings['%interlinearizer_pt9ImportModal_notImportedCount%'],
              { count: String(dropTotal), reasons: reasonText },
            )}
          />
        )}
        {totals.missingBooks.length > 0 && (
          <p className="tw:text-sm tw:text-muted-foreground">
            {formatReplacementString(
              localizedStrings['%interlinearizer_pt9ImportModal_missingBooks%'],
              { books: totals.missingBooks.join(', ') },
            )}
          </p>
        )}
      </div>
      <div className="tw:modal-actions tw:mt-4">
        {mode === 'import' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {localizedStrings['%interlinearizer_pt9ImportModal_close%']}
            </Button>
            <Button onClick={onOpen}>
              {localizedStrings['%interlinearizer_pt9ImportModal_open%']}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>
            {localizedStrings['%interlinearizer_pt9ImportModal_close%']}
          </Button>
        )}
      </div>
    </ModalShell>
  );
}
