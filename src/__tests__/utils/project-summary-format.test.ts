/// <reference types="jest" />

import {
  compareUpdatedAtDescending,
  formatModified,
  parseUpdatedAt,
} from '../../utils/project-summary-format';

describe('parseUpdatedAt', () => {
  it('parses a valid ISO 8601 timestamp to epoch milliseconds', () => {
    expect(parseUpdatedAt('2026-01-15T10:30:00.000Z')).toBe(Date.parse('2026-01-15T10:30:00.000Z'));
  });

  it('normalizes an unparsable timestamp to 0 rather than NaN', () => {
    // The summary type guard only checks that updatedAt is a string, so a corrupted value must not
    // leak NaN into the sort comparator (which would make its result undefined).
    expect(parseUpdatedAt('not-a-real-date')).toBe(0);
  });
});

describe('compareUpdatedAtDescending', () => {
  const older = '2026-01-15T10:30:00.000Z';
  const newer = '2026-02-01T08:00:00.000Z';

  it('sorts the newer timestamp first (negative when a is newer than b)', () => {
    expect(compareUpdatedAtDescending(newer, older)).toBeLessThan(0);
  });

  it('sorts the older timestamp last (positive when a is older than b)', () => {
    expect(compareUpdatedAtDescending(older, newer)).toBeGreaterThan(0);
  });

  it('treats equal timestamps as equal (0) so both entries keep their places', () => {
    expect(compareUpdatedAtDescending(older, older)).toBe(0);
  });

  it('sorts a corrupted (unparsable) timestamp after a valid one instead of yielding NaN', () => {
    // Corrupted normalizes to 0, so a valid date always sorts ahead of it.
    expect(compareUpdatedAtDescending(older, 'not-a-real-date')).toBeLessThan(0);
    expect(compareUpdatedAtDescending('not-a-real-date', older)).toBeGreaterThan(0);
  });
});

describe('formatModified', () => {
  it('prefixes the locale-formatted timestamp with the given label', () => {
    const updatedAt = '2026-01-15T10:30:00.000Z';
    expect(formatModified('Modified', updatedAt)).toBe(
      `Modified ${new Date(updatedAt).toLocaleString()}`,
    );
  });
});
