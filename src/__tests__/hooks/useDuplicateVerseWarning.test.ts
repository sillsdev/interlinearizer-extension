/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { renderHook } from '@testing-library/react';
import useDuplicateVerseWarning from '../../hooks/useDuplicateVerseWarning';

type Pages = { bookRef: string; duplicateVerseIds: readonly string[] } | undefined;

function renderWarning(pages: Pages) {
  return renderHook(
    (props: { pages: Pages }) => useDuplicateVerseWarning('test-project', props.pages),
    {
      initialProps: { pages },
    },
  );
}

describe('useDuplicateVerseWarning', () => {
  beforeEach(() => {
    jest.mocked(logger.warn).mockImplementation(() => {});
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
  });

  it('sends a warning notification naming no specific verse', () => {
    renderWarning({ bookRef: 'GEN', duplicateVerseIds: ['GEN 1:1'] });

    expect(papi.notifications.send).toHaveBeenCalledWith({
      message: '%interlinearizer_warning_duplicateVerses%',
      severity: 'warning',
    });
  });

  it('logs the skipped SIDs', () => {
    renderWarning({ bookRef: 'GEN', duplicateVerseIds: ['GEN 1:1'] });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('GEN 1:1'));
  });

  it('warns only once while the book repeats the same markers', () => {
    const { rerender } = renderWarning({ bookRef: 'GEN', duplicateVerseIds: ['GEN 1:1'] });

    rerender({ pages: { bookRef: 'GEN', duplicateVerseIds: ['GEN 1:1'] } });

    expect(papi.notifications.send).toHaveBeenCalledTimes(1);
  });

  it('warns again when the book repeats another marker', () => {
    const { rerender } = renderWarning({ bookRef: 'GEN', duplicateVerseIds: ['GEN 1:1'] });

    rerender({ pages: { bookRef: 'GEN', duplicateVerseIds: ['GEN 1:1', 'GEN 5:3'] } });

    expect(papi.notifications.send).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining('GEN 5:3'));
  });

  it('does not warn for a book with no repeats', () => {
    renderWarning({ bookRef: 'GEN', duplicateVerseIds: [] });

    expect(papi.notifications.send).not.toHaveBeenCalled();
  });

  it('does not warn before a book loads', () => {
    renderWarning(undefined);

    expect(papi.notifications.send).not.toHaveBeenCalled();
  });
});
