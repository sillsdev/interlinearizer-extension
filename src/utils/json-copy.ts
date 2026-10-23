/** A deep copy of a JSON-plain value, sharing nothing with it. */
export function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
