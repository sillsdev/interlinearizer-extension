/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import type { StaleAnalysesReport } from '../../components/StaleAnalysesReporter';
import useRecordDismissal from '../../hooks/useRecordDismissal';
import useStaleAnalysisDismissal from '../../hooks/useStaleAnalysisDismissal';
import { makeWebViewState } from '../test-helpers';

// Mocked so each test decides which records are dismissed.
jest.mock('../../hooks/useRecordDismissal');

/** Stale glosses and free translations, with a segment showing more than one of the latter. */
const REPORT: StaleAnalysesReport = {
  bookRef: 'GEN',
  glosses: ['gloss a GEN 1:1:0', 'gloss b GEN 1:2:0'],
  freeTranslations: [
    { key: 'freeTranslation s1', segmentId: 'GEN 1:1' },
    { key: 'freeTranslation s2', segmentId: 'GEN 1:1' },
    { key: 'freeTranslation s3', segmentId: 'GEN 1:3' },
  ],
};

/** Serves a dismissal covering exactly `dismissed`. */
function mockDismissed(dismissed: readonly string[] = []): void {
  jest.mocked(useRecordDismissal).mockImplementation(({ records }) => ({
    undismissed: records.filter((record) => !dismissed.includes(record)),
    onDismiss: jest.fn(),
  }));
}

function renderStale(report: StaleAnalysesReport | undefined) {
  return renderHook(() =>
    useStaleAnalysisDismissal({ report, draftVersion: 0, useWebViewState: makeWebViewState() }),
  );
}

describe('useStaleAnalysisDismissal', () => {
  it('counts the stale glosses the notice has not been dismissed for', () => {
    mockDismissed(['gloss a GEN 1:1:0']);

    const { result } = renderStale(REPORT);

    expect(result.current.glossCount).toBe(1);
  });

  it('counts the stale free translations the notice has not been dismissed for', () => {
    mockDismissed(['freeTranslation s3']);

    const { result } = renderStale(REPORT);

    expect(result.current.freeTranslationCount).toBe(2);
  });

  it('lists each segment showing one of those free translations once, in document order', () => {
    mockDismissed();

    const { result } = renderStale(REPORT);

    expect(result.current.freeTranslationSegmentIds).toEqual(['GEN 1:1', 'GEN 1:3']);
  });

  it('leaves out a segment whose free translations are all dismissed', () => {
    mockDismissed(['freeTranslation s3']);

    const { result } = renderStale(REPORT);

    expect(result.current.freeTranslationSegmentIds).toEqual(['GEN 1:1']);
  });

  it('reports nothing before the book’s stale analyses are known', () => {
    mockDismissed();

    const { result } = renderStale(undefined);

    expect(result.current).toEqual(
      expect.objectContaining({
        glossCount: 0,
        freeTranslationCount: 0,
        freeTranslationSegmentIds: [],
      }),
    );
  });

  it('tracks a dismissal of every stale analysis in the reported book', () => {
    mockDismissed();

    renderStale(REPORT);

    expect(jest.mocked(useRecordDismissal)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        records: [
          'gloss a GEN 1:1:0',
          'gloss b GEN 1:2:0',
          'freeTranslation s1',
          'freeTranslation s2',
          'freeTranslation s3',
        ],
        observedBookRef: 'GEN',
      }),
    );
  });

  it('observes no book before a report arrives', () => {
    mockDismissed();

    renderStale(undefined);

    expect(jest.mocked(useRecordDismissal)).toHaveBeenLastCalledWith(
      expect.objectContaining({ records: [], observedBookRef: undefined }),
    );
  });
});
