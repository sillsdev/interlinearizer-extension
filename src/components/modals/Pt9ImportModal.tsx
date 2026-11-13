import { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Canon } from '@sillsdev/scripture';
import { Button } from 'platform-bible-react';
import { useEffect, useMemo, useState } from 'react';
import { formatReplacementString, type LanguageStrings } from 'platform-bible-utils';
import {
  PT9_CLUSTER_DROP_REASONS,
  type Pt9ClusterDrop,
  type Pt9ClusterDropReason,
  type Pt9ImportReport,
  type Pt9UnreadableFile,
} from '../../converters/pt9';
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
  '%interlinearizer_pt9ImportModal_reason_parseFormMismatch%',
  '%interlinearizer_pt9ImportModal_reason_frontMatter%',
  '%interlinearizer_pt9ImportModal_reason_lemmaOrOther%',
  '%interlinearizer_pt9ImportModal_reason_duplicateCluster%',
  '%interlinearizer_pt9ImportModal_reason_unparseableLexemeId%',
  '%interlinearizer_pt9ImportModal_reason_blankMorphemeForm%',
  '%interlinearizer_pt9ImportModal_showDrops%',
  '%interlinearizer_pt9ImportModal_moreDrops%',
  '%interlinearizer_pt9ImportModal_copyDrops%',
  '%interlinearizer_pt9ImportModal_dropsCopied%',
  '%interlinearizer_pt9ImportModal_copyFailed%',
  '%interlinearizer_pt9ImportModal_dropLine%',
  '%interlinearizer_pt9ImportModal_missingBooks%',
  '%interlinearizer_pt9ImportModal_filesTooLarge%',
  '%interlinearizer_pt9ImportModal_filesNeverLoaded%',
  '%interlinearizer_pt9ImportModal_staleKept%',
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
  /** Nothing was persisted and the stored import was kept. */
  | ({ kind: 'staleKept' } & LeftOutFiles)
  /** A first import converted nothing, so no import was created. */
  | ({ kind: 'notConverted' } & LeftOutFiles)
  | { kind: 'error'; reason?: 'tooLarge' };

/** The files that a run left out. */
export interface LeftOutFiles {
  /** Files too large for any read to take on. */
  filesTooLarge: Pt9UnreadableFile[];
  /** Files Paratext 9 never loads from where they are. */
  filesNeverLoaded: string[];
}

/**
 * The counts and lists the report summary renders, folded from the per-language reports.
 *
 * TODO: fold and render `report.senses` when the lexicon resolver is completed (#280).
 */
type ReportTotals = {
  languages: string[];
  books: string[];
  missingBooks: string[];
  clustersTotal: number;
  clustersConverted: number;
  phrasesConverted: number;
  drops: { reason: Pt9ClusterDropReason; count: number }[];
  /** Every dropped cluster, paired with the tag of the gloss language it was in. */
  droppedClusters: (Pt9ClusterDrop & { language: string })[];
};

/** Orders book ids canonically. */
function compareBookIds(a: string, b: string): number {
  return Canon.bookIdToNumber(a) - Canon.bookIdToNumber(b);
}

/**
 * Orders dropped clusters canonically by their verse key, then by language. A verse such as `2-3`
 * or `2a` sorts by its leading number. A chapter or verse with no ASCII leading number, such as the
 * Devanagari `२`, sorts after every number.
 */
function compareDroppedClusters(
  a: ReportTotals['droppedClusters'][number],
  b: ReportTotals['droppedClusters'][number],
): number {
  const place = ({ verseRef }: Pt9ClusterDrop) => {
    const [bookId, chapterVerse = ''] = verseRef.split(' ');
    const [chapter, verse = ''] = chapterVerse.split(':');
    return [
      Canon.bookIdToNumber(bookId),
      Number.parseInt(chapter, 10),
      Number.parseInt(verse, 10),
    ].map((part) => (Number.isNaN(part) ? Infinity : part));
  };
  const placeA = place(a);
  const placeB = place(b);
  const differing = placeA.findIndex((part, i) => part !== placeB[i]);
  if (differing >= 0) return placeA[differing] < placeB[differing] ? -1 : 1;
  return a.language.localeCompare(b.language);
}

/** Orders files by the book each declares, canonically, with files declaring none last. */
function compareUnreadableFiles(a: Pt9UnreadableFile, b: Pt9UnreadableFile): number {
  const bookNumber = (file: Pt9UnreadableFile) =>
    file.bookId === undefined ? Number.MAX_SAFE_INTEGER : Canon.bookIdToNumber(file.bookId);
  return bookNumber(a) - bookNumber(b);
}

