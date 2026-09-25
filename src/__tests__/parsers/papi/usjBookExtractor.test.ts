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

  it('keeps the first book code when the book repeats its book marker', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'XXC', content: [] },
        { type: 'book', code: 'GLO', content: [] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).bookCode).toBe('XXC');
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

  it('returns no segments when there are no verse markers', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments).toEqual([]);
  });

  it('extracts a single verse with its text', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'GEN 1:1', number: '1' },
            'In the beginning God created the heavens and the earth.',
          ],
        },
      ],
    };
    const result = extractBookFromUsj(usj, WS);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:1',
      number: '1',
      text: 'In the beginning God created the heavens and the earth.',
    });
  });

  it('captures the verse marker number string verbatim, including a range', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 1:3', number: '3-4' }, 'Combined verse text.'],
        },
      ],
    };
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses[0]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:3',
      number: '3-4',
      text: 'Combined verse text.',
    });
  });

  it('falls back to the sid-derived verse number when the marker has no number', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 1:7' }, 'Verse without a number attribute.'],
        },
      ],
    };
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses[0]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:7',
      number: '7',
      text: 'Verse without a number attribute.',
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:1',
      number: '1',
      text: 'First verse text.',
    });
    expect(verses[1]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:2',
      number: '2',
      text: 'Second verse text.',
    });
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({ kind: 'verse', sid: 'GEN 1:1', number: '1', text: '' });
    expect(verses[1]).toEqual({ kind: 'verse', sid: 'GEN 1:2', number: '2', text: 'Some text.' });
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:1',
      number: '1',
      text: 'Inline verse content.',
    });
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:31',
      number: '31',
      text: 'Last verse of chapter one.',
    });
    expect(verses[1]).toEqual({
      kind: 'verse',
      sid: 'GEN 2:1',
      number: '1',
      text: 'First verse of chapter two.',
    });
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(1);
    expect(verses[0]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:1',
      number: '1',
      text: 'In the beginning.',
    });
  });

  it('emits a heading after the verse whose text it follows', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PHP', content: [] },
        { type: 'chapter', number: '1', sid: 'PHP 1' },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'PHP 1:2', number: '2' }, 'Grace and peace to you. '],
        },
        { type: 'para', marker: 's1', content: ['Thanksgiving and Prayer'] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'PHP 1:3', number: '3' }, 'I thank my God.'],
        },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments).toEqual([
      { kind: 'verse', sid: 'PHP 1:2', number: '2', text: 'Grace and peace to you.' },
      {
        kind: 'heading',
        id: 'PHP 1:2/s1',
        verseId: 'PHP 1:2',
        verseNumber: '2',
        marker: 's1',
        charIndex: 23,
        text: 'Thanksgiving and Prayer',
      },
      { kind: 'verse', sid: 'PHP 1:3', number: '3', text: 'I thank my God.' },
    ]);
  });

  it("labels a heading with its verse marker's number where that differs from its SID", () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 1:3', number: '3-4' }, 'Combined verse text.'],
        },
        { type: 'para', marker: 's1', content: ['Heading'] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments[1]).toMatchObject({
      verseId: 'GEN 1:3',
      verseNumber: '3-4',
    });
  });

  it('splits a verse around a mid-verse heading, resuming its text as a piece of its own', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '1', sid: 'PSA 1' },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'PSA 1:1' }, 'Blessed is the man'],
        },
        { type: 'para', marker: 's1', content: ['Interlude'] },
        {
          type: 'para',
          marker: 'p',
          content: ['who walks not in the counsel of the wicked.'],
        },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments).toEqual([
      { kind: 'verse', sid: 'PSA 1:1', number: '1', text: 'Blessed is the man' },
      {
        kind: 'heading',
        id: 'PSA 1:1/s1',
        verseId: 'PSA 1:1',
        verseNumber: '1',
        marker: 's1',
        charIndex: 18,
        text: 'Interlude',
      },
      {
        kind: 'verse',
        sid: 'PSA 1:1',
        number: '1',
        text: 'who walks not in the counsel of the wicked.',
        charOffset: 19,
      },
    ]);
  });

  it('resumes a verse once after adjacent mid-verse headings, with no piece between them', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '1', sid: 'PSA 1' },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'PSA 1:1' }, 'Blessed is the man'],
        },
        { type: 'para', marker: 's1', content: ['Interlude'] },
        { type: 'para', marker: 'r', content: ['(Psalm 2)'] },
        { type: 'para', marker: 'p', content: ['who walks.'] },
      ],
    };
    expect(
      extractBookFromUsj(usj, WS).segments.map((segment) =>
        segment.kind === 'heading' ? segment.id : segment.text,
      ),
    ).toEqual(['Blessed is the man', 'PSA 1:1/s1', 'PSA 1:1/r', 'who walks.']);
  });

  it('files a heading before verse 1 under verse 0 without emitting a verse 0', () => {
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
    expect(extractBookFromUsj(usj, WS).segments).toEqual([
      {
        kind: 'heading',
        id: 'GEN 1:0/s1',
        verseId: 'GEN 1:0',
        verseNumber: '0',
        marker: 's1',
        charIndex: 0,
        text: 'The Creation',
      },
      { kind: 'verse', sid: 'GEN 1:1', number: '1', text: 'In the beginning.' },
    ]);
  });

  it('emits a heading ahead of the superscription it precedes', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '3', sid: 'PSA 3' },
        { type: 'para', marker: 's1', content: ['Morning Prayer for Help'] },
        { type: 'para', marker: 'd', content: ['A psalm by David.'] },
        { type: 'para', marker: 'q1', content: [{ type: 'verse', sid: 'PSA 3:1' }, 'Yahweh.'] },
      ],
    };
    expect(
      extractBookFromUsj(usj, WS).segments.map((segment) =>
        segment.kind === 'heading' ? segment.id : segment.sid,
      ),
    ).toEqual(['PSA 3:0/s1', 'PSA 3:0', 'PSA 3:1']);
  });

  it('gives each heading of a verse its own id, numbering a repeated marker', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'MRK', content: [] },
        { type: 'chapter', number: '1', sid: 'MRK 1' },
        { type: 'para', marker: 'p', content: [{ type: 'verse', sid: 'MRK 1:8' }, 'Spirit.'] },
        { type: 'para', marker: 'ms1', content: ['Part One'] },
        { type: 'para', marker: 'mr', content: ['(1:9–8:26)'] },
        { type: 'para', marker: 's1', content: ['The Baptism'] },
        { type: 'para', marker: 'r', content: ['(Matthew 3:13-17)'] },
        { type: 'para', marker: 's1', content: ['The Temptation'] },
        { type: 'para', marker: 'p', content: [{ type: 'verse', sid: 'MRK 1:9' }, 'Jesus came.'] },
      ],
    };
    const headingIds = extractBookFromUsj(usj, WS).segments.flatMap((segment) =>
      segment.kind === 'heading' ? [segment.id] : [],
    );
    expect(headingIds).toEqual([
      'MRK 1:8/ms1',
      'MRK 1:8/mr',
      'MRK 1:8/s1',
      'MRK 1:8/r',
      'MRK 1:8/s1#2',
    ]);
  });

  it('keeps numbering a repeated marker when an explicit verse-0 marker follows an opening heading', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '3', sid: 'PSA 3' },
        { type: 'para', marker: 's1', content: ['First'] },
        { type: 'para', marker: 'q1', content: [{ type: 'verse', sid: 'PSA 3:0' }, 'A psalm.'] },
        { type: 'para', marker: 's1', content: ['Second'] },
        { type: 'para', marker: 'q1', content: [{ type: 'verse', sid: 'PSA 3:1' }, 'Yahweh.'] },
      ],
    };
    expect(
      extractBookFromUsj(usj, WS).segments.map((segment) =>
        segment.kind === 'heading' ? segment.id : segment.sid,
      ),
    ).toEqual(['PSA 3:0/s1', 'PSA 3:0', 'PSA 3:0/s1#2', 'PSA 3:1']);
  });

  it('takes heading text from inline char nodes, skipping notes, and trims it', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'SNG', content: [] },
        { type: 'chapter', number: '1', sid: 'SNG 1' },
        {
          type: 'para',
          marker: 'sp',
          content: [
            ' The ',
            { type: 'char', marker: 'em', content: ['Beloved'] },
            { type: 'note', marker: 'f', content: ['A footnote.'] },
            { type: 'char', marker: 'em' },
            ' ',
          ],
        },
      ],
    };
    const [heading] = extractBookFromUsj(usj, WS).segments;
    expect(heading.text).toBe('The Beloved');
  });

  it('drops a heading with no text', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
        { type: 'para', marker: 's1', content: [' '] },
        { type: 'para', marker: 's2' },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments).toEqual([]);
  });

  it('drops a heading in the introduction, ahead of any chapter', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'para', marker: 's1', content: ['About This Book'] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments).toEqual([]);
  });

  it('keeps the identification line and every paragraph ahead of the first chapter as front matter', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: ['English: Genesis'] },
        { type: 'para', marker: 'mt1', content: ['Genesis'] },
        { type: 'para', marker: 'is1', content: ['Introduction'] },
        { type: 'para', marker: 'ib' },
        {
          type: 'para',
          marker: 'ip',
          content: [
            'Genesis tells of ',
            { type: 'char', marker: 'bk', content: ['beginnings'] },
            '.',
            { type: 'optbreak' },
            { type: 'note', marker: 'f', content: [' Or origins.'] },
          ],
        },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
        { type: 'para', marker: 's1', content: ['The Creation'] },
        { type: 'para', marker: 'p', content: [{ type: 'verse', sid: 'GEN 1:1' }, 'Light.'] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).frontMatter).toEqual([
      { marker: 'id', text: 'GEN English: Genesis' },
      { marker: 'mt1', text: 'Genesis' },
      { marker: 'is1', text: 'Introduction' },
      { marker: 'ib', text: '' },
      { marker: 'ip', text: 'Genesis tells of beginnings. Or origins.' },
    ]);
  });

  it('keeps an identification line with no text as its book code alone', () => {
    const usj: UsjDocument = { content: [{ type: 'book', code: 'GEN' }] };
    expect(extractBookFromUsj(usj, WS).frontMatter).toEqual([{ marker: 'id', text: 'GEN' }]);
  });

  it('leaves the paragraph carrying the first verse out of front matter when no chapter precedes it', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'para', marker: 'p', content: [{ type: 'verse', sid: 'GEN 1:1' }, 'Light.'] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).frontMatter).toEqual([{ marker: 'id', text: 'GEN' }]);
  });

  it('keeps the text ahead of the first verse in its paragraph as front matter when no chapter precedes it', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: ['Introduction. ', { type: 'verse', sid: 'GEN 1:1' }, 'Light.'],
        },
      ],
    };
    expect(extractBookFromUsj(usj, WS).frontMatter).toEqual([
      { marker: 'id', text: 'GEN' },
      { marker: 'p', text: 'Introduction.' },
    ]);
  });

  it('ends front matter at the first verse when no chapter precedes it', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'para', marker: 'q1', content: [{ type: 'verse', sid: 'GEN 1:1' }, 'Light,'] },
        { type: 'para', marker: 'q2', content: ['and more light.'] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).frontMatter).toEqual([{ marker: 'id', text: 'GEN' }]);
  });

  it('drops blank-line paragraphs', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
        { type: 'para', marker: 'p', content: [{ type: 'verse', sid: 'GEN 1:1' }, 'Light.'] },
        { type: 'para', marker: 'b', content: [] },
        { type: 'para', marker: 'ib', content: [] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments).toEqual([
      { kind: 'verse', sid: 'GEN 1:1', number: '1', text: 'Light.' },
    ]);
  });

  it('files an introduction heading within a chapter as a heading', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
        { type: 'para', marker: 'p', content: [{ type: 'verse', sid: 'GEN 1:1' }, 'Light.'] },
        { type: 'para', marker: 'is1', content: ['Stray introduction heading'] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments).toEqual([
      { kind: 'verse', sid: 'GEN 1:1', number: '1', text: 'Light.' },
      {
        kind: 'heading',
        id: 'GEN 1:1/is1',
        verseId: 'GEN 1:1',
        verseNumber: '1',
        marker: 'is1',
        charIndex: 6,
        text: 'Stray introduction heading',
      },
    ]);
  });

  it('includes text nested inside multiple levels of inline char nodes', () => {
    // The extractor's fallback recurses into any unknown node that has content, so deeply
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
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
    // The hash serialization recurses into all object properties, while the verse traversal only
    // follows `content`. Putting undefined inside an extra non-content array exercises the
    // undefined-serialized-as-null path without the traversal tripping over a non-node value.
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

  /** A book whose second `GEN 1:1` marker repeats the first, with a well-formed verse after it. */
  const duplicateVerseUsj: UsjDocument = {
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
          { type: 'verse', sid: 'GEN 1:2' },
          'And the earth.',
        ],
      },
    ],
  };

  it('keeps the first occurrence of a duplicated verse SID', () => {
    const { segments: verses } = extractBookFromUsj(duplicateVerseUsj, WS);
    expect(verses).toEqual([
      { kind: 'verse', sid: 'GEN 1:1', number: '1', text: 'First occurrence.' },
      { kind: 'verse', sid: 'GEN 1:2', number: '2', text: 'And the earth.' },
    ]);
  });

  it('reports the SID of a skipped duplicate verse marker', () => {
    expect(extractBookFromUsj(duplicateVerseUsj, WS).duplicateVerseIds).toEqual(['GEN 1:1']);
  });

  it('reports no duplicates for a well-formed book', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [{ type: 'verse', sid: 'GEN 1:1' }, 'In the beginning.'],
        },
      ],
    };
    expect(extractBookFromUsj(usj, WS).duplicateVerseIds).toEqual([]);
  });

  it('reports one entry per skipped marker when a SID repeats more than twice', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'GEN 1:1' },
            'First.',
            { type: 'verse', sid: 'GEN 1:1' },
            'Second.',
            { type: 'verse', sid: 'GEN 1:1' },
            'Third.',
          ],
        },
      ],
    };
    expect(extractBookFromUsj(usj, WS).duplicateVerseIds).toEqual(['GEN 1:1', 'GEN 1:1']);
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({
      kind: 'verse',
      sid: 'PSA 3:0',
      number: '0',
      text: 'A Psalm by David, when he fled from Absalom his son.',
    });
    expect(verses[1]).toEqual({
      kind: 'verse',
      sid: 'PSA 3:1',
      number: '1',
      text: 'Yahweh, how my adversaries have increased!',
    });
  });

  it('captures a verse 0 that ends the document with no following numbered verse', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '3', sid: 'PSA 3' },
        { type: 'para', marker: 'd', content: ['A Psalm by David.'] },
      ],
    };
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toEqual([
      { kind: 'verse', sid: 'PSA 3:0', number: '0', text: 'A Psalm by David.' },
    ]);
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toEqual([
      { kind: 'verse', sid: 'GEN 1:1', number: '1', text: 'In the beginning.' },
    ]);
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
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses).toHaveLength(2);
    expect(verses[0]).toEqual({
      kind: 'verse',
      sid: 'PSA 3:0',
      number: '0',
      text: 'A Psalm by David.',
    });
    expect(verses[1]).toEqual({
      kind: 'verse',
      sid: 'PSA 3:1',
      number: '1',
      text: 'Yahweh, how my adversaries have increased!',
    });
  });

  it('skips an explicit verse-0 marker duplicating a non-empty synthetic verse 0', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'PSA', content: [] },
        { type: 'chapter', number: '3', sid: 'PSA 3' },
        // A `d` descriptive title opens a non-empty synthetic verse 0 (PSA 3:0)...
        { type: 'para', marker: 'd', content: ['A Psalm by David.'] },
        // ...then an explicit verse-0 marker with the same SID is skipped rather than emitting a
        // second PSA 3:0 verse.
        { type: 'para', marker: 'q1', content: [{ type: 'verse', sid: 'PSA 3:0' }, 'Yahweh.'] },
      ],
    };
    const { segments: verses, duplicateVerseIds } = extractBookFromUsj(usj, WS);
    expect(verses).toEqual([
      { kind: 'verse', sid: 'PSA 3:0', number: '0', text: 'A Psalm by David.' },
    ]);
    expect(duplicateVerseIds).toEqual(['PSA 3:0']);
  });

  it('drops a heading within a skipped duplicate marker', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        { type: 'chapter', number: '1', sid: 'GEN 1' },
        { type: 'para', marker: 'p', content: [{ type: 'verse', sid: 'GEN 1:1' }, 'Light.'] },
        { type: 'para', marker: 'p', content: [{ type: 'verse', sid: 'GEN 1:1' }, 'Again.'] },
        { type: 'para', marker: 's1', content: ['Stray heading'] },
      ],
    };
    expect(extractBookFromUsj(usj, WS).segments).toEqual([
      { kind: 'verse', sid: 'GEN 1:1', number: '1', text: 'Light.' },
    ]);
  });

  it('does not fold a skipped duplicate marker’s text into the preceding verse', () => {
    const usj: UsjDocument = {
      content: [
        { type: 'book', code: 'GEN', content: [] },
        {
          type: 'para',
          marker: 'p',
          content: [
            { type: 'verse', sid: 'GEN 1:1' },
            'In the beginning.',
            { type: 'verse', sid: 'GEN 1:2' },
            'And the earth.',
            // Repeats GEN 1:1; its text must be dropped, not appended to GEN 1:2, whose token
            // offsets are already expressed against the text above.
            { type: 'verse', sid: 'GEN 1:1' },
            'Stray duplicate text.',
          ],
        },
      ],
    };
    const { segments: verses } = extractBookFromUsj(usj, WS);
    expect(verses[1]).toEqual({
      kind: 'verse',
      sid: 'GEN 1:2',
      number: '2',
      text: 'And the earth.',
    });
  });
});
