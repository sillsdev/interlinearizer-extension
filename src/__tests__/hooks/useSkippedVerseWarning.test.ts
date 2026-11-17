/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { renderHook } from '@testing-library/react';
import useSkippedVerseWarning, {
  DUPLICATE_VERSES,
  INVALID_VERSES,
  type SkippedVerseKind,
} from '../../hooks/useSkippedVerseWarning';

type Pages = { bookRef: string; skippedVerseIds: readonly string[] } | undefined;

function renderWarning(pages: Pages, kind: SkippedVerseKind = DUPLICATE_VERSES) {
  return renderHook(
    (props: { pages: Pages }) =>
      useSkippedVerseWarning(
        'test-project',
        props.pages?.bookRef,
        props.pages?.skippedVerseIds,
        kind,
      ),
    { initialProps: { pages } },
  );
}

describe('useSkippedVerseWarning', () => {
  beforeEach(() => {
    jest.mocked(logger.warn).mockImplementation(() => {});
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
  });

  it('sends the duplicate-verse notification and logs the repeated SIDs', () => {
    renderWarning({ bookRef: 'GEN', skippedVerseIds: ['GEN 1:1'] }, DUPLICATE_VERSES);

    expect(papi.notifications.send).toHaveBeenCalledWith({
      message: '%interlinearizer_warning_duplicateVerses%',
      severity: 'warning',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: book GEN in project test-project repeats 1 verse marker(s); their text is not shown: GEN 1:1',
    );
  });

  it('sends the invalid-verse notification and logs the SIDs naming no verse', () => {
    renderWarning({ bookRef: 'GEN', skippedVerseIds: ['GEN 1:'] }, INVALID_VERSES);

    expect(papi.notifications.send).toHaveBeenCalledWith({
      message: '%interlinearizer_warning_invalidVerses%',
      severity: 'warning',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Interlinearizer: book GEN in project test-project has 1 verse marker(s) that name no verse; their text is not shown: GEN 1:',
    );
  });

  it('warns only once while the book skips the same markers', () => {
    const { rerender } = renderWarning({ bookRef: 'GEN', skippedVerseIds: ['GEN 1:1'] });

    rerender({ pages: { bookRef: 'GEN', skippedVerseIds: ['GEN 1:1'] } });

    expect(papi.notifications.send).toHaveBeenCalledTimes(1);
  });

  it('does not warn again on returning to a book already warned about', () => {
    const { rerender } = renderWarning({ bookRef: 'GEN', skippedVerseIds: ['GEN 1:1'] });

    rerender({ pages: { bookRef: 'EXO', skippedVerseIds: ['EXO 2:1'] } });
    rerender({ pages: { bookRef: 'GEN', skippedVerseIds: ['GEN 1:1'] } });

    expect(papi.notifications.send).toHaveBeenCalledTimes(2);
  });

  it('warns again when the book skips another marker', () => {
    const { rerender } = renderWarning({ bookRef: 'GEN', skippedVerseIds: ['GEN 1:1'] });

    rerender({ pages: { bookRef: 'GEN', skippedVerseIds: ['GEN 1:1', 'GEN 5:3'] } });

    expect(papi.notifications.send).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining('GEN 5:3'));
  });

  it('does not warn for a book that skips no markers', () => {
    renderWarning({ bookRef: 'GEN', skippedVerseIds: [] });

    expect(papi.notifications.send).not.toHaveBeenCalled();
  });

  it('does not warn before a book loads', () => {
    renderWarning(undefined);

    expect(papi.notifications.send).not.toHaveBeenCalled();
  });
});
