/// <reference types="jest" />

import {
  isEmptyMultiString,
  multiStringText,
  multiStringTextByLanguage,
} from '../../utils/multi-string';

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

describe('multiStringTextByLanguage', () => {
  it('reads the entry under the tag before any related one', () => {
    expect(multiStringTextByLanguage({ en: 'light', 'en-US': 'lamp' }, 'en-US')).toBe('lamp');
  });

  it('reads the bare primary subtag for a narrower tag', () => {
    expect(multiStringTextByLanguage({ 'en-GB': 'torch', en: 'light' }, 'en-US')).toBe('light');
  });

  it('reads a narrower tag for a bare primary subtag', () => {
    expect(multiStringTextByLanguage({ fr: 'lumière', 'en-US': 'light' }, 'en')).toBe('light');
  });

  it('matches the primary subtag ignoring case', () => {
    expect(multiStringTextByLanguage({ EN: 'light' }, 'en-US')).toBe('light');
  });

  it('skips a whitespace-only entry for a related one with text', () => {
    expect(multiStringTextByLanguage({ en: ' ', 'en-GB': 'torch' }, 'en-US')).toBe('torch');
  });

  it('reads another language as empty', () => {
    expect(multiStringTextByLanguage({ fr: 'lumière' }, 'en')).toBe('');
  });

  it('reads an absent value as empty', () => {
    expect(multiStringTextByLanguage(undefined, 'en')).toBe('');
  });
});
