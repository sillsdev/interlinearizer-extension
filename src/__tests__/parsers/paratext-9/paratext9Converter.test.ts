/** @file Unit tests for {@link convertParatext9ToInterlinearization}. */
/// <reference types="jest" />

import type { InterlinearData } from 'paratext-9-types';
import { convertParatext9ToInterlinearization } from 'parsers/paratext-9/paratext9Converter';

describe('convertParatext9ToInterlinearization', () => {
  describe('top-level structure', () => {
    it('produces Interlinearization with id, sourceWritingSystem, analysisLanguages, books', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = convertParatext9ToInterlinearization(data);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('sourceWritingSystem', '');
      expect(result).toHaveProperty('analysisLanguages');
      expect(Array.isArray(result.analysisLanguages)).toBe(true);
      expect(result).toHaveProperty('books');
      expect(Array.isArray(result.books)).toBe(true);
    });

    it('uses bookId for interlinearization id (lowercase, spaces to dashes)', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'RUT',
        verses: {},
      };
      const result = convertParatext9ToInterlinearization(data);

      expect(result.id).toBe('rut-interlinear');
    });

    it('produces id mat-interlinear when bookId is MAT', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = convertParatext9ToInterlinearization(data);

      expect(result.id).toBe('mat-interlinear');
    });

    it('sets analysisLanguages from glossLanguage', () => {
      const data: InterlinearData = {
        glossLanguage: 'fr',
        bookId: 'GEN',
        verses: {},
      };
      const result = convertParatext9ToInterlinearization(data);

      expect(result.analysisLanguages).toEqual(['fr']);
    });

    it('produces exactly one AnalyzedBook with id, bookRef, textVersion, segments', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = convertParatext9ToInterlinearization(data);

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
    it('returns empty segments array and empty textVersion when verses is empty', () => {
      const data: InterlinearData = {
        glossLanguage: 'en',
        bookId: 'MAT',
        verses: {},
      };
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].segments).toEqual([]);
      expect(result.books[0].textVersion).toBe('');
    });
  });

  describe('verse to segment conversion', () => {
    it('converts one verse with one cluster to one segment with one word occurrence', () => {
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
      const result = convertParatext9ToInterlinearization(data);

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

    it('uses verse hash for textVersion and sets assignment status to approved when verse has hash', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].textVersion).toBe('ABC123');
      expect(result.books[0].segments[0].occurrences[0].assignments[0].status).toBe('approved');
    });
  });

  describe('assignment status from verse hash', () => {
    it('sets assignment status to suggested when verse has no hash', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].segments[0].occurrences[0].assignments[0].status).toBe('suggested');
    });

    it('sets assignment status to approved when verse has hash', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].segments[0].occurrences[0].assignments[0].status).toBe('approved');
    });
  });

  describe('cluster with multiple lexemes', () => {
    it('creates one word occurrence with multiple assignments (one per lexeme)', () => {
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
      const result = convertParatext9ToInterlinearization(data);

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
    it('converts punctuations to punctuation occurrences after word occurrences (surfaceText from afterText when present)', () => {
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
      const result = convertParatext9ToInterlinearization(data);

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

    it('uses beforeText for surfaceText when afterText is empty', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].segments[0].occurrences[0].surfaceText).toBe(',');
    });

    it('uses empty surfaceText when both beforeText and afterText are empty', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].segments[0].occurrences[0].surfaceText).toBe('');
    });
  });

  describe('verse with no clusters', () => {
    it('produces segment with empty occurrences when verse has no clusters and no punctuations', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].segments).toHaveLength(1);
      expect(result.books[0].segments[0].occurrences).toEqual([]);
      expect(result.books[0].segments[0].id).toBe('mat-1:1');
      expect(result.books[0].segments[0].segmentRef).toBe('MAT 1:1');
    });
  });

  describe('lexeme without senseId', () => {
    it('generates analysis id without sense suffix when senseId is empty', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].segments[0].occurrences[0].assignments[0].analysisId).toBe(
        'analysis-en-Word:a',
      );
    });
  });

  describe('segment and occurrence IDs', () => {
    it('generates segment id from verseRef (lowercase, spaces to dashes)', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      expect(result.books[0].segments[0].id).toBe('mat-1:1');
    });

    it('generates occurrence id from segmentId, cluster id, and index', () => {
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
      const result = convertParatext9ToInterlinearization(data);

      const segId = result.books[0].segments[0].id;
      expect(result.books[0].segments[0].occurrences[0].id).toBe(`${segId}-occ-0-Word:word/0-4`);
    });
  });
});
