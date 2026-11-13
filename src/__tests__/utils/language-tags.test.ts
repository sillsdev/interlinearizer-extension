/// <reference types="jest" />

import {
  collatorForTag,
  languageNameForTag,
  parseLanguageTags,
  readLanguageCode,
} from '../../utils/language-tags';

describe('parseLanguageTags', () => {
  it('keeps a repeated tag only where it first appears', () => {
    expect(parseLanguageTags('en, fr, en')).toEqual(['en', 'fr']);
  });
});

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

  it('names the language in the interface languages it is given', () => {
    expect(languageNameForTag('fr', ['es'])).toBe('francés');
  });

  it('names the language in a usable interface language behind one Intl rejects', () => {
    // `Intl` rejects a whole list for any one entry it cannot parse, where the platform resolves a
    // localized string by walking past the locales it has nothing for — so dropping the list would
    // read a name in one language beside a label resolved in another.
    expect(languageNameForTag('fr', ['en_US', 'es'])).toBe('francés');
  });

  it('names the language anyway when every interface language is one Intl rejects', () => {
    // Losing the language a name is read in costs less than losing the name.
    expect(languageNameForTag('fr', ['en_US'])).not.toBe('fr');
  });

  it('gives back a tag naming no language it knows', () => {
    // The private-use range every unlisted language is assigned from, so no host has a name for it.
    expect(languageNameForTag('qaa')).toBe('qaa');
  });

  it('gives back a tag Intl rejects', () => {
    expect(languageNameForTag('en_US')).toBe('en_US');
  });
});

describe('readLanguageCode', () => {
  it('reads a well-formed code in its canonical form', () => {
    expect(readLanguageCode(' EN-us ', [])).toBe('en-US');
  });

  it('reads a code matching a known tag apart from case or form as that tag', () => {
    expect(readLanguageCode('EN', ['fr', 'En'])).toBe('En');
    expect(readLanguageCode('en-us', ['en-us'])).toBe('en-us');
  });

  it('reads a code whose canonical form matches a known tag as that tag', () => {
    expect(readLanguageCode('he', ['iw'])).toBe('iw');
  });

  it('reads a new code past a known tag that is not well formed', () => {
    expect(readLanguageCode('fr', ['en_US'])).toBe('fr');
  });

  it('reads a known tag that is not well formed as that tag', () => {
    expect(readLanguageCode('EN_us', ['en_US'])).toBe('en_US');
  });

  it.each(['', '   ', 'not a tag', 'en_US'])('reads %p as no code', (input) => {
    expect(readLanguageCode(input, [])).toBeUndefined();
  });
});
