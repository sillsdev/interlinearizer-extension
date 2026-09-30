/// <reference types="jest" />

import { isEmptyMultiString, multiStringText } from '../../utils/multi-string';

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

describe('multiStringText', () => {
  it('reads the entry under the tag', () => {
    expect(multiStringText({ en: 'light', fr: 'lumière' }, 'fr')).toBe('lumière');
  });

  it('reads no entry under the tag as empty', () => {
    expect(multiStringText({ en: 'light' }, 'fr')).toBe('');
  });

  it('reads an absent value as empty', () => {
    expect(multiStringText(undefined, 'en')).toBe('');
  });

  it('reads a whitespace-only entry as empty', () => {
    expect(multiStringText({ en: '  ' }, 'en')).toBe('');
  });
});
