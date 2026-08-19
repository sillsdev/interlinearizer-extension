/// <reference types="jest" />

import { resolveGlossLanguageTag } from '../../../converters/pt9/glossLanguageTags';

describe('resolveGlossLanguageTag', () => {
  it.each([
    ['en', 'en'],
    ['EN', 'en'],
    ['grc', 'grc'],
    ['kmr-latn', 'kmr-Latn'],
    ['KMR-LATN', 'kmr-Latn'],
    ['en-us', 'en-US'],
    ['zh-hans-cn', 'zh-Hans-CN'],
    ['en-x-priv8', 'en-x-priv8'],
  ])('normalizes valid tag "%s" to "%s"', (raw, tag) => {
    expect(resolveGlossLanguageTag(raw)).toStrictEqual({ tag, isFallback: false });
  });

  it.each(['English', 'UpperEnglish', 'e', '', 'en-', 'en--US', '123', 'en-toolongsubtag1'])(
    'passes invalid value "%s" through verbatim as a fallback',
    (raw) => {
      expect(resolveGlossLanguageTag(raw)).toStrictEqual({ tag: raw, isFallback: true });
    },
  );
});
