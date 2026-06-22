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

  it('produces the same contentHash for identical content with different writingSystems', () => {
    const a: UsjDocument = { content: [{ type: 'book', code: 'GEN', content: [] }] };
    const b: UsjDocument = { content: [...a.content] };
    expect(extractBookFromUsj(a, 'en').contentHash).toBe(extractBookFromUsj(b, 'es').contentHash);
  });

  it('produces a different contentHash for different content', () => {
    const a: UsjDocument = { content: [{ type: 'book', code: 'GEN', content: [] }] };
    const c: UsjDocument = { content: [{ type: 'book', code: 'MAT', content: [] }] };
    expect(extractBookFromUsj(a, WS).contentHash).not.toBe(extractBookFromUsj(c, WS).contentHash);
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

  it('skips content of heading para markers encountered inside a verse', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'PSA 119:176' }, 'I have gone astray'],
        },
        { type: 'para', marker: 's1', content: ['A section heading'] },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0].text).toBe('I have gone astray');
  });

  it('skips text inside a heading para marker that appears mid-verse (before the verse is closed)', () => {
    // An s1 heading node that arrives while a verse is still open must not contribute its text.
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'PSA 1:1' }, 'Blessed is the man'],
        },
        // s1 heading arrives while PSA 1:1 is still the currentVerse
        { type: 'para', marker: 's1', content: ['Interlude'] },
        {
          type: 'para',
          marker: 'p',
          content: ['who walks not in the counsel of the wicked.'],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0].text).toBe('Blessed is the man who walks not in the counsel of the wicked.');
  });

  it('includes text nested inside multiple levels of inline char nodes', () => {
    // The traverse fallback recurses into any unknown node that has content, so deeply
    // nested char nodes must still contribute their text.
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'JHN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'JHN 1:14' },
            'And the ',
            {
              type: 'char',
              marker: 'em',
              content: [
                {
                  type: 'char',
                  marker: 'nd',
                  content: ['Word'],
                },
              ],
            },
            ' became flesh.',
          ],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0].text).toBe('And the Word became flesh.');
  });

  it('produces a stable contentHash when a node has an optional property explicitly set to undefined', () => {
    const withUndefined: UsjDocument = {
      content: [{ type: 'book', code: 'GEN', marker: undefined, content: [] }],
    };
    const withoutUndefined: UsjDocument = {
      content: [{ type: 'book', code: 'GEN', content: [] }],
    };

    const hash = extractBookFromUsj(withUndefined, WS).contentHash;
    expect(hash).toBe(extractBookFromUsj(withoutUndefined, WS).contentHash);
  });

  it('treats undefined array elements the same as null when computing contentHash', () => {
    // stableStringify recurses into all object properties; traverse only follows .content.
    // Putting undefined inside an extra non-content array lets us exercise the
    // `if (value === undefined) return 'null'` path without crashing traverse.
    type UsjDocumentWithExtra = {
      content: (UsjDocument['content'][number] & { extra?: (undefined | null)[] })[];
    };
    const withUndefined: UsjDocumentWithExtra = {
      content: [{ type: 'book', code: 'GEN', content: [], extra: [undefined] }],
    };
    const withNull: UsjDocumentWithExtra = {
      // eslint-disable-next-line no-null/no-null
      content: [{ type: 'book', code: 'GEN', content: [], extra: [null] }],
    };

    expect(extractBookFromUsj(withUndefined, WS).contentHash).toBe(
      extractBookFromUsj(withNull, WS).contentHash,
    );
  });

  it('throws on a duplicate verse SID', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'GEN 1:1' },
            'First occurrence.',
            { type: 'verse', sid: 'GEN 1:1' },
            'Duplicate.',
          ],
        },
      ],
    };
    expect(() => extractBookFromUsj(usj, WS)).toThrow('duplicate verse SID "GEN 1:1"');
  });

  it('captures a d descriptive title before verse 1 as verse 0', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '3', sid: 'PSA 3' },
        {
          type: 'para',
          marker: 'd',
          content: ['A Psalm by David, when he fled from Absalom his son.'],
        },
        {
          type: 'para',
          marker: 'q1',
          content: [
            { type: 'verse', sid: 'PSA 3:1' },
            'Yahweh, how my adversaries have increased!',
          ],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({
      sid: 'PSA 3:0',
      text: 'A Psalm by David, when he fled from Absalom his son.',
    });
    expect(verses[1]).toEqual({
      sid: 'PSA 3:1',
      text: 'Yahweh, how my adversaries have increased!',
    });
  });

  it('does not emit a verse 0 when only a section heading precedes verse 1', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
        { type: 'para', marker: 's1', content: ['The Creation'] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 1:1' }, 'In the beginning.'],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0]).toEqual({ sid: 'GEN 1:1', text: 'In the beginning.' });
  });

  it('captures a verse 0 that ends the document with no following numbered verse', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '3', sid: 'PSA 3' },
        { type: 'para', marker: 'd', content: ['A Psalm by David.'] },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toEqual([{ sid: 'PSA 3:0', text: 'A Psalm by David.' }]);
  });

  it('does not open a verse 0 scope for a chapter node without a number', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        // A chapter node missing its number cannot name a verse-0 SID, so pre-verse content is
        // dropped rather than captured.
        { type: 'chapter', sid: 'GEN 1' },
        { type: 'para', marker: 'd', content: ['Stray title.'] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 1:1' }, 'In the beginning.'],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toEqual([{ sid: 'GEN 1:1', text: 'In the beginning.' }]);
  });

  it('captures an explicit verse-0 marker as verse 0', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '3', sid: 'PSA 3' },
        {
          type: 'para',
          marker: 'q1',
          content: [
            { type: 'verse', sid: 'PSA 3:0' },
            'A Psalm by David.',
            { type: 'verse', sid: 'PSA 3:1' },
            'Yahweh, how my adversaries have increased!',
          ],
        },
      ],
    };
    const { verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({ sid: 'PSA 3:0', text: 'A Psalm by David.' });
    expect(verses[1]).toEqual({
      sid: 'PSA 3:1',
      text: 'Yahweh, how my adversaries have increased!',
    });
  });
});
