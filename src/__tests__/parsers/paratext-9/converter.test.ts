/**
 * @file Unit tests for the Paratext 9 converter: convertParatext9ToInterlinearization and
 *   createAnalyses. These tests use the real converter (no mock) so conversion and
 *   segment/occurrence logic is covered. Covers: sort comparator (word before punctuation when same
 *   range), single-cluster branch (Word-only or WordParse-only per range), and dual-cluster path.
 */

import fs from 'fs';
import {
  convertParatext9ToInterlinearization,
  createAnalyses,
  createTargetAnalyses,
} from 'parsers/paratext-9/converter';
import { Paratext9Parser } from 'parsers/paratext-9/interlinearParser';
import type {
  InterlinearData,
  VerseData,
  ClusterData,
  PunctuationData,
} from 'parsers/paratext-9/types';
import { getTestDataPath } from '../../test-helpers';

/** Builds minimal VerseData for a single verse. */
function buildVerseData(overrides: {
  hash?: string;
  clusters?: ClusterData[];
  punctuations?: PunctuationData[];
}): VerseData {
  return {
    hash: '',
    clusters: [],
    punctuations: [],
    ...overrides,
  };
}

/** Builds minimal ClusterData. */
function buildCluster(
  textRange: { index: number; length: number },
  lexemeIds: string[],
  senseIds: string[] = [],
): ClusterData {
  const lexemes = lexemeIds.map((lexemeId, i) => ({
    lexemeId,
    senseId: senseIds[i] ?? '',
  }));
  const lexemesId = lexemeIds.join('/');
  const id = `${lexemesId}/${textRange.index}-${textRange.length}`;
  return {
    textRange: { index: textRange.index, length: textRange.length },
    lexemes,
    lexemesId,
    id,
    excluded: false,
  };
}

/** Builds minimal PunctuationData. */
function buildPunctuation(
  textRange: { index: number; length: number },
  afterText: string,
): PunctuationData {
  return {
    textRange: { index: textRange.index, length: textRange.length },
    beforeText: '',
    afterText,
  };
}

describe('convertParatext9ToInterlinearization', () => {
  it('converts parsed Interlinear XML to Interlinearization (single- and dual-cluster paths)', async () => {
    const xml = fs.readFileSync(getTestDataPath('Interlinear_en_JHN.xml'), 'utf-8');
    const parser = new Paratext9Parser();
    const interlinearData = parser.parse(xml);

    const result = await convertParatext9ToInterlinearization(interlinearData);

    expect(result).toBeDefined();
    expect(result.analysisLanguages).toEqual(['en']);
    expect(result.books).toHaveLength(1);
    expect(result.books[0].bookRef).toBe('JHN');
    expect(result.books[0].segments.length).toBeGreaterThan(0);

    const firstSegment = result.books[0].segments[0];
    expect(firstSegment.segmentRef).toBe('JHN 1:1');
    expect(firstSegment.occurrences.length).toBeGreaterThan(0);

    const wordOccurrences = firstSegment.occurrences.filter((o) => o.type === 'word');
    const punctOccurrences = firstSegment.occurrences.filter((o) => o.type === 'punctuation');
    expect(wordOccurrences.length).toBeGreaterThan(0);
    expect(punctOccurrences.length).toBeGreaterThan(0);
  });

  it('sorts word before punctuation when both share the same text range (sort comparator branch)', async () => {
    const range = { index: 5, length: 1 };
    const wordOnlyCluster = buildCluster(range, ['Word:x'], ['sense1']);
    const verseData = buildVerseData({
      clusters: [wordOnlyCluster],
      punctuations: [buildPunctuation(range, '.')],
    });
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: { 'TST 1:1': verseData },
    };

    const result = await convertParatext9ToInterlinearization(interlinearData);

    const segment = result.books[0].segments[0];
    expect(segment.occurrences).toHaveLength(2);
    expect(segment.occurrences[0].type).toBe('word');
    expect(segment.occurrences[1].type).toBe('punctuation');
  });

  it('sort comparator returns 0 when two items have same range and same kind', async () => {
    const range = { index: 3, length: 1 };
    const verseData = buildVerseData({
      clusters: [buildCluster({ index: 0, length: 2 }, ['Word:ab'], ['s1'])],
      punctuations: [buildPunctuation(range, ','), buildPunctuation(range, ',')],
    });
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: { 'TST 1:1': verseData },
    };

    const result = await convertParatext9ToInterlinearization(interlinearData);

    const segment = result.books[0].segments[0];
    expect(segment.occurrences).toHaveLength(3);
  });

  it('computes book text version from verse hashes (computeBookTextVersion non-empty path)', async () => {
    const verseData = buildVerseData({
      hash: 'abc123',
      clusters: [buildCluster({ index: 0, length: 1 }, ['Word:x'], ['s1'])],
      punctuations: [],
    });
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: { 'TST 1:1': verseData },
    };
    const mockHasher = jest.fn().mockResolvedValue('mock-text-version');

    const result = await convertParatext9ToInterlinearization(interlinearData, {
      hashSha256Hex: mockHasher,
    });

    expect(mockHasher).toHaveBeenCalled();
    expect(result.books[0].textVersion).toBe('mock-text-version');
  });

  it('uses single cluster for both assignments and surface when range has only Word (single-cluster branch)', async () => {
    const verseData = buildVerseData({
      clusters: [buildCluster({ index: 0, length: 2 }, ['Word:In'], ['sense-in'])],
      punctuations: [],
    });
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: { 'TST 1:1': verseData },
    };

    const result = await convertParatext9ToInterlinearization(interlinearData);

    const segment = result.books[0].segments[0];
    expect(segment.occurrences).toHaveLength(1);
    expect(segment.occurrences[0].type).toBe('word');
    expect(segment.occurrences[0].surfaceText).toBe('In');
    expect(segment.occurrences[0].assignments).toHaveLength(0);
  });

  it('uses single cluster for both when range has only WordParse (single-cluster branch)', async () => {
    const verseData = buildVerseData({
      clusters: [
        buildCluster(
          { index: 0, length: 7 },
          ['Stem:run', 'Suffix:ning'],
          ['sense-run', 'sense-ing'],
        ),
      ],
      punctuations: [],
    });
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: { 'TST 1:1': verseData },
    };

    const result = await convertParatext9ToInterlinearization(interlinearData);

    const segment = result.books[0].segments[0];
    expect(segment.occurrences).toHaveLength(1);
    expect(segment.occurrences[0].type).toBe('word');
    expect(segment.occurrences[0].surfaceText).toBe('running');
    expect(segment.occurrences[0].assignments).toHaveLength(2);
  });

  it('surfaceTextFromLexemes uses full lexemeId when no colon (clusterKind other path)', async () => {
    const verseData = buildVerseData({
      clusters: [buildCluster({ index: 0, length: 3 }, ['noColonId'], ['s1'])],
      punctuations: [],
    });
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: { 'TST 1:1': verseData },
    };

    const result = await convertParatext9ToInterlinearization(interlinearData);

    const segment = result.books[0].segments[0];
    expect(segment.occurrences[0].surfaceText).toBe('noColonId');
  });
});

