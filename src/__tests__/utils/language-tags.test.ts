/// <reference types="jest" />

import { collatorForTag, languageNameForTag } from '../../utils/language-tags';

describe('collatorForTag', () => {
  it('collates under the tag it is given', () => {
    // Swedish sorts "ä" after "z", which the default locale does not, so the tag demonstrably
    // reached the collator rather than being dropped.
    expect(collatorForTag('sv').compare('ä', 'z')).toBeGreaterThan(0);
  });

  it('falls back to the default collation for a tag Intl rejects', () => {
    // Underscores instead of hyphens is the classic hand-typed tag, and `Intl` throws on it.
    expect(() => collatorForTag('en_US')).not.toThrow();
    expect(collatorForTag('en_US').compare('a', 'b')).toBeLessThan(0);
  });
});

describe('languageNameForTag', () => {
  it('names the language a tag stands for', () => {
    // Held against the tag rather than against a spelling: the name comes back in whatever
    // language the host is running in, which a test cannot pin.
    expect(languageNameForTag('fr')).not.toBe('fr');
  });

  it('gives back a tag naming no language it knows', () => {
    // The private-use range every unlisted language is assigned from, so no host has a name for it.
    expect(languageNameForTag('qaa')).toBe('qaa');
  });

  it('gives back a tag Intl rejects', () => {
    expect(languageNameForTag('en_US')).toBe('en_US');
  });
});
