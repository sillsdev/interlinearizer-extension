/// <reference types="jest" />

import {
  composeLexemeKeyId,
  LexemeKeyData,
  lexemeKeysEqual,
  parseLexemeKeyId,
} from 'parsers/pt9/lexemeKey';

describe('parseLexemeKeyId', () => {
  it('parses a plain id with no homograph suffix', () => {
    expect(parseLexemeKeyId('Word:hello')).toStrictEqual({ Type: 'Word', Form: 'hello' });
  });

  it('parses a trailing :digits segment as the homograph', () => {
    expect(parseLexemeKeyId('Word:a:2')).toStrictEqual({ Type: 'Word', Form: 'a', Homograph: 2 });
  });

  it('parses an explicit :1 suffix as homograph 1', () => {
    expect(parseLexemeKeyId('Word:a:1')).toStrictEqual({ Type: 'Word', Form: 'a', Homograph: 1 });
  });

  it('keeps interior colons in the form and reads only the trailing digits as homograph', () => {
    expect(parseLexemeKeyId('Stem:foo:bar:3')).toStrictEqual({
      Type: 'Stem',
      Form: 'foo:bar',
      Homograph: 3,
    });
  });

  it('keeps a non-digit trailing segment in the form', () => {
    expect(parseLexemeKeyId('Word:a:b')).toStrictEqual({ Type: 'Word', Form: 'a:b' });
  });

  it('parses an empty form', () => {
    expect(parseLexemeKeyId('Word:')).toStrictEqual({ Type: 'Word', Form: '' });
  });

  it('parses a form containing spaces (phrase lexemes)', () => {
    expect(parseLexemeKeyId('Phrase:hello world')).toStrictEqual({
      Type: 'Phrase',
      Form: 'hello world',
    });
  });

  it.each(['hello', '', ':x', 'Word-x'])('returns undefined for non-matching id "%s"', (id) => {
    expect(parseLexemeKeyId(id)).toBeUndefined();
  });
});

describe('composeLexemeKeyId', () => {
  it('omits an absent homograph', () => {
    expect(composeLexemeKeyId({ Type: 'Word', Form: 'hello' })).toBe('Word:hello');
  });

  it('omits homograph 1', () => {
    expect(composeLexemeKeyId({ Type: 'Word', Form: 'hello', Homograph: 1 })).toBe('Word:hello');
  });

  it('appends a homograph greater than 1', () => {
    expect(composeLexemeKeyId({ Type: 'Word', Form: 'a', Homograph: 2 })).toBe('Word:a:2');
  });

  it('produces an id that re-parses with a :digits form tail read as the homograph', () => {
    const key: LexemeKeyData = { Type: 'Word', Form: 'a:1' };
    expect(parseLexemeKeyId(composeLexemeKeyId(key))).toStrictEqual({
      Type: 'Word',
      Form: 'a',
      Homograph: 1,
    });
  });
});

describe('lexemeKeysEqual', () => {
  it('treats identical keys as equal', () => {
    expect(
      lexemeKeysEqual(
        { Type: 'Word', Form: 'a', Homograph: 2 },
        { Type: 'Word', Form: 'a', Homograph: 2 },
      ),
    ).toBe(true);
  });

  it('treats an absent homograph as homograph 1 on either side', () => {
    expect(
      lexemeKeysEqual({ Type: 'Word', Form: 'a' }, { Type: 'Word', Form: 'a', Homograph: 1 }),
    ).toBe(true);
    expect(
      lexemeKeysEqual({ Type: 'Word', Form: 'a', Homograph: 1 }, { Type: 'Word', Form: 'a' }),
    ).toBe(true);
  });

  it('distinguishes types', () => {
    expect(lexemeKeysEqual({ Type: 'Word', Form: 'a' }, { Type: 'Stem', Form: 'a' })).toBe(false);
  });

  it('distinguishes forms', () => {
    expect(lexemeKeysEqual({ Type: 'Word', Form: 'a' }, { Type: 'Word', Form: 'b' })).toBe(false);
  });

  it('distinguishes homographs', () => {
    expect(
      lexemeKeysEqual({ Type: 'Word', Form: 'a' }, { Type: 'Word', Form: 'a', Homograph: 2 }),
    ).toBe(false);
  });
});
