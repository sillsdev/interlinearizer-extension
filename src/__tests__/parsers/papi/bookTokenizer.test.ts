/** @file Unit tests for {@link tokenizeBook}. */
/// <reference types="jest" />

import { tokenizeBook } from 'parsers/papi/bookTokenizer';
import type { RawBook } from 'parsers/papi/usjBookExtractor';

function makeRawBook(verses: { sid: string; text: string }[]): RawBook {
  return { bookCode: 'GEN', writingSystem: 'en', contentHash: 'abc123', verses };
}

describe('tokenizeBook', () => {
  it('maps bookCode, contentHash, and writingSystem onto the Book', () => {
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
    expect(segments[0].tokens.every((t) => t.type === 'word')).toBe(true);
  });

  it('labels punctuation tokens as punctuation', () => {
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text: '., ;!' }]));
    expect(segments[0].tokens.every((t) => t.type === 'punctuation')).toBe(true);
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

  it('assigns unique IDs within a segment', () => {
    const text = 'A B C.';
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    const ids = segments[0].tokens.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns unique IDs across segments', () => {
    const raw = makeRawBook([
      { sid: 'GEN 1:1', text: 'Word.' },
      { sid: 'GEN 1:2', text: 'Word.' },
    ]);
    const allIds = tokenizeBook(raw).segments.flatMap((s) => s.tokens.map((t) => t.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('assigns writingSystem to every token', () => {
    const raw: RawBook = {
      ...makeRawBook([{ sid: 'GEN 1:1', text: 'Hello.' }]),
      writingSystem: 'kmr',
    };
    const { segments } = tokenizeBook(raw);
    expect(segments[0].tokens.every((t) => t.writingSystem === 'kmr')).toBe(true);
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
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    expect(segments[0].tokens).toHaveLength(1);
    expect(segments[0].tokens[0].type).toBe('word');
    expect(segments[0].tokens[0].surfaceText).toBe('ñ');
  });

  it('throws on an invalid verse SID', () => {
    expect(() => tokenizeBook(makeRawBook([{ sid: 'not-a-ref', text: 'text' }]))).toThrow(
      'Invalid verse SID',
    );
  });

  it('classifies astral-plane letters (surrogate pairs) as word tokens', () => {
    // Gothic letters U+10330–U+1034F are outside the BMP; each code point is two UTF-16 code
    // units. Testing surfaceText[0] (a lone surrogate) against WORD_START_RE would fail — the
    // fix is to test the full surfaceText string.
    const text = '𐌰𐌱𐌲';
    const { segments } = tokenizeBook(makeRawBook([{ sid: 'GEN 1:1', text }]));
    expect(segments[0].tokens).toHaveLength(1);
    expect(segments[0].tokens[0].type).toBe('word');
    expect(segments[0].tokens[0].surfaceText).toBe(text);
  });
});
