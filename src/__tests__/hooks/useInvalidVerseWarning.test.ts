/// <reference types="jest" />

import papi, { logger } from '@papi/frontend';
import { renderHook } from '@testing-library/react';
import useInvalidVerseWarning from '../../hooks/useInvalidVerseWarning';

type Pages = { bookRef: string; invalidVerseIds: readonly string[] } | undefined;

function renderWarning(pages: Pages) {
  return renderHook(
    (props: { pages: Pages }) => useInvalidVerseWarning('test-project', props.pages),
    {
      initialProps: { pages },
    },
  );
}

describe('useInvalidVerseWarning', () => {
  beforeEach(() => {
    jest.mocked(logger.warn).mockImplementation(() => {});
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
  });

  it('sends its own warning notification and logs the skipped SIDs', () => {
    renderWarning({ bookRef: 'GEN', invalidVerseIds: ['GEN 1:'] });

    expect(papi.notifications.send).toHaveBeenCalledWith({
      message: '%interlinearizer_warning_invalidVerses%',
      severity: 'warning',
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('GEN 1:'));
  });

  it('warns only once while the book has the same markers', () => {
    const { rerender } = renderWarning({ bookRef: 'GEN', invalidVerseIds: ['GEN 1:'] });

    rerender({ pages: { bookRef: 'GEN', invalidVerseIds: ['GEN 1:'] } });

    expect(papi.notifications.send).toHaveBeenCalledTimes(1);
  });

  it('does not warn again on returning to a book already warned about', () => {
    const { rerender } = renderWarning({ bookRef: 'GEN', invalidVerseIds: ['GEN 1:'] });

    rerender({ pages: { bookRef: 'EXO', invalidVerseIds: ['EXO 2:'] } });
    rerender({ pages: { bookRef: 'GEN', invalidVerseIds: ['GEN 1:'] } });

    expect(papi.notifications.send).toHaveBeenCalledTimes(2);
  });

  it('does not warn for a book with no such markers', () => {
    renderWarning({ bookRef: 'GEN', invalidVerseIds: [] });

    expect(papi.notifications.send).not.toHaveBeenCalled();
  });
});