describe('createSourceAnalyses / createAnalyses', () => {
  it('builds source analyses map with only WordParse lexemes (no Word analyses)', () => {
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: {
        'TST 1:1': buildVerseData({
          clusters: [
            buildCluster(
              { index: 0, length: 9 },
              ['Stem:begin', 'Suffix:ing'],
              ['sense-stem', 'sense-suffix'],
            ),
          ],
          punctuations: [],
        }),
      },
    };

    const map = createAnalyses(interlinearData);

    expect(map.size).toBeGreaterThan(0);
    const stemAnalysis = map.get('analysis-en-Stem:begin-sense-stem');
    const suffixAnalysis = map.get('analysis-en-Suffix:ing-sense-suffix');
    expect(stemAnalysis).toBeDefined();
    expect(suffixAnalysis).toBeDefined();
    expect(stemAnalysis?.analysisType).toBe('morph');
  });

  it('createTargetAnalyses uses glossLookup when provided', () => {
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: {
        'TST 1:1': buildVerseData({
          clusters: [
            buildCluster({ index: 0, length: 9 }, ['Stem:begin', 'Suffix:ing'], ['s1', 's2']),
          ],
          punctuations: [],
        }),
      },
    };
    const glossLookup: (senseId: string, _lang: string) => string | undefined = (senseId) => {
      if (senseId === 's1') return 'hello';
      if (senseId === 's2') return 'world';
      return undefined;
    };

    const map = createTargetAnalyses(interlinearData, { glossLookup });

    const analysis1 = map.get('target-analysis-en-Stem:begin-s1');
    const analysis2 = map.get('target-analysis-en-Suffix:ing-s2');
    expect(analysis1?.glossText).toBe('hello');
    expect(analysis2?.glossText).toBe('world');
  });

  it('sets analysisType to morph and morphemeBundles for WordParse lexemes (Stem/Suffix/Prefix)', () => {
    const interlinearData: InterlinearData = {
      glossLanguage: 'en',
      bookId: 'TST',
      verses: {
        'TST 1:1': buildVerseData({
          clusters: [
            buildCluster(
              { index: 0, length: 9 },
              ['Stem:begin', 'Suffix:ing'],
              ['sense-stem', 'sense-suffix'],
            ),
          ],
          punctuations: [],
        }),
      },
    };

    const map = createAnalyses(interlinearData);

    const stemAnalysis = map.get('analysis-en-Stem:begin-sense-stem');
    const suffixAnalysis = map.get('analysis-en-Suffix:ing-sense-suffix');
    expect(stemAnalysis).toBeDefined();
    expect(suffixAnalysis).toBeDefined();
    expect(stemAnalysis?.analysisType).toBe('morph');
    expect(suffixAnalysis?.analysisType).toBe('morph');
    expect(stemAnalysis?.morphemeBundles).toHaveLength(1);
    expect(stemAnalysis?.morphemeBundles?.[0].form).toBe('begin');
    expect(suffixAnalysis?.morphemeBundles).toHaveLength(1);
    expect(suffixAnalysis?.morphemeBundles?.[0].form).toBe('-ing');
  });
});
