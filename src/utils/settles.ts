/** A value now, or a promise of one later. */
export type Settles<T> = T | Promise<T>;

/**
 * Calls `then` with `value` immediately, or with what `value` resolves to when it is a promise. A
 * promise that rejects calls nothing; whoever made it reports the failure.
 *
 * @returns When `value` is a promise, one that resolves once `then` has run or `value` has
 *   rejected.
 */
export function whenSettled<T>(
  value: Settles<T>,
  then: (settled: T) => void,
): Promise<void> | void {
  if (!(value instanceof Promise)) {
    then(value);
    return undefined;
  }
  return value.then(then, () => {});
}
