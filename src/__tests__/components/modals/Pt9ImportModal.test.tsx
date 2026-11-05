/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Pt9ImportModal } from '../../../components/modals/Pt9ImportModal';
import type { Pt9ImportReport } from '../../../converters/pt9';

const LOCALIZED: Record<string, string> = {
  '%interlinearizer_pt9ImportModal_title%': 'Import from Paratext 9: {projectName}',
  '%interlinearizer_pt9ImportModal_syncTitle%': 'Sync from Paratext 9',
  '%interlinearizer_pt9ImportModal_importing%': 'Importing {projectName}…',
  '%interlinearizer_pt9ImportModal_syncing%': 'Syncing…',
  '%interlinearizer_pt9ImportModal_failed%': 'The import failed.',
  '%interlinearizer_pt9ImportModal_tooLarge%': 'The interlinear data is too large.',
  '%interlinearizer_pt9ImportModal_languages_label%': 'Languages',
  '%interlinearizer_pt9ImportModal_books_label%': 'Books',
  '%interlinearizer_pt9ImportModal_imported_label%': 'Imported',
  '%interlinearizer_pt9ImportModal_importedCounts%': '{converted} of {total} clusters',
  '%interlinearizer_pt9ImportModal_phraseCounts%': '{phrases} phrases',
  '%interlinearizer_pt9ImportModal_notImported_label%': 'Not imported',
  '%interlinearizer_pt9ImportModal_notImportedCount%': '{count} clusters:',
  '%interlinearizer_pt9ImportModal_reason_verseNotFound%': 'verse not found',
  '%interlinearizer_pt9ImportModal_reason_formMismatch%': 'did not match the text',
  '%interlinearizer_pt9ImportModal_reason_lemmaOrOther%': 'unused legacy data',
  '%interlinearizer_pt9ImportModal_reason_duplicateCluster%': 'duplicate data',
  '%interlinearizer_pt9ImportModal_reason_unparseableLexemeId%': 'unreadable data',
  '%interlinearizer_pt9ImportModal_missingBooks%': 'Books with no text: {books}',
  '%interlinearizer_pt9ImportModal_filesTooLarge%':
    'Larger than the {limit} one read can carry, so left out: {files}',
  '%interlinearizer_pt9ImportModal_filesNeverLoaded%':
    'Left out because Paratext 9 never loads them from where they are: {files}',
  '%interlinearizer_pt9ImportModal_staleKept%':
    'Nothing could be read, so the earlier import was kept.',
  '%interlinearizer_pt9ImportModal_open%': 'Open',
  '%interlinearizer_pt9ImportModal_close%': 'Close',
};

/** Builds a two-language report exercising totals, drops, phrases, and a missing book. */
function makeReport(): Pt9ImportReport {
  const emptyDrops = {
    verseNotFound: 0,
    formMismatch: 0,
    frontMatter: 0,
    lemmaOrOther: 0,
    duplicateCluster: 0,
    unparseableLexemeId: 0,
  };
  return {
    languages: [
      {
        rawLanguage: 'en',
        tag: 'en',
        tagIsFallback: false,
        books: [
          {
            bookId: 'MAT',
            bookFound: true,
            versesTotal: 10,
            versesHashed: 5,
            versesNotFound: 0,
            clustersTotal: 20,
            clustersConverted: 15,
            phrasesConverted: 2,
            clusterDrops: { ...emptyDrops, formMismatch: 4, verseNotFound: 1, duplicateCluster: 1 },
            ambiguousAnchors: 0,
            punctuationEntriesIgnored: 0,
          },
        ],
      },
      {
        rawLanguage: 'fr',
        tag: 'fr',
        tagIsFallback: false,
        books: [
          {
            bookId: 'MRK',
            bookFound: false,
            versesTotal: 3,
            versesHashed: 0,
            versesNotFound: 3,
            clustersTotal: 5,
            clustersConverted: 0,
            phrasesConverted: 0,
            clusterDrops: { ...emptyDrops, verseNotFound: 5 },
            ambiguousAnchors: 0,
            punctuationEntriesIgnored: 0,
          },
        ],
      },
    ],
    merge: {
      mergedTokenRecords: 0,
      parseConflicts: 0,
      approvedDemotedToCandidate: 0,
      sameTagCollisions: [],
      identicalPayloadsMerged: 0,
    },
    senses: {
      specificResolved: 0,
      defaultSingleResolved: 0,
      unresolvedGlossText: 0,
      entryRefsResolved: 0,
      entryRefsUnresolved: 0,
      senseRefsResolved: 0,
      senseRefsUnresolved: 0,
    },
    barePayloads: { added: 0, skippedExistingIdentical: 0, droppedUnparseable: 0, droppedEmpty: 0 },
    filesPt9NeverLoads: [],
    filesTooLargeToRead: [],
  };
}

