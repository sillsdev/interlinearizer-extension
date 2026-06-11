/** @file Unit tests for {@link tokenizeBook}. */
/// <reference types="jest" />

import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import type { RawBook } from 'parsers/papi/usjBookExtractor';

/**
 * Builds a minimal RawBook fixture for GEN with the given verses.
 *
 * @param verses - Array of verse objects (sid + text) to include in the book.
 * @returns A RawBook with fixed bookCode, writingSystem, and contentHash.
 */
function makeRawBook(verses: { sid: string; text: string }[]): RawBook {
  return { bookCode: 'GEN', writingSystem: 'en', contentHash: 'abc123', verses };
}

describe('tokenizeBook', () => {
  it('maps bookCode and contentHash onto the Book', () => {
    const raw = makeRawBook([]);
    const book = tokenizeBook(raw);
    expect(book.bookRef).toBe('GEN');
    expect(book.id).toBe('GEN');
    expect(book.textVersion).toBe('abc123');
  });

  it('produces no segments when there are no verses', () => {
    expect(tokenizeBook(makeRawBook([])).segments).toEqual([]);
  });

  it('produces one segment per verse in order', () => {
    const raw = makeRawBook([
      { sid: 'GEN 1:1', text: 'First.' },
      { sid: 'GEN 1:2', text: 'Second.' },
    ]);
    const { segments } = tokenizeBook(raw);
    expect(segments).toHaveLength(2);
    expect(segments[0].id).toBe('GEN 1:1');
    expect(segments[1].id).toBe('GEN 1:2');
  });

  it('sets baselineText to the raw verse text', () => {
    const text = 'In the beginning God created the heavens and the earth.';
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    expect(segments[0].baselineText).toBe(text);
  });

  it('sets startRef and endRef from the verse SID', () => {
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: 'Hello.' }]));
    expect(segments[0].startRef).toEqual({ book: 'GEN', chapter: 1, verse: 1 });
    expect(segments[0].endRef).toEqual({ book: 'GEN', chapter: 1, verse: 1 });
  });

  it('upholds the charStart/charEnd invariant for every token', () => {
    const text = 'In the beginning, God created.';
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    segments[0].tokens.forEach((token) =>
      expect(text.slice(token.charStart, token.charEnd)).toBe(token.surfaceText),
    );
  });

  it('labels word tokens as word', () => {
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: 'Hello world' }]));
    const { tokens } = segments[0];
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.type === 'word')).toBe(true);
  });

  it('labels punctuation tokens as punctuation', () => {
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: '., ;!' }]));
    const { tokens } = segments[0];
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.type === 'punctuation')).toBe(true);
  });

  it('produces mixed word and punctuation tokens in the correct order', () => {
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: 'Hello, world.' }]));
    const types = segments[0].tokens.map((t) => t.type);
    expect(types).toEqual(['word', 'punctuation', 'word', 'punctuation']);
  });

  it('does not produce tokens for whitespace', () => {
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: '   ' }]));
    expect(segments[0].tokens).toEqual([]);
  });

  it('gives every token a unique ref that can be used to look it up', () => {
    const text = 'A B C.';
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    const { tokens } = segments[0];
    // Refs must be unique so each token can be referenced unambiguously.
    const refs = tokens.map((t) => t.ref);
    expect(new Set(refs).size).toBe(refs.length);
    // Each token must be retrievable by its ref.
    refs.forEach((ref, i) => {
      expect(tokens.find((t) => t.ref === ref)).toBe(tokens[i]);
    });
  });

  it('assigns unique refs across segments', () => {
    const raw = makeRawBook([
      { sid: 'GEN 1:1', text: 'Word.' },
      { sid: 'GEN 1:2', text: 'Word.' },
    ]);
    const book = tokenizeBook(raw);
    // Each token ref must start with its segment's id (the SID).
    book.segments.forEach((s) => {
      s.tokens.forEach((t) => {
        expect(t.ref.startsWith(s.id)).toBe(true);
      });
    });
    // All token refs across all segments must be globally unique.
    const refs = book.segments.flatMap((s) => s.tokens.map((t) => t.ref));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('assigns writingSystem to every token', () => {
    const raw: RawBook = {
      ...makeRawBook([{ sid: 'GEN 1:1', text: 'Hello.' }]),
      writingSystem: 'kmr',
    };
    const { segments } = tokenizeBook(raw);
    const { tokens } = segments[0];
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.writingSystem === 'kmr')).toBe(true);
  });

  it('produces an empty token list for an empty verse', () => {
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: '' }]));
    expect(segments[0].tokens).toEqual([]);
  });

  it('handles Unicode letters (non-ASCII word characters)', () => {
    const text = 'Ελληνικά.';
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    const wordTokens = segments[0].tokens.filter((t) => t.type === 'word');
    const punctTokens = segments[0].tokens.filter((t) => t.type === 'punctuation');
    expect(wordTokens).toHaveLength(1);
    expect(wordTokens[0].surfaceText).toBe('Ελληνικά');
    expect(punctTokens).toHaveLength(1);
    expect(punctTokens[0].surfaceText).toBe('.');
    expect(punctTokens[0].type).toBe('punctuation');
  });

  it('treats a combining-mark sequence as a single word token', () => {
    // 'ñ' is the letter n followed by a combining tilde (U+0303).
    // The \p{M} branch of TOKEN_RE must match the combining mark so the whole
    // sequence is captured as one token rather than split.
    const text = 'ñ';
    expect(text.length).toBe(2); // n (U+006E) + combining tilde (U+0303)
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    expect(segments[0].tokens).toHaveLength(1);
    expect(segments[0].tokens[0].type).toBe('word');
    expect(segments[0].tokens[0].surfaceText).toBe('ñ');
  });

  it('throws when a verse SID book code does not match rawBook.bookCode', () => {
    const raw: RawBook = { ...makeRawBook([{ sid: 'EXO 1:1', text: 'text' }]), bookCode: 'GEN' };
    expect(() => tokenizeBook(raw)).toThrow(
      expect.objectContaining({
        name: 'SyntaxError',
        message: expect.stringContaining('does not match book code'),
      }),
    );
  });

  it.each(['GEN 1:', 'not-a-ref', ''])('throws on malformed verse SID "%s"', (sid) => {
    expect(() => tokenizeBook(makeRawBook([{ sid, text: 'text' }]))).toThrow(SyntaxError);
  });

  describe('word-internal joiners', () => {
    it("tokenizes don't (ASCII apostrophe) as a single word token", () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: "don't" }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe("don't");
    });

    it('tokenizes don’t (U+2019 right single quote) as a single word token', () => {
      const text = 'don’t';
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe(text);
    });

    it("tokenizes l'homme as a single word token", () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: "l'homme" }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe("l'homme");
    });

    it('tokenizes well-known as a single word token', () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: 'well-known' }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe('well-known');
    });

    it('tokenizes "it\'s well-known" as two word tokens', () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: "it's well-known" }]));
      const wordTokens = segments[0].tokens.filter((t) => t.type === 'word');
      expect(wordTokens).toHaveLength(2);
      expect(wordTokens[0].surfaceText).toBe("it's");
      expect(wordTokens[1].surfaceText).toBe('well-known');
    });

    it("tokenizes 'hello' as a single word token (both leading and trailing apostrophes absorbed)", () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: "'hello'" }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe("'hello'");
    });

    it('tokenizes a standalone apostrophe as punctuation (no following word character)', () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: "'" }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('punctuation');
    });

    it("tokenizes word-initial U+0027 as part of the word (e.g. Hebrew aleph romanization 'Elohim)", () => {
      const text = "'Elohim";
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe(text);
    });

    it('tokenizes word-initial U+2019 as part of the word', () => {
      const text = '’Elohim';
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe(text);
    });

    it("tokenizes word-final U+0027 as part of the word (e.g. Hebrew aleph romanization bara')", () => {
      const text = "bara'";
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe(text);
    });

    it('tokenizes word-final U+2019 as part of the word (e.g. Hebrew aleph romanization bara’)', () => {
      const text = 'bara’';
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe(text);
    });
    it('tokenizes U+02BC (modifier letter apostrophe) as a word character regardless of position', () => {
      // U+02BC is \p{L} so it is inherently a word character — no special handling needed.
      const text = 'ʼelohim';
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe(text);
    });

    it('tokenizes end- as word then punctuation (trailing joiner is not absorbed)', () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: 'end-' }]));
      expect(segments[0].tokens).toHaveLength(2);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe('end');
      expect(segments[0].tokens[1].type).toBe('punctuation');
      expect(segments[0].tokens[1].surfaceText).toBe('-');
    });

    it('tokenizes -start as punctuation then word (leading joiner is not absorbed)', () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: '-start' }]));
      expect(segments[0].tokens).toHaveLength(2);
      expect(segments[0].tokens[0].type).toBe('punctuation');
      expect(segments[0].tokens[0].surfaceText).toBe('-');
      expect(segments[0].tokens[1].type).toBe('word');
      expect(segments[0].tokens[1].surfaceText).toBe('start');
    });

    // Double joiners between word chars are absorbed greedily: a--b → one token "a--b".
    it('tokenizes a--b as a single word token (greedy double-joiner absorption)', () => {
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: 'a--b' }]));
      expect(segments[0].tokens).toHaveLength(1);
      expect(segments[0].tokens[0].type).toBe('word');
      expect(segments[0].tokens[0].surfaceText).toBe('a--b');
    });

    it('upholds the charStart/charEnd invariant for joiner-containing tokens', () => {
      const text = "it's well-known, don’t you think?";
      const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
      segments[0].tokens.forEach((token) =>
        expect(text.slice(token.charStart, token.charEnd)).toBe(token.surfaceText),
      );
    });
  });

  it('classifies astral-plane letters (surrogate pairs) as word tokens', () => {
    // Gothic letters U+10330–U+1034F are outside the BMP; each code point is two UTF-16 code
    // units. Testing surfaceText[0] (a lone surrogate) against WORD_CONTAIN_RE would fail — the
    // fix is to test the full surfaceText string.
    const text = '𐌰𐌱𐌲';
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    expect(segments[0].tokens).toHaveLength(1);
    expect(segments[0].tokens[0].type).toBe('word');
    expect(segments[0].tokens[0].surfaceText).toBe(text);
  });
});