/**
 * Renders a byte count in mebibytes, the unit the platform's read ceiling is set in, so the size
 * and the limit beside it are read off the same scale. Whole values carry no decimal.
 */
function describeMebibytes(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return `${Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)} MiB`;
}

/**
 * Names a file the import could not retrieve and states its size. A book id is not unique on its
 * own - one book can appear once per gloss language - so it is paired with the language, and a file
 * that declares neither is named by its path.
 */
function describeUnreadableFile(file: Pt9UnreadableFile): string {
  const name =
    // eslint-disable-next-line no-nested-ternary
    file.bookId === undefined
      ? file.path
      : file.glossLanguage === undefined
        ? file.bookId
        : `${file.bookId} (${file.glossLanguage})`;
  return `${name} ${describeMebibytes(file.sizeBytes)}`;
}

/** One line for each nonempty list of files that a run left out. */
function LeftOutFileLines({
  filesTooLarge,
  filesNeverLoaded,
  localizedStrings,
}: Readonly<LeftOutFiles & { localizedStrings: LanguageStrings }>) {
  return (
    <>
      {filesNeverLoaded.length > 0 && (
        <p className="tw:text-sm tw:text-muted-foreground" data-testid="pt9-files-never-loaded">
          {formatReplacementString(
            localizedStrings['%interlinearizer_pt9ImportModal_filesNeverLoaded%'],
            { files: filesNeverLoaded.join(', ') },
          )}
        </p>
      )}
      {filesTooLarge.length > 0 && (
        <p className="tw:text-sm tw:text-muted-foreground" data-testid="pt9-files-too-large">
          {formatReplacementString(
            localizedStrings['%interlinearizer_pt9ImportModal_filesTooLarge%'],
            {
              limit: describeMebibytes(
                Math.max(...filesTooLarge.map((file) => file.maxResponseBytes)),
              ),
              files: filesTooLarge
                .toSorted(compareUnreadableFiles)
                .map(describeUnreadableFile)
                .join(', '),
            },
          )}
        </p>
      )}
    </>
  );
}