describe('Pt9ImportModal', () => {
  beforeEach(() => {
    jest.mocked(useLocalizedStrings).mockReturnValue([LOCALIZED, false]);
  });

  it('titles the import progress with the source short name, with no dismiss affordances', () => {
    render(
      <Pt9ImportModal
        phase={{ kind: 'running' }}
        mode="import"
        sourceShortName="SRC"
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('pt9-import-modal-title')).toHaveTextContent('Importing SRC…');
    expect(screen.queryByTestId('pt9-import-running')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('titles the report with the source short name', () => {
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report: makeReport() }}
        mode="import"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('pt9-import-modal-title')).toHaveTextContent(
      'Import from Paratext 9: SRC',
    );
  });

  it('shows the sync progress line and title in sync mode', () => {
    render(
      <Pt9ImportModal
        phase={{ kind: 'running' }}
        mode="sync"
        sourceShortName="SRC"
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('pt9-import-modal-title')).toHaveTextContent('Sync from Paratext 9');
    expect(screen.getByTestId('pt9-import-running')).toHaveTextContent('Syncing…');
  });

  it('shows the failure line with Close on error', async () => {
    const onClose = jest.fn();
    render(
      <Pt9ImportModal
        phase={{ kind: 'error' }}
        mode="import"
        sourceShortName="SRC"
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId('pt9-import-error')).toHaveTextContent('The import failed.');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the too-large message when the failure reason is tooLarge', () => {
    render(
      <Pt9ImportModal
        phase={{ kind: 'error', reason: 'tooLarge' }}
        mode="import"
        sourceShortName="SRC"
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('pt9-import-error')).toHaveTextContent(
      'The interlinear data is too large.',
    );
  });

  it('summarizes languages, books, and counts on the report', () => {
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report: makeReport() }}
        mode="import"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const report = screen.getByTestId('pt9-import-report');
    expect(report).toHaveTextContent('Languages: en, fr');
    expect(report).toHaveTextContent('Books: MAT, MRK');
    expect(report).toHaveTextContent('15 of 25 clusters, 2 phrases');
    expect(report).toHaveTextContent('11 clusters:');
    expect(
      within(report)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['6 verse not found', '4 did not match the text', '1 duplicate data']);
    expect(report).toHaveTextContent('Books with no text: MRK');
  });

  it('groups the digits of large counts', () => {
    const report = makeReport();
    report.languages.splice(1, 1);
    Object.assign(report.languages[0].books[0], {
      clustersTotal: 624531,
      clustersConverted: 530155,
      phrasesConverted: 51256,
      clusterDrops: { ...report.languages[0].books[0].clusterDrops, formMismatch: 29525 },
    });
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report }}
        mode="import"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const rendered = screen.getByTestId('pt9-import-report');
    expect(rendered).toHaveTextContent('530,155 of 624,531 clusters, 51,256 phrases');
    expect(rendered).toHaveTextContent('29,527 clusters:');
    expect(rendered).toHaveTextContent('29,525 did not match the text');
  });

  it('omits the not-imported and missing-book rows when the import was clean', () => {
    const report = makeReport();
    report.languages.splice(1, 1);
    report.languages[0].books[0].clusterDrops = {
      verseNotFound: 0,
      formMismatch: 0,
      frontMatter: 0,
      lemmaOrOther: 0,
      duplicateCluster: 0,
      unparseableLexemeId: 0,
    };
    report.languages[0].books[0].phrasesConverted = 0;
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report }}
        mode="import"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const rendered = screen.getByTestId('pt9-import-report');
    expect(rendered).not.toHaveTextContent('Not imported');
    expect(rendered).not.toHaveTextContent('Books with no text');
    expect(rendered).not.toHaveTextContent('phrases');
  });

  it('names the files it could not retrieve, pairing a book with its gloss language', () => {
    const report = makeReport();
    report.filesTooLargeToRead = [
      {
        path: 'Interlinear_en/Interlinear_en_PSA.xml',
        bookId: 'PSA',
        glossLanguage: 'en',
        sizeBytes: 90_000_000,
        maxResponseBytes: 83_886_080,
      },
      {
        path: 'Interlinear_/Interlinear__1TH.xml',
        bookId: '1TH',
        sizeBytes: 90_000_000,
        maxResponseBytes: 83_886_080,
      },
      {
        path: 'Interlinear_en/mystery.xml',
        sizeBytes: 90_000_000,
        maxResponseBytes: 83_886_080,
      },
    ];
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report }}
        mode="import"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    // A book id alone is not unique across gloss languages, so the language is named with it. A
    // file whose root declares a book but no language is named by the book alone, and one
    // declaring neither is named by its path.
    expect(screen.getByTestId('pt9-files-too-large')).toHaveTextContent(
      'Larger than the 80 MiB one read can carry, so left out: PSA (en) 85.8 MiB, 1TH 85.8 MiB, Interlinear_en/mystery.xml 85.8 MiB',
    );
  });

  it('names the oversized files when no conversion ran and the stored import was kept', () => {
    render(
      <Pt9ImportModal
        phase={{
          kind: 'staleKept',
          files: [
            {
              path: 'Interlinear_en/Interlinear_en_PSA.xml',
              bookId: 'PSA',
              glossLanguage: 'en',
              sizeBytes: 90_000_000,
              maxResponseBytes: 83_886_080,
            },
          ],
        }}
        mode="sync"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('pt9-import-stale-kept')).toHaveTextContent(
      'Nothing could be read, so the earlier import was kept.',
    );
    expect(screen.getByTestId('pt9-files-too-large')).toHaveTextContent(
      'Larger than the 80 MiB one read can carry, so left out: PSA (en) 85.8 MiB',
    );
  });

  it('names the files Paratext 9 never loads', () => {
    const report = makeReport();
    report.filesPt9NeverLoads = ['Interlinear_en/Interlinear_en_opy.xml', 'Interlinear_en_GEN.xml'];
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report }}
        mode="import"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('pt9-files-never-loaded')).toHaveTextContent(
      'Left out because Paratext 9 never loads them from where they are: Interlinear_en/Interlinear_en_opy.xml, Interlinear_en_GEN.xml',
    );
  });

  it('omits the never-loaded row when Paratext 9 loads every file', () => {
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report: makeReport() }}
        mode="import"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('pt9-files-never-loaded')).not.toBeInTheDocument();
  });

  it('omits the too-large row when every file was retrieved', () => {
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report: makeReport() }}
        mode="import"
        sourceShortName="SRC"
        onOpen={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('pt9-files-too-large')).not.toBeInTheDocument();
  });

  it('offers Open as well as Close on an import report and fires onOpen', async () => {
    const onOpen = jest.fn();
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report: makeReport() }}
        mode="import"
        sourceShortName="SRC"
        onOpen={onOpen}
        onClose={jest.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('offers a single Open on an offer-run report and fires it', async () => {
    const onOpen = jest.fn();
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report: makeReport() }}
        mode="offer"
        sourceShortName="SRC"
        onOpen={onOpen}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('offers only Close on a sync report', () => {
    render(
      <Pt9ImportModal
        phase={{ kind: 'report', report: makeReport() }}
        mode="sync"
        sourceShortName="SRC"
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
