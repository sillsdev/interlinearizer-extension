/**
 * @file Unit tests for {@link convertParatext9ToInterlinearization} and {@link createAnalyses}.
 * @jest-environment node
 */
/// <reference types="jest" />

import { createHash } from 'crypto';
import {
  convertParatext9ToInterlinearization,
  createAnalyses,
} from 'parsers/paratext-9/paratext9Converter';
import type { InterlinearData } from 'parsers/paratext-9/paratext-9-types';

/** SHA-256 hex hasher using Node crypto. */
function nodeSha256Hex(str: string): Promise<string> {
  return Promise.resolve(createHash('sha256').update(str, 'utf8').digest('hex'));
}

/** Options for converter calls in tests: use Node crypto. */
const nodeHashOptions = { hashSha256Hex: nodeSha256Hex };

/** Expected textVersion for a single verse hash: SHA-256( hash ) in hex. */
function expectedTextVersionForSingleHash(hash: string): string {
  return createHash('sha256').update(hash, 'utf8').digest('hex');
}

describe('convertParatext9ToInterlinearization', () => {
  describe('top-level structure', () => {
    it('produces Interlinearization with id, sourceWritingSystem, analysisLanguages, books', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('sourceWritingSystem', '');
      expect(result).toHaveProperty('analysisLanguages');
      expect(Array.isArray(result.analysisLanguages)).toBe(true);
      expect(result).toHaveProperty('books');
      expect(Array.isArray(result.books)).toBe(true);
    });

    it('uses bookId for interlinearization id (lowercase, spaces to dashes)', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'RUT',
        verses: {},
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.id).toBe('rut-interlinear');
    });

    it('produces id mat-interlinear when bookId is MAT', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.id).toBe('mat-interlinear');
    });

    it('sets analysisLanguages from glossLanguage', async () => {
      const data: InterlinearData = {
        glossLanguage: 'fr',
        bookId: 'GEN',
        verses: {},
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.analysisLanguages).toEqual(['fr']);
    });

    it('produces exactly one AnalyzedBook with id, bookRef, textVersion, segments', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books).toHaveLength(1);
      const book = result.books[0];
      expect(book).toHaveProperty('id', 'mat');
      expect(book).toHaveProperty('bookRef', 'MAT');
      expect(book).toHaveProperty('textVersion');
      expect(book).toHaveProperty('segments');
      expect(Array.isArray(book.segments)).toBe(true);
    });
  });

  describe('empty verses', () => {
    it('returns empty segments array and empty textVersion when verses is empty', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].segments).toEqual([]);
      expect(result.books[0].textVersion).toBe('');
    });
  });

  describe('textVersion (composite book-level digest)', () => {
    it('is empty when no verse has a hash', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': { hash: '', clusters: [], punctuations: [] },
          'MAT 1:2': { hash: '', clusters: [], punctuations: [] },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);
      expect(result.books[0].textVersion).toBe('');
    });

    it('is SHA-256 of sorted concatenated hashes when multiple verses have hashes', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:2': {
            hash: 'hash2',
            clusters: [],
            punctuations: [],
          },
          'MAT 1:1': {
            hash: 'hash1',
            clusters: [],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);
      const sortedHashes = ['hash1', 'hash2'].sort();
      const expected = createHash('sha256').update(sortedHashes.join(''), 'utf8').digest('hex');
      expect(result.books[0].textVersion).toBe(expected);
    });

    it('uses Web Crypto (sha256HexWebCrypto) when hashSha256Hex option is omitted', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': { hash: 'a', clusters: [], punctuations: [] },
          'MAT 1:2': { hash: 'b', clusters: [], punctuations: [] },
        },
      };
      const result = await convertParatext9ToInterlinearization(data);
      const sortedHashes = ['a', 'b'].sort();
      const expected = createHash('sha256').update(sortedHashes.join(''), 'utf8').digest('hex');
      expect(result.books[0].textVersion).toBe(expected);
    });

    it('changes when any verse hash changes', async () => {
      const base: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': { hash: 'h1', clusters: [], punctuations: [] },
          'MAT 1:2': { hash: 'h2', clusters: [], punctuations: [] },
        },
      };
      const result1 = await convertParatext9ToInterlinearization(base, nodeHashOptions);
      const modified = {
        ...base,
        verses: {
          ...base.verses,
          'MAT 1:2': { ...base.verses['MAT 1:2'], hash: 'h2-modified' },
        },
      };
      const result2 = await convertParatext9ToInterlinearization(modified, nodeHashOptions);
      expect(result1.books[0].textVersion).not.toBe(result2.books[0].textVersion);
    });
  });

  describe('verse to segment conversion', () => {
    it('converts one verse with one cluster to one segment with one word occurrence', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 4 },
                lexemes: [{ lexemeId: 'Word:word', senseId: 'sense1' }],
                lexemesId: 'Word:word',
                id: 'Word:word/0-4',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].segments).toHaveLength(1);
      const seg = result.books[0].segments[0];
      expect(seg.id).toBe('mat-1:1');
      expect(seg.segmentRef).toBe('MAT 1:1');
      expect(seg.baselineText).toBe('');
      expect(seg.occurrences).toHaveLength(1);

      const occ = seg.occurrences[0];
      expect(occ.id).toBe('mat-1:1-occ-0-Word:word/0-4');
      expect(occ.segmentId).toBe('mat-1:1');
      expect(occ.index).toBe(0);
      expect(occ.anchor).toBe('0-4');
      expect(occ.surfaceText).toBe('');
      expect(occ.writingSystem).toBe('');
      expect(occ.type).toBe('word');
      expect(occ.assignments).toHaveLength(1);

      const assign = occ.assignments[0];
      expect(assign.occurrenceId).toBe(occ.id);
      expect(assign.analysisId).toBe('analysis-en-Word:word-sense1');
      expect(assign.status).toBe('suggested');
      expect(assign.id).toBe(`assign-${occ.id}-analysis-en-Word:word-sense1`);
    });

    it('uses composite book-level digest for textVersion and sets assignment status to approved when verse has hash', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: 'ABC123',
            clusters: [
              {
                textRange: { index: 0, length: 4 },
                lexemes: [{ lexemeId: 'Word:word', senseId: 's1' }],
                lexemesId: 'Word:word',
                id: 'Word:word/0-4',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].textVersion).toBe(expectedTextVersionForSingleHash('ABC123'));
      expect(result.books[0].segments[0].occurrences[0].assignments[0].status).toBe('approved');
    });

    it('sorts items with same index by length then by kind (deterministic tie-break)', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 2 },
                lexemes: [{ lexemeId: 'Word:ab', senseId: '' }],
                lexemesId: 'Word:ab',
                id: 'Word:ab/0-2',
                excluded: false,
              },
              {
                textRange: { index: 0, length: 1 },
                lexemes: [{ lexemeId: 'Word:a', senseId: '' }],
                lexemesId: 'Word:a',
                id: 'Word:a/0-1',
                excluded: false,
              },
            ],
            punctuations: [{ textRange: { index: 0, length: 1 }, beforeText: ',', afterText: ',' }],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      const { occurrences } = result.books[0].segments[0];
      expect(occurrences).toHaveLength(3);
      expect(occurrences[0].anchor).toBe('0-1');
      expect(occurrences[0].type).toBe('word');
      expect(occurrences[1].anchor).toBe('0-1');
      expect(occurrences[1].type).toBe('punctuation');
      expect(occurrences[2].anchor).toBe('0-2');
      expect(occurrences[2].type).toBe('word');
    });
  });

  describe('assignment status from verse hash', () => {
    it('sets assignment status to suggested when verse has no hash', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 4 },
                lexemes: [{ lexemeId: 'Word:w', senseId: '' }],
                lexemesId: 'Word:w',
                id: 'Word:w/0-4',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].segments[0].occurrences[0].assignments[0].status).toBe('suggested');
    });

    it('sets assignment status to approved when verse has hash', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: 'H1',
            clusters: [
              {
                textRange: { index: 0, length: 4 },
                lexemes: [{ lexemeId: 'Word:w', senseId: '' }],
                lexemesId: 'Word:w',
                id: 'Word:w/0-4',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].textVersion).toBe(expectedTextVersionForSingleHash('H1'));
      expect(result.books[0].segments[0].occurrences[0].assignments[0].status).toBe('approved');
    });
  });

  describe('cluster with multiple lexemes', () => {
    it('creates one word occurrence with multiple assignments (one per lexeme)', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 5, length: 5 },
                lexemes: [
                  { lexemeId: 'Stem:hello', senseId: 'g1' },
                  { lexemeId: 'Suffix:ing', senseId: 'g2' },
                ],
                lexemesId: 'Stem:hello/Suffix:ing',
                id: 'Stem:hello/Suffix:ing/5-5',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      const occ = result.books[0].segments[0].occurrences[0];
      expect(occ.assignments).toHaveLength(2);
      expect(occ.assignments.map((a) => a.analysisId)).toEqual([
        'analysis-en-Stem:hello-g1',
        'analysis-en-Suffix:ing-g2',
      ]);
      expect(occ.anchor).toBe('5-5');
    });
  });

  describe('punctuation occurrences', () => {
    it('converts punctuations to punctuation occurrences after word occurrences (surfaceText from afterText when present)', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 1 },
                lexemes: [{ lexemeId: 'x', senseId: '' }],
                lexemesId: 'x',
                id: 'x/0-1',
                excluded: false,
              },
            ],
            punctuations: [
              {
                textRange: { index: 34, length: 2 },
                beforeText: '? ',
                afterText: '? ',
              },
            ],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      const seg = result.books[0].segments[0];
      expect(seg.occurrences).toHaveLength(2);

      const puncOcc = seg.occurrences[1];
      expect(puncOcc.type).toBe('punctuation');
      expect(puncOcc.anchor).toBe('34-2');
      expect(puncOcc.surfaceText).toBe('? '); // afterText preferred in implementation
      expect(puncOcc.assignments).toEqual([]);
      expect(puncOcc.index).toBe(1);
      expect(puncOcc.id).toBe('mat-1:1-punc-1-34-2');
    });

    it('uses beforeText for surfaceText when afterText is empty', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [],
            punctuations: [{ textRange: { index: 0, length: 1 }, beforeText: ',', afterText: '' }],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].segments[0].occurrences[0].surfaceText).toBe(',');
    });

    it('uses empty surfaceText when both beforeText and afterText are empty', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [],
            punctuations: [{ textRange: { index: 0, length: 1 }, beforeText: '', afterText: '' }],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].segments[0].occurrences[0].surfaceText).toBe('');
    });
  });

  describe('verse with no clusters', () => {
    it('produces segment with empty occurrences when verse has no clusters and no punctuations', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].segments).toHaveLength(1);
      expect(result.books[0].segments[0].occurrences).toEqual([]);
      expect(result.books[0].segments[0].id).toBe('mat-1:1');
      expect(result.books[0].segments[0].segmentRef).toBe('MAT 1:1');
    });
  });

  describe('lexeme without senseId', () => {
    it('generates analysis id without sense suffix when senseId is empty', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 1 },
                lexemes: [{ lexemeId: 'Word:a', senseId: '' }],
                lexemesId: 'Word:a',
                id: 'Word:a/0-1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].segments[0].occurrences[0].assignments[0].analysisId).toBe(
        'analysis-en-Word:a',
      );
    });
  });

  describe('segment and occurrence IDs', () => {
    it('generates segment id from verseRef (lowercase, spaces to dashes)', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 4 },
                lexemes: [{ lexemeId: 'W:w', senseId: '' }],
                lexemesId: 'W:w',
                id: 'W:w/0-4',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      expect(result.books[0].segments[0].id).toBe('mat-1:1');
    });

    it('generates occurrence id from segmentId, cluster id, and index', async () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 4 },
                lexemes: [{ lexemeId: 'Word:word', senseId: 's1' }],
                lexemesId: 'Word:word',
                id: 'Word:word/0-4',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = await convertParatext9ToInterlinearization(data, nodeHashOptions);

      const segId = result.books[0].segments[0].id;
      expect(result.books[0].segments[0].occurrences[0].id).toBe(`${segId}-occ-0-Word:word/0-4`);
    });
  });

  describe('createAnalyses', () => {
    it('returns empty Map when verses is empty', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = createAnalyses(data);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('returns one Analysis for one verse with one cluster and one lexeme', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 4 },
                lexemes: [{ lexemeId: 'Word:hello', senseId: 'g1' }],
                lexemesId: 'Word:hello',
                id: 'Word:hello/0-4',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = createAnalyses(data);

      expect(result.size).toBe(1);
      const analysis = result.get('analysis-en-Word:hello-g1');
      expect(analysis).toBeDefined();
      expect(analysis?.id).toBe('analysis-en-Word:hello-g1');
      expect(analysis?.analysisLanguage).toBe('en');
      expect(analysis?.analysisType).toBe('gloss');
      expect(analysis?.confidence).toBe('medium');
      expect(analysis?.sourceSystem).toBe('paratext-9');
      expect(analysis?.sourceUser).toBe('paratext-9-parser');
      expect(analysis?.glossText).toBe('g1');
    });

    it('deduplicates: same lexeme in multiple clusters yields one analysis', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 3 },
                lexemes: [{ lexemeId: 'Word:the', senseId: 'def' }],
                lexemesId: 'Word:the',
                id: 'c1',
                excluded: false,
              },
              {
                textRange: { index: 4, length: 3 },
                lexemes: [{ lexemeId: 'Word:the', senseId: 'def' }],
                lexemesId: 'Word:the',
                id: 'c2',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = createAnalyses(data);

      expect(result.size).toBe(1);
      expect(result.has('analysis-en-Word:the-def')).toBe(true);
    });

    it('returns multiple analyses for different lexemes (lexemeId or senseId)', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 4 },
                lexemes: [
                  { lexemeId: 'Stem:run', senseId: 'g1' },
                  { lexemeId: 'Suffix:ing', senseId: 'g2' },
                ],
                lexemesId: 'Stem:run',
                id: 'cluster1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = createAnalyses(data);

      expect(result.size).toBe(2);
      expect(result.has('analysis-en-Stem:run-g1')).toBe(true);
      expect(result.has('analysis-en-Suffix:ing-g2')).toBe(true);
      expect(result.get('analysis-en-Stem:run-g1')?.glossText).toBe('g1');
      expect(result.get('analysis-en-Suffix:ing-g2')?.glossText).toBe('g2');
    });

    it('sets glossText to undefined when senseId is empty', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 1 },
                lexemes: [{ lexemeId: 'Word:a', senseId: '' }],
                lexemesId: 'Word:a',
                id: 'Word:a/0-1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = createAnalyses(data);

      expect(result.size).toBe(1);
      const analysis = result.get('analysis-en-Word:a');
      expect(analysis).toBeDefined();
      expect(analysis?.glossText).toBeUndefined();
      expect(analysis?.id).toBe('analysis-en-Word:a');
    });

    it('uses glossLanguage from interlinearData for analysisLanguage and id prefix', () => {
      const data: InterlinearData = {
        glossLanguage: 'fr',
        bookId: 'GEN',
        verses: {
          'GEN 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 2 },
                lexemes: [{ lexemeId: 'Word:au', senseId: 'sens1' }],
                lexemesId: 'Word:au',
                id: 'c1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = createAnalyses(data);

      expect(result.size).toBe(1);
      const analysis = result.get('analysis-fr-Word:au-sens1');
      expect(analysis).toBeDefined();
      expect(analysis?.analysisLanguage).toBe('fr');
      expect(analysis?.id).toBe('analysis-fr-Word:au-sens1');
    });

    it('includes analyses from all verses', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 3 },
                lexemes: [{ lexemeId: 'Word:one', senseId: 's1' }],
                lexemesId: 'Word:one',
                id: 'c1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
          'MAT 1:2': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 3 },
                lexemes: [{ lexemeId: 'Word:two', senseId: 's2' }],
                lexemesId: 'Word:two',
                id: 'c2',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const result = createAnalyses(data);

      expect(result.size).toBe(2);
      expect(result.has('analysis-en-Word:one-s1')).toBe(true);
      expect(result.has('analysis-en-Word:two-s2')).toBe(true);
    });

    it('uses glossLookup when provided and returns gloss text instead of senseId placeholder', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 5 },
                lexemes: [{ lexemeId: 'Word:hello', senseId: 'Fz1CNXo3' }],
                lexemesId: 'Word:hello',
                id: 'c1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const glossLookup = (senseId: string, lang: string): string | undefined =>
        senseId === 'Fz1CNXo3' && lang === 'en' ? 'good' : undefined;
      const result = createAnalyses(data, { glossLookup });

      expect(result.size).toBe(1);
      const analysis = result.get('analysis-en-Word:hello-Fz1CNXo3');
      expect(analysis).toBeDefined();
      expect(analysis?.glossText).toBe('good');
    });

    it('falls back to senseId when glossLookup returns undefined for that sense', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 3 },
                lexemes: [{ lexemeId: 'Word:xyz', senseId: 'unknownSense' }],
                lexemesId: 'Word:xyz',
                id: 'c1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const glossLookup = (): string | undefined => undefined;
      const result = createAnalyses(data, { glossLookup });

      expect(result.size).toBe(1);
      const analysis = result.get('analysis-en-Word:xyz-unknownSense');
      expect(analysis).toBeDefined();
      expect(analysis?.glossText).toBe('unknownSense');
    });

    it('uses empty string from glossLookup when Lexicon has blank gloss for sense+language', () => {
      const data: InterlinearData = {
        glossLanguage: 'grc',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 2 },
                lexemes: [{ lexemeId: 'Word:in', senseId: '6wa5ZOr2' }],
                lexemesId: 'Word:in',
                id: 'c1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const glossLookup = (senseId: string, lang: string): string | undefined =>
        senseId === '6wa5ZOr2' && lang === 'grc' ? '' : undefined;
      const result = createAnalyses(data, { glossLookup });

      expect(result.size).toBe(1);
      const analysis = result.get('analysis-grc-Word:in-6wa5ZOr2');
      expect(analysis).toBeDefined();
      expect(analysis?.glossText).toBe('');
    });

    it('uses senseId fallback when glossLookup is provided but lexeme.senseId is empty (else branch)', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 1 },
                lexemes: [{ lexemeId: 'Word:a', senseId: '' }],
                lexemesId: 'Word:a',
                id: 'c1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const glossLookup = (): string | undefined => 'from-lexicon';
      const result = createAnalyses(data, { glossLookup });

      expect(result.size).toBe(1);
      const analysis = result.get('analysis-en-Word:a');
      expect(analysis).toBeDefined();
      expect(analysis?.glossText).toBeUndefined();
    });

    it('uses lexicon gloss when lookup returns value and senseId when lookup returns undefined', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {
          'MAT 1:1': {
            hash: '',
            clusters: [
              {
                textRange: { index: 0, length: 5 },
                lexemes: [
                  { lexemeId: 'Word:known', senseId: 'knownSense' },
                  { lexemeId: 'Word:unknown', senseId: 'unknownSense' },
                ],
                lexemesId: 'Word:known/Word:unknown',
                id: 'c1',
                excluded: false,
              },
            ],
            punctuations: [],
          },
        },
      };
      const glossLookup = (senseId: string): string | undefined =>
        senseId === 'knownSense' ? 'from-lexicon' : undefined;
      const result = createAnalyses(data, { glossLookup });

      expect(result.size).toBe(2);
      expect(result.get('analysis-en-Word:known-knownSense')?.glossText).toBe('from-lexicon');
      expect(result.get('analysis-en-Word:unknown-unknownSense')?.glossText).toBe('unknownSense');
    });
  });
});
