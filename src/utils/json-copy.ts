// eslint-disable-next-line @typescript-eslint/no-explicit-any -- returns the type it was given, as JSON.parse does
function copyValue(value: unknown): any {
  // eslint-disable-next-line no-null/no-null -- JSON carries null, which is copied as itself
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    const copy = new Array(value.length);
    for (let i = 0; i < value.length; i += 1) copy[i] = copyValue(value[i]);
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
 * properties that hold `undefined`.
 */
export function jsonCopy<T>(value: T): T {
  return copyValue(value);
}
