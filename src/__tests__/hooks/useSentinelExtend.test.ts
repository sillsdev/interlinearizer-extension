/// <reference types="jest" />

import { act, renderHook } from '@testing-library/react';
import useSentinelExtend from '../../hooks/useSentinelExtend';
import { deliverIntersectingTogether } from '../test-helpers';

/** A scroll root holding a leading and a trailing sentinel, all attached. */
function mountRootAndSentinels() {
  const root = document.createElement('div');
  const leading = document.createElement('div');
  const trailing = document.createElement('div');
  root.append(leading, trailing);
  document.body.appendChild(root);
  return { root, leading, trailing };
}

beforeEach(() => {
  global.ioInstances = [];
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useSentinelExtend', () => {
  it('reports each edge in a delivery once, however many entries name it', () => {
    const { root, leading, trailing } = mountRootAndSentinels();
    const onReach = jest.fn();
    renderHook(() =>
      useSentinelExtend({
        root,
        sentinels: [
          ['leading', leading],
          ['trailing', trailing],
        ],
        margin: 400,
        onReach,
        resubscribeKeys: [],
      }),
    );

    act(() => deliverIntersectingTogether(leading, leading, trailing));

    expect(onReach).toHaveBeenCalledTimes(2);
    expect(onReach).toHaveBeenNthCalledWith(1, 'leading');
    expect(onReach).toHaveBeenNthCalledWith(2, 'trailing');
  });

  it('reports a sentinel entering the margin but not one leaving it', () => {
    const { root, leading } = mountRootAndSentinels();
    const onReach = jest.fn();
    renderHook(() =>
      useSentinelExtend({
        root: { current: root },
        sentinels: [['leading', leading]],
        margin: 400,
        onReach,
        resubscribeKeys: [],
      }),
    );

    act(() => global.triggerIntersection(leading, false));
    expect(onReach).not.toHaveBeenCalled();

    act(() => global.triggerIntersection(leading, true));
    expect(onReach).toHaveBeenCalledTimes(1);
    expect(onReach).toHaveBeenCalledWith('leading');
  });

  it('watches nothing while there is no callback', () => {
    const { root, leading } = mountRootAndSentinels();
    renderHook(() =>
      useSentinelExtend({
        root,
        sentinels: [['leading', leading]],
        margin: 400,
        onReach: undefined,
        resubscribeKeys: [],
      }),
    );

    expect(global.ioInstances).toHaveLength(0);
  });

  it('re-subscribes when a key changes', () => {
    const { root, leading } = mountRootAndSentinels();
    const { rerender } = renderHook(
      ({ key }: { key: number }) =>
        useSentinelExtend({
          root,
          sentinels: [['leading', leading]],
          margin: 400,
          onReach: jest.fn(),
          resubscribeKeys: [key],
        }),
      { initialProps: { key: 0 } },
    );
    const observerBefore = global.ioInstances[0];

    rerender({ key: 1 });

    expect(global.ioInstances).toHaveLength(1);
    expect(global.ioInstances[0]).not.toBe(observerBefore);
  });
});
