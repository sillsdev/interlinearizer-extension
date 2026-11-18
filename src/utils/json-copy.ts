// eslint-disable-next-line @typescript-eslint/no-explicit-any -- returns the type it was given, as JSON.parse does
function copyValue(value: unknown): any {
  // eslint-disable-next-line no-null/no-null -- JSON carries null, which is copied as itself
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    const copy = new Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      const item: unknown = value[i];
      // eslint-disable-next-line no-null/no-null -- JSON writes undefined array entries and holes as null
      copy[i] = item === undefined ? null : copyValue(item);
    }
    return copy;
  }
  const copy: Record<string, unknown> = {};
  // eslint-disable-next-line no-restricted-syntax -- for...in skips building an entries array per object
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      const property: unknown = Reflect.get(value, key);
      // Assigning `__proto__` would set the copy's prototype rather than an own property.
      if (property !== undefined && key === '__proto__') {
        Object.defineProperty(copy, key, {
          value: copyValue(property),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else if (property !== undefined) copy[key] = copyValue(property);
    }
  }
  return copy;
}

/**
 * A deep copy of a JSON-plain value, sharing nothing with it. Like a JSON round trip, it leaves out
 * properties that hold `undefined`, and it writes `undefined` array entries and holes as `null`.
 *
 * Unlike a JSON round trip, it ignores `toJSON`, so a `Date` copies as `{}`. It also keeps
 * non-finite numbers and functions, which JSON would write as `null` or leave out.
 */
export function jsonCopy<T>(value: T): T {
  return copyValue(value);
}
