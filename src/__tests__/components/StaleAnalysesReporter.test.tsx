/// <reference types="jest" />

import { render } from '@testing-library/react';
import { useStaleSummary } from '../../cache/staleHooks';
import StaleAnalysesReporter from '../../components/StaleAnalysesReporter';
import type { StaleSummary } from '../../types/segment-pages';

jest.mock('../../cache/staleHooks', () => ({
  __esModule: true,
  useStaleSummary: jest.fn(),
}));

/** Serves this summary of the book's stale analyses. */
function mockSummary(summary: Partial<StaleSummary> | undefined): void {
  jest
    .mocked(useStaleSummary)
    .mockReturnValue(summary && { glosses: [], phrases: [], freeTranslations: [], ...summary });
}

describe('StaleAnalysesReporter', () => {
  it("reads the summary of the reported book's stale analyses", () => {
    mockSummary({});

    render(<StaleAnalysesReporter bookRef="GEN" onReport={jest.fn()} />);

    expect(useStaleSummary).toHaveBeenCalledWith('GEN');
  });

  it('reports a key per place in the book that a token analysis went stale at', () => {
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

  it('reports a key per stale phrase link', () => {
    mockSummary({
      phrases: [
        { linkId: 'p0', tokenRef: 'GEN 1:1:0' },
        { linkId: 'p1', tokenRef: 'GEN 1:1:0' },
      ],
    });
    const onReport = jest.fn();

    render(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ phrases: ['phrase p0', 'phrase p1'] }),
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

  it('reports again when only the stale phrases change', () => {
    mockSummary({ phrases: [{ linkId: 'p0', tokenRef: 'GEN 1:1:0' }] });
    const onReport = jest.fn();
    const { rerender } = render(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    mockSummary({ phrases: [{ linkId: 'p1', tokenRef: 'GEN 1:1:0' }] });
    rerender(<StaleAnalysesReporter bookRef="GEN" onReport={onReport} />);

    expect(onReport).toHaveBeenLastCalledWith(expect.objectContaining({ phrases: ['phrase p1'] }));
  });

  it('does not report again when the host sends the same stale analyses', () => {
    const same = {
      glosses: [{ analysisId: 'a', tokenRef: 'GEN 1:1:0' }],
      phrases: [{ linkId: 'p0', tokenRef: 'GEN 1:1:0' }],
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
