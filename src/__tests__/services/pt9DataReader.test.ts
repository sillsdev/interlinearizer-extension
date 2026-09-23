/// <reference types="jest" />

import type { Pt9InterlinearProjectData, Pt9InterlinearSetup } from 'platform-scripture';
import {
  groupPt9ReadsByCeiling,
  readPt9InterlinearData,
  type Pt9InterlinearReadFile,
} from '../../services/pt9DataReader';

/** A ceiling large enough that grouping never splits, unless a test says otherwise. */
const ROOMY = 1_000_000;

/** An empty payload, for a response that carries no file of its own. */
function emptyPayload(): Pt9InterlinearProjectData {
  return {
    setups: [],
    books: [],
    lexicon: undefined,
    wordAnalyses: [],
    hasAssociatedLexicalProject: false,
  };
}

/** One book, identified by the file it was parsed from. */
function bookAt(filePath: string, bookId: string): Pt9InterlinearProjectData['books'][number] {
  return { glossLanguage: 'en', bookId, verses: [], filePath, isCanonicalPath: true };
}

/** A setup naming its language, so responses can be told apart. */
function setupFor(languageId: string): Pt9InterlinearSetup {
  return {
    type: 'Glossing',
    languageId,
    fontSize: 12,
    rightToLeft: false,
    modelIsResource: false,
    relatedLanguages: false,
    exportOnApprove: false,
  };
}

/** Built per test, so nothing one test mutates can reach the next. */
function wholeProject(): Pt9InterlinearProjectData {
  return {
    setups: [setupFor('en')],
    books: [
      bookAt('Interlinear_en/Interlinear_en_MAT.xml', 'MAT'),
      bookAt('Interlinear_en/Interlinear_en_MRK.xml', 'MRK'),
    ],
    lexicon: { language: 'en', entries: [], legacyAnalyses: [] },
    wordAnalyses: [{ word: 'walked', analyses: [['Stem:walk']] }],
    hasAssociatedLexicalProject: true,
  };
}

/** Every file of {@link wholeProject}, small enough that a roomy ceiling holds them all. */
function allFiles(sizeBytes = 1024): Pt9InterlinearReadFile[] {
  return [
    { path: 'Interlinear_en/Interlinear_en_MAT.xml', sizeBytes },
    { path: 'Interlinear_en/Interlinear_en_MRK.xml', sizeBytes },
    { path: 'Lexicon.xml', sizeBytes },
    { path: 'WordAnalyses.xml', sizeBytes },
  ];
}

/**
 * A source that answers each read with only the files its selector names, the way the
 * projectInterface does, and records the selectors it was called with.
 */
function fakeSource(whole: Pt9InterlinearProjectData) {
  const calls: string[][] = [];
  return {
    calls,
    getPt9InterlinearData: jest.fn((selector?: { paths?: string[] }) => {
      const paths = selector?.paths ?? [];
      calls.push(paths);
      const selected = new Set(paths);
      return Promise.resolve({
        setups: whole.setups,
        hasAssociatedLexicalProject: whole.hasAssociatedLexicalProject,
        books: whole.books.filter((book) => selected.has(book.filePath)),
        lexicon: selected.has('Lexicon.xml') ? whole.lexicon : undefined,
        wordAnalyses: selected.has('WordAnalyses.xml') ? whole.wordAnalyses : [],
      });
    }),
  };
}

describe('groupPt9ReadsByCeiling', () => {
  it('puts everything in one read when the total fits', () => {
    expect(groupPt9ReadsByCeiling(allFiles(10), 100)).toEqual([
      [
        'Interlinear_en/Interlinear_en_MAT.xml',
        'Interlinear_en/Interlinear_en_MRK.xml',
        'Lexicon.xml',
        'WordAnalyses.xml',
      ],
    ]);
  });

  it('starts a new read at the file that would cross the ceiling', () => {
    const files: Pt9InterlinearReadFile[] = [
      { path: 'a', sizeBytes: 60 },
      { path: 'b', sizeBytes: 50 },
      { path: 'c', sizeBytes: 40 },
    ];

    expect(groupPt9ReadsByCeiling(files, 100)).toEqual([['a'], ['b', 'c']]);
  });

  it('fills a group to exactly the ceiling rather than splitting early', () => {
    const files: Pt9InterlinearReadFile[] = [
      { path: 'a', sizeBytes: 60 },
      { path: 'b', sizeBytes: 40 },
      { path: 'c', sizeBytes: 1 },
    ];

    expect(groupPt9ReadsByCeiling(files, 100)).toEqual([['a', 'b'], ['c']]);
  });

  it('groups nothing when there is nothing to read', () => {
    expect(groupPt9ReadsByCeiling([], 100)).toEqual([]);
  });
});

