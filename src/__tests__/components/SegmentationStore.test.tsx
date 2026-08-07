/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import type { Segment } from 'interlinearizer';
import { makeSegment } from '../test-helpers';
import {
  NO_OP_SEGMENTATION_DISPATCH,
  SegmentationProvider,
  useSegmentation,
  type SegmentationContextValue,
} from '../../components/SegmentationStore';

/** A test consumer that renders the resolved context as text so tests can assert on it. */
function Probe() {
  const { segmentById, segmentOrder } = useSegmentation();
  return (
    <span data-testid="probe">
      {segmentById.size}:{segmentOrder.size}
    </span>
  );
}

describe('SegmentationStore', () => {
  it('returns an inert default when no provider is present', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('0:0');
  });

  it('provides the supplied value to consumers within a provider', () => {
    const segment: Segment = makeSegment('GEN 1:1', 'Hi.', []);
    const value: SegmentationContextValue = {
      dispatch: NO_OP_SEGMENTATION_DISPATCH,
      segmentById: new Map([['GEN 1:1', segment]]),
      segmentOrder: new Map([['GEN 1:1', 0]]),
      formerBoundaries: new Map(),
      straddledBoundaryRefs: new Set(),
    };
    render(
      <SegmentationProvider value={value}>
        <Probe />
      </SegmentationProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('1:1');
  });

  it('exposes an inert no-op dispatch that does nothing when invoked', () => {
    expect(() => {
      NO_OP_SEGMENTATION_DISPATCH.merge('GEN 1:1:0');
      NO_OP_SEGMENTATION_DISPATCH.split('GEN 1:1:6');
      NO_OP_SEGMENTATION_DISPATCH.move('GEN 1:1:0', 'GEN 1:1:6');
    }).not.toThrow();
  });
});
