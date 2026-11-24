/**
 * The first `count` of `items` in the order `compare` gives, which must be a total order. Costs
 * about as many comparisons as there are items, rather than the many more a whole sort costs, when
 * `count` is small.
 */
export function firstInOrder<T>(
  items: readonly T[],
  count: number,
  compare: (a: T, b: T) => number,
): T[] {
  if (count >= items.length) return items.toSorted(compare);
  if (count <= 0) return [];
  const work = [...items];
  let low = 0;
  let high = work.length - 1;
  // Quickselect: partitions until the `count` smallest items fill the front, in no order.
  while (low < high) {
    const pivot = work[low + Math.floor((high - low) / 2)];
    let i = low;
    let j = high;
    while (i <= j) {
      while (compare(work[i], pivot) < 0) i += 1;
      while (compare(work[j], pivot) > 0) j -= 1;
      if (i <= j) {
        [work[i], work[j]] = [work[j], work[i]];
        i += 1;
        j -= 1;
      }
    }
    if (count - 1 <= j) high = j;
    else if (count - 1 >= i) low = i;
    else break;
  }
  return work.slice(0, count).sort(compare);
}
