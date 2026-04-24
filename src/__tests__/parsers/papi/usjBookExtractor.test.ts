/** @file Unit tests for {@link extractBookFromUsj}. */
/// <reference types="jest" />

import { extractBookFromUsj, type UsjDocument } from 'parsers/papi/usjBookExtractor';

const WS = 'en';

describe('extractBookFromUsj', () => {
  it('extracts bookCode from the book marker', () => {
    const usj: UsjDocument = {
      content: [{ type: 'book', code: 'GEN', content: [] }],
    };
    expect(extractBookFromUsj(usj, WS).bookCode).toBe('GEN');
  });

  it('sets writingSystem from the parameter', () => {
    const usj: UsjDocument = {
      content: [{ type: 'book', code: 'GEN', content: [] }],
    };
    expect(extractBookFromUsj(usj, 'kmr').writingSystem).toBe('kmr');
  });

  it('produces a stable contentHash for identical content', () => {
    const usj: UsjDocument = { content: [{ type: 'book', code: 'GEN', content: [] }] };
    expect(extractBookFromUsj(usj, WS).contentHash).toBe(extractBookFromUsj(usj, WS).contentHash);
  });

  it('produces different contentHashes for different content', () => {
    const a: UsjDocument = { content: [{ type: 'book', code: 'GEN', content: [] }] };
    const b: UsjDocument = { content: [{ type: 'book', code: 'MAT', content: [] }] };
    expect(extractBookFromUsj(a, WS).contentHash).not.toBe(extractBookFromUsj(b, WS).contentHash);
  });

  it('returns empty verses when there are no verse markers', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
      ],
    };
    expect(extractBookFromUsj(usj, WS).verses).toEqual([]);
  });

  it('extracts a single verse with its text', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'GEN 1:1' },
            'In the beginning God created the heavens and the earth.',
          ],
        },
      ],
    };
    const result = extractBookFromUsj(usj, WS);
    expect(result.verses).toHaveLength(1);
    expect(result.verses[0]).toEqual({
      sid: 'GEN 1:1',
      text: 'In the beginning God created the heavens and the earth.',
    });
  });

  it('extracts multiple verses in document order', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'GEN 1:1' },
            'First verse text.',
            { type: 'verse', sid: 'GEN 1:2' },
            'Second verse text.',
          ],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({ sid: 'GEN 1:1', text: 'First verse text.' });
    expect(verses[1]).toEqual({ sid: 'GEN 1:2', text: 'Second verse text.' });
  });

  it('accumulates text across multiple paragraphs within a verse', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        {
          type: 'para',
          marker: 'q1',
          content: [{ type: 'verse', sid: 'PSA 1:1' }, 'Blessed is the man'],
        },
        {
          type: 'para',
          marker: 'q2',
          content: ['who walks not in the counsel of the wicked.'],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0].text).toBe('Blessed is the man who walks not in the counsel of the wicked.');
  });

  it('includes text inside inline char nodes', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'JHN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'JHN 1:1' },
            'In the beginning was the ',
            { type: 'char', marker: 'nd', content: ['Word'] },
            '.',
          ],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses[0].text).toBe('In the beginning was the Word.');
  });

  it('excludes note content from verse text', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'MAT', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'MAT 1:1' },
            'The book of the genealogy',
            { type: 'note', marker: 'f', content: ['Some footnote text.'] },
            ' of Jesus Christ.',
          ],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses[0].text).toBe('The book of the genealogy of Jesus Christ.');
  });

  it('produces an empty-text RawVerse when a verse marker has no following text', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'GEN 1:1' },
            // no text before the next verse
            { type: 'verse', sid: 'GEN 1:2' },
            'Some text.',
          ],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({ sid: 'GEN 1:1', text: '' });
    expect(verses[1]).toEqual({ sid: 'GEN 1:2', text: 'Some text.' });
  });

  it('captures text nested directly inside a verse node', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 1:1', content: ['Inline verse content.'] }],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0]).toEqual({ sid: 'GEN 1:1', text: 'Inline verse content.' });
  });

  it('throws when a verse marker is missing its sid attribute', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'para', marker: 'p', content: [{ type: 'verse' }] },
      ],
    };
    expect(() => extractBookFromUsj(usj, WS)).toThrow(
      'verse marker missing required sid attribute',
    );
  });

  it('throws when no book marker with a code attribute is found', () => {
    const usj: UsjDocument = { content: [{ type: 'para', content: ['Some text.'] }] };
    expect(() => extractBookFromUsj(usj, WS)).toThrow('no book marker');
  });

  it('flushes an open verse when a chapter boundary is crossed', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 1:31' }, 'Last verse of chapter one.'],
        },
        { type: 'chapter', number: '2', sid: 'GEN 2' },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 2:1' }, 'First verse of chapter two.'],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({ sid: 'GEN 1:31', text: 'Last verse of chapter one.' });
    expect(verses[1]).toEqual({ sid: 'GEN 2:1', text: 'First verse of chapter two.' });
  });

  it('traverses content nested directly inside a chapter node', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'chapter',
          number: '1',
          sid: 'GEN 1',
          content: [
            {
              type: 'para',
              marker: 'p',
              content: [{ type: 'verse', sid: 'GEN 1:1' }, 'In the beginning.'],
            },
          ],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0]).toEqual({ sid: 'GEN 1:1', text: 'In the beginning.' });
  });
});