/** Folds the per-language, per-book report into the totals the summary shows. */
function foldReport(report: Pt9ImportReport): ReportTotals {
  const books: string[] = [];
  const missingBooks: string[] = [];
  let clustersTotal = 0;
  let clustersConverted = 0;
  let phrasesConverted = 0;
  const dropCounts = new Map<Pt9ClusterDropReason, number>();
  const droppedClusters: ReportTotals['droppedClusters'] = [];
  report.languages.forEach((language) => {
    language.books.forEach((book) => {
      book.drops.forEach((drop) => droppedClusters.push({ ...drop, language: language.tag }));
      if (!books.includes(book.bookId)) books.push(book.bookId);
      if (!book.bookFound && !missingBooks.includes(book.bookId)) missingBooks.push(book.bookId);
      clustersTotal += book.clustersTotal;
      clustersConverted += book.clustersConverted;
      phrasesConverted += book.phrasesConverted;
      PT9_CLUSTER_DROP_REASONS.forEach((reason) => {
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
    books: books.sort(compareBookIds),
    missingBooks: missingBooks.sort(compareBookIds),
    clustersTotal,
    clustersConverted,
    phrasesConverted,
    drops,
    droppedClusters: droppedClusters.sort(compareDroppedClusters),
  };
}

/**
 * The most dropped-cluster lines the report lays out, because laying out every line of a large
 * import freezes the WebView. Copy all carries every line.
 */
export const MAX_SHOWN_DROPS = 100;

/** How long, in milliseconds, the Copy all button shows the last copy's outcome. */
export const COPY_FEEDBACK_MS = 2000;

/** The Copy all button's label for each copy outcome; `idle` covers no copy and expired feedback. */
const COPY_LABEL_KEYS: Record<'copied' | 'failed' | 'idle', `%${string}%`> = {
  copied: '%interlinearizer_pt9ImportModal_dropsCopied%',
  failed: '%interlinearizer_pt9ImportModal_copyFailed%',
  idle: '%interlinearizer_pt9ImportModal_copyDrops%',
};

/**
 * A collapsed list of the dropped clusters, one line each, with a button that copies every line.
 * Lines are built only while the list is open.
 */
function DroppedClusterList({
  droppedClusters,
  localizedStrings,
}: Readonly<{
  droppedClusters: ReportTotals['droppedClusters'];
  localizedStrings: LanguageStrings;
}>) {
  const [open, setOpen] = useState(false);
  const [copyOutcome, setCopyOutcome] = useState<'copied' | 'failed'>();
  useEffect(() => {
    if (copyOutcome === undefined) return undefined;
    const timer = setTimeout(() => setCopyOutcome(undefined), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copyOutcome]);
  const describe = (drop: ReportTotals['droppedClusters'][number]) =>
    formatReplacementString(localizedStrings['%interlinearizer_pt9ImportModal_dropLine%'], {
      verseRef: drop.verseRef,
      language: drop.language,
      lexemeIds: drop.lexemeIds.join(' '),
      reason: localizedStrings[`%interlinearizer_pt9ImportModal_reason_${drop.reason}%`],
    });
  const hiddenCount = droppedClusters.length - MAX_SHOWN_DROPS;
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(droppedClusters.map(describe).join('\n'));
      setCopyOutcome('copied');
    } catch (e) {
      logger.error('Interlinearizer: failed to copy the clusters a Paratext 9 import dropped', e);
      setCopyOutcome('failed');
    }
  };
  return (
    <details
      className="tw:text-sm"
      data-testid="pt9-import-drops"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        setCopyOutcome(undefined);
      }}
    >
      <summary className="tw:cursor-pointer">
        {localizedStrings['%interlinearizer_pt9ImportModal_showDrops%']}
      </summary>
      {open && (
        <div className="tw:flex tw:flex-col tw:gap-1 tw:ps-5">
          <pre
            className="tw:max-h-48 tw:overflow-auto tw:font-sans tw:text-muted-foreground"
            data-testid="pt9-import-drop-lines"
          >
            {droppedClusters.slice(0, MAX_SHOWN_DROPS).map(describe).join('\n')}
          </pre>
          {hiddenCount > 0 && (
            <p className="tw:text-muted-foreground">
              {formatReplacementString(
                localizedStrings['%interlinearizer_pt9ImportModal_moreDrops%'],
                { count: hiddenCount.toLocaleString() },
              )}
            </p>
          )}
          <Button className="tw:self-start" size="sm" variant="secondary" onClick={copyAll}>
            {localizedStrings[COPY_LABEL_KEYS[copyOutcome ?? 'idle']]}
          </Button>
        </div>
      )}
    </details>
  );
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
 * @param props.mode - `import` titles the modal as an import and offers Close and Open on the
 *   report; `offer` titles it the same but the report carries a single Open, dismissal included -
 *   the user already chose to convert, so the report is information on the way in, not a fork;
 *   `sync` titles it as a sync and offers only Close (the project is already open).
 * @param props.sourceShortName - Short name of the source project, which an import's titles end
 *   with.
 * @param props.onOpen - Called when the user opens the imported project from the report; not
 *   offered in `sync` mode, where the project is already open.
 * @param props.onClose - Called when the user dismisses the report or failure.
 */
export function Pt9ImportModal({
  phase,
  mode,
  sourceShortName,
  onOpen,
  onClose,
}: Readonly<{
  phase: Pt9ImportModalPhase;
  mode: 'import' | 'offer' | 'sync';
  sourceShortName: string;
  onOpen?: () => void;
  onClose: () => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(PT9_IMPORT_MODAL_STRING_KEYS);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  const title =
    mode === 'sync'
      ? localizedStrings['%interlinearizer_pt9ImportModal_syncTitle%']
      : formatReplacementString(localizedStrings['%interlinearizer_pt9ImportModal_title%'], {
          projectName: sourceShortName,
        });

  if (phase.kind === 'running' && mode !== 'sync') {
    return (
      <ModalShell
        titleTestId="pt9-import-modal-title"
        title={formatReplacementString(
          localizedStrings['%interlinearizer_pt9ImportModal_importing%'],
          { projectName: sourceShortName },
        )}
        width="tw:w-96"
      />
    );
  }

  if (phase.kind === 'running') {
    return (
      <ModalShell titleTestId="pt9-import-modal-title" title={title} width="tw:w-96">
        <p className="tw:text-sm tw:text-muted-foreground" data-testid="pt9-import-running">
          {localizedStrings['%interlinearizer_pt9ImportModal_syncing%']}
        </p>
      </ModalShell>
    );
  }

  if (phase.kind === 'error' || phase.kind === 'notConverted') {
    return (
      <ModalShell
        titleTestId="pt9-import-modal-title"
        title={title}
        width="tw:w-96"
        onClose={onClose}
      >
        <p className="tw:text-sm tw:text-destructive" data-testid="pt9-import-error">
          {phase.kind === 'error' && phase.reason === 'tooLarge'
            ? localizedStrings['%interlinearizer_pt9ImportModal_tooLarge%']
            : localizedStrings['%interlinearizer_pt9ImportModal_failed%']}
        </p>
        {phase.kind === 'notConverted' && (
          <LeftOutFileLines
            filesTooLarge={phase.filesTooLarge}
            filesNeverLoaded={phase.filesNeverLoaded}
            localizedStrings={localizedStrings}
          />
        )}
        <div className="tw:modal-actions tw:mt-4">
          <Button onClick={onClose}>
            {localizedStrings['%interlinearizer_pt9ImportModal_close%']}
          </Button>
        </div>
      </ModalShell>
    );
  }

  if (phase.kind === 'staleKept') {
    return (
      <ModalShell
        titleTestId="pt9-import-modal-title"
        title={title}
        width="tw:w-96"
        onClose={onClose}
      >
        <p className="tw:text-sm" data-testid="pt9-import-stale-kept">
          {localizedStrings['%interlinearizer_pt9ImportModal_staleKept%']}
        </p>
        <LeftOutFileLines
          filesTooLarge={phase.filesTooLarge}
          filesNeverLoaded={phase.filesNeverLoaded}
          localizedStrings={localizedStrings}
        />
        <div className="tw:modal-actions tw:mt-4">
          <Button onClick={onClose}>
            {localizedStrings['%interlinearizer_pt9ImportModal_close%']}
          </Button>
        </div>
      </ModalShell>
    );
  }

  return (
    <Pt9ImportReportView
      report={phase.report}
      mode={mode}
      title={title}
      localizedStrings={localizedStrings}
      onOpen={onOpen}
      onClose={onClose}
    />
  );
}

/** The report summary that a finished run shows, with the actions that `mode` offers. */
function Pt9ImportReportView({
  report,
  mode,
  title,
  localizedStrings,
  onOpen,
  onClose,
}: Readonly<{
  report: Pt9ImportReport;
  mode: 'import' | 'offer' | 'sync';
  title: string;
  localizedStrings: LanguageStrings;
  onOpen?: () => void;
  onClose: () => void;
}>) {
  const totals = useMemo(() => foldReport(report), [report]);
  const dropTotal = totals.drops.reduce((sum, drop) => sum + drop.count, 0);
  const reasonLines = totals.drops.map(
    (drop) =>
      `${drop.count.toLocaleString()} ${localizedStrings[`%interlinearizer_pt9ImportModal_reason_${drop.reason}%`]}`,
  );

  return (
    <ModalShell
      titleTestId="pt9-import-modal-title"
      title={title}
      width="tw:w-xl"
      onClose={mode === 'offer' ? onOpen : onClose}
    >
      <div className="tw:flex tw:min-w-0 tw:flex-col tw:gap-1" data-testid="pt9-import-report">
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
            {
              converted: totals.clustersConverted.toLocaleString(),
              total: totals.clustersTotal.toLocaleString(),
            },
          )}${
            totals.phrasesConverted > 0
              ? `, ${formatReplacementString(
                  localizedStrings['%interlinearizer_pt9ImportModal_phraseCounts%'],
                  { phrases: totals.phrasesConverted.toLocaleString() },
                )}`
              : ''
          }`}
        />
        {dropTotal > 0 && (
          <>
            <ReportRow
              label={localizedStrings['%interlinearizer_pt9ImportModal_notImported_label%']}
              value={formatReplacementString(
                localizedStrings['%interlinearizer_pt9ImportModal_notImportedCount%'],
                { count: dropTotal.toLocaleString() },
              )}
            />
            <ul className="tw:list-disc tw:ps-5 tw:text-sm tw:text-muted-foreground">
              {reasonLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
        {totals.droppedClusters.length > 0 && (
          <DroppedClusterList
            droppedClusters={totals.droppedClusters}
            localizedStrings={localizedStrings}
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
        <LeftOutFileLines
          filesTooLarge={report.filesTooLargeToRead}
          filesNeverLoaded={report.filesPt9NeverLoads}
          localizedStrings={localizedStrings}
        />
      </div>
      <div className="tw:modal-actions tw:mt-4">
        {mode === 'import' && (
          <>
            <Button variant="secondary" onClick={onClose}>
              {localizedStrings['%interlinearizer_pt9ImportModal_close%']}
            </Button>
            <Button onClick={onOpen}>
              {localizedStrings['%interlinearizer_pt9ImportModal_open%']}
            </Button>
          </>
        )}
        {mode === 'offer' && (
          <Button onClick={onOpen}>
            {localizedStrings['%interlinearizer_pt9ImportModal_open%']}
          </Button>
        )}
        {mode === 'sync' && (
          <Button onClick={onClose}>
            {localizedStrings['%interlinearizer_pt9ImportModal_close%']}
          </Button>
        )}
      </div>
    </ModalShell>
  );
}
