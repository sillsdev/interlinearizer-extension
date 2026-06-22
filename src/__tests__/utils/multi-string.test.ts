/** @file Unit tests for utils/multi-string.ts. */
/// <reference types="jest" />

import { isEmptyMultiString } from '../../utils/multi-string';

describe('isEmptyMultiString', () => {
  it('treats undefined as empty', () => {
    expect(isEmptyMultiString(undefined)).toBe(true);
  });

  it('treats a value with no entries as empty', () => {
    expect(isEmptyMultiString({})).toBe(true);
  });

  it('treats whitespace-only entries as empty', () => {
    expect(isEmptyMultiString({ en: '  ', fr: '\t\n' })).toBe(true);
  });

  it('treats a value with any non-whitespace entry as non-empty', () => {
    expect(isEmptyMultiString({ en: '  ', fr: 'salut' })).toBe(false);
  });
});
