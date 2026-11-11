/// <reference types="jest" />

import { render } from '@testing-library/react';
import { useStaleSummary } from '../../cache/catalogHooks';
import StaleAnalysesReporter from '../../components/StaleAnalysesReporter';
import type { StaleSummary } from '../../types/segment-pages';

jest.mock('../../cache/catalogHooks', () => ({
  __esModule: true,
  useStaleSummary: jest.fn(),
}));

/** Serves this summary of the book's stale analyses. */
function mockSummary(summary: Partial<StaleSummary> | undefined): void {
  jest
    .mocked(useStaleSummary)
    .mockReturnValue(summary && { glosses: [], freeTranslations: [], ...summary });
}

describe('StaleAnalysesReporter', () => {
  it("reads the summary of the reported book's stale analyses", () => {
    mockSummary({});

    render(<StaleAnalysesReporter bookRef="GEN" onReport={jest.fn()} />);

    expect(useStaleSummary).toHaveBeenCalledWith('GEN');
  });

  it('reports a key per place in the book an analysis went stale at', () => {
    mockSummary({
      glosses: [
        { analysisId: 'a', tokenRef: 'GEN 1:1:0' },
        { analysisId: 'b', tokenRef: 'GEN 1:1:0' },
      ],
    });
    const onReport = jest.fn();

    render(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bookRef: 'GEN',
        glosses: ['gloss a GEN 1:1:0', 'gloss b GEN 1:1:0'],
      }),
    );
  });

  it('reports a key per stale free translation, with the segment it is shown at', () => {
    mockSummary({
      freeTranslations: [
        { analysisId: 's0', segmentId: 'GEN 1:1' },
        { analysisId: 's1', segmentId: 'GEN 1:2' },
      ],
    });
    const onReport = jest.fn();

    render(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        freeTranslations: [
          { key: 'freeTranslation s0', segmentId: 'GEN 1:1' },
          { key: 'freeTranslation s1', segmentId: 'GEN 1:2' },
        ],
      }),
    );
  });

  it('reports nothing known until the summary arrives', () => {
    mockSummary(undefined);
    const onReport = jest.fn();

    render(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    expect(onReport).not.toHaveBeenCalledWith(expect.anything());
  });

  it('reports again when the stale analyses change', () => {
    mockSummary({ glosses: [{ analysisId: 'a', tokenRef: 'GEN 1:1:0' }] });
    const onReport = jest.fn();
    const { rerender } = render(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    mockSummary({});
    rerender(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(expect.objectContaining({ glosses: [] }));
  });

  it('does not report again when the host sends the same stale analyses', () => {
    const same = {
      glosses: [{ analysisId: 'a', tokenRef: 'GEN 1:1:0' }],
      freeTranslations: [{ analysisId: 's1', segmentId: 'GEN 1:1' }],
    };
    mockSummary(same);
    const onReport = jest.fn();
    const { rerender } = render(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    mockSummary(JSON.parse(JSON.stringify(same)));
    rerender(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('reports to a new receiver what it reported to the last', () => {
    mockSummary({ glosses: [{ analysisId: 'a', tokenRef: 'GEN 1:1:0' }] });
    const { rerender } = render(<StaleAnalysesReporter bookRef="GEN" onReport={jest.fn()} />);
    const onReport = jest.fn();

    rerender(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ glosses: ['gloss a GEN 1:1:0'] }),
    );
  });

  it('reports nothing known once it unmounts', () => {
    mockSummary({ glosses: [{ analysisId: 'a', tokenRef: 'GEN 1:1:0' }] });
    const onReport = jest.fn();
    const { unmount } = render(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    unmount();

    expect(onReport).toHaveBeenLastCalledWith(undefined);
  });
});
