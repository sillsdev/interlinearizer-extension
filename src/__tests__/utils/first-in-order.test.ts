/// <reference types="jest" />

import { firstInOrder } from '../../utils/first-in-order';

const byNumber = (a: number, b: number) => a - b;

describe('firstInOrder', () => {
  it('takes the first items in order from among unordered ones', () => {
    expect(firstInOrder([7, 3, 9, 1, 5, 8, 2], 3, byNumber)).toEqual([1, 2, 3]);
  });

  it('takes the first items in order when many share keys', () => {
    const items = [5, 1, 5, 1, 3, 3, 1, 5, 3, 1].map((key, index) => ({ key, index }));
    const byKeyThenIndex = (a: (typeof items)[number], b: (typeof items)[number]) =>
      a.key - b.key || a.index - b.index;

    expect(firstInOrder(items, 5, byKeyThenIndex)).toEqual([
      { key: 1, index: 1 },
      { key: 1, index: 3 },
      { key: 1, index: 6 },
      { key: 1, index: 9 },
      { key: 3, index: 4 },
    ]);
  });

  it('orders every item when asked for as many as there are, or more', () => {
    expect(firstInOrder([3, 1, 2], 5, byNumber)).toEqual([1, 2, 3]);
  });

  it('takes nothing when asked for none', () => {
    expect(firstInOrder([3, 1, 2], 0, byNumber)).toEqual([]);
  });

  it('leaves the items it was given in their order', () => {
    const items = [3, 1, 2, 0];

    firstInOrder(items, 2, byNumber);

    expect(items).toEqual([3, 1, 2, 0]);
  });
});