describe('readPt9InterlinearData', () => {
  it('assembles every file into one payload', async () => {
    const whole = wholeProject();
    const source = fakeSource(whole);

    const data = await readPt9InterlinearData(source, allFiles(), ROOMY);

    expect(data.books.map((book) => book.bookId)).toEqual(['MAT', 'MRK']);
    expect(data.lexicon).toEqual(whole.lexicon);
    expect(data.wordAnalyses).toEqual(whole.wordAnalyses);
  });

  it('reads a project that fits in a single request', async () => {
    const source = fakeSource(wholeProject());

    await readPt9InterlinearData(source, allFiles(), ROOMY);

    expect(source.calls).toHaveLength(1);
    expect(source.calls[0]).toHaveLength(4);
  });

  it('splits into as many requests as the ceiling forces, and no more', async () => {
    const source = fakeSource(wholeProject());

    // Two files fit per read at this ceiling.
    await readPt9InterlinearData(source, allFiles(60), 120);

    expect(source.calls).toEqual([
      ['Interlinear_en/Interlinear_en_MAT.xml', 'Interlinear_en/Interlinear_en_MRK.xml'],
      ['Lexicon.xml', 'WordAnalyses.xml'],
    ]);
  });

  it('assembles the same payload however the reads are grouped', async () => {
    const oneRequest = await readPt9InterlinearData(fakeSource(wholeProject()), allFiles(), ROOMY);
    const manyRequests = await readPt9InterlinearData(
      fakeSource(wholeProject()),
      allFiles(1024),
      1024,
    );

    expect(manyRequests).toEqual(oneRequest);
  });

  it('keeps the settings-derived parts from the first response, not the last', async () => {
    // Later responses carry a different setup, so first-wins and last-wins differ.
    let answered = 0;
    const source = {
      getPt9InterlinearData: jest.fn(() => {
        answered += 1;
        return Promise.resolve({
          ...emptyPayload(),
          setups: [setupFor(answered === 1 ? 'first' : 'later')],
          hasAssociatedLexicalProject: answered === 1,
        });
      }),
    };

    const data = await readPt9InterlinearData(source, allFiles(1024), 1024);

    expect(source.getPt9InterlinearData).toHaveBeenCalledTimes(4);
    expect(data.setups.map((setup) => setup.languageId)).toEqual(['first']);
    expect(data.hasAssociatedLexicalProject).toBe(true);
  });

  it('issues no request when there is nothing to read', async () => {
    const source = fakeSource(wholeProject());

    const data = await readPt9InterlinearData(source, [], ROOMY);

    expect(source.getPt9InterlinearData).not.toHaveBeenCalled();
    expect(data).toEqual(emptyPayload());
  });

  it('holds each read until the one before it finishes', async () => {
    const inFlight: string[] = [];
    let concurrent = 0;
    let peak = 0;
    const source = {
      getPt9InterlinearData: jest.fn(async (selector?: { paths?: string[] }) => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        inFlight.push(selector?.paths?.[0] ?? '');
        await Promise.resolve();
        concurrent -= 1;
        return emptyPayload();
      }),
    };

    await readPt9InterlinearData(
      source,
      [
        { path: 'a.xml', sizeBytes: 10 },
        { path: 'b.xml', sizeBytes: 10 },
        { path: 'c.xml', sizeBytes: 10 },
      ],
      10,
    );

    expect(peak).toBe(1);
    expect(inFlight).toEqual(['a.xml', 'b.xml', 'c.xml']);
  });

  it('carries many entries without exceeding the argument limit', async () => {
    // A spread of this many entries throws RangeError; appending one at a time does not.
    const manyParses = Array.from({ length: 200_000 }, (_unused, index) => ({
      word: `w${index}`,
      analyses: [[`Stem:w${index}`]],
    }));
    const source = {
      getPt9InterlinearData: jest.fn(() =>
        Promise.resolve({ ...emptyPayload(), wordAnalyses: manyParses }),
      ),
    };

    const data = await readPt9InterlinearData(source, [{ path: 'W.xml', sizeBytes: 1 }], ROOMY);

    expect(data.wordAnalyses).toHaveLength(200_000);
  });

  it('fails the whole read when one file cannot be read', async () => {
    const source = {
      getPt9InterlinearData: jest.fn((selector?: { paths?: string[] }) =>
        selector?.paths?.[0] === 'bad.xml'
          ? Promise.reject(new Error('PT9 interlinear file could not be read'))
          : Promise.resolve(emptyPayload()),
      ),
    };

    await expect(
      readPt9InterlinearData(
        source,
        [
          { path: 'good.xml', sizeBytes: 10 },
          { path: 'bad.xml', sizeBytes: 10 },
          { path: 'never.xml', sizeBytes: 10 },
        ],
        10,
      ),
    ).rejects.toThrow('PT9 interlinear file could not be read');
    // The read after the failing one is never issued.
    expect(source.getPt9InterlinearData).toHaveBeenCalledTimes(2);
  });
});
