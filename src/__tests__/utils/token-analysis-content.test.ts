/// <reference types="jest" />

import type { TokenAnalysis } from 'interlinearizer';
import {
  applyMergedContent,
  carryOverUnsettledContent,
  clearAnalysisGloss,
  isEmptyTokenAnalysis,
} from '../../utils/token-analysis-content';
import { FIXTURE_STAMPS } from '../test-helpers';

function analysis(fields: Partial<TokenAnalysis> = {}): TokenAnalysis {
  return { id: 'ta-1', ...FIXTURE_STAMPS, surfaceText: 'In', ...fields };
}

describe('isEmptyTokenAnalysis', () => {
  it('finds a record holding only blank glosses and provenance empty', () => {
    expect(isEmptyTokenAnalysis(analysis({ gloss: { en: ' ' }, confidence: 'high' }))).toBe(true);
  });

  it.each([
    ['a gloss', { gloss: { en: 'at' } }],
    ['morphemes', { morphemes: [{ id: 'm-1', form: 'in', writingSystem: 'en' }] }],
    ['a part of speech', { pos: 'prep' }],
    ['features', { features: { case: 'loc' } }],
    ['a gloss sense', { glossSenseRef: { authority: 'fwlite', senseId: 's-1' } }],
  ])('finds a record holding %s not empty', (_field, fields) => {
    expect(isEmptyTokenAnalysis(analysis(fields))).toBe(false);
  });
});

describe('clearAnalysisGloss', () => {
  it('clears one language, keeping the others and the sense', () => {
    const record = analysis({
      gloss: { en: 'at', fr: 'à' },
      glossSenseRef: { authority: 'fwlite', senseId: 's-1' },
    });

    clearAnalysisGloss(record, 'en');

    expect(record).toStrictEqual(
      analysis({ gloss: { fr: 'à' }, glossSenseRef: { authority: 'fwlite', senseId: 's-1' } }),
    );
  });

  it('drops the gloss once no language holds usable text, keeping the sense', () => {
    const record = analysis({
      gloss: { en: 'at', fr: ' ' },
      glossSenseRef: { authority: 'fwlite', senseId: 's-1' },
    });

    clearAnalysisGloss(record, 'en');

    expect(record).toStrictEqual(
      analysis({ glossSenseRef: { authority: 'fwlite', senseId: 's-1' } }),
    );
  });

  it('leaves a record holding only a sense as it is', () => {
    const record = analysis({ glossSenseRef: { authority: 'fwlite', senseId: 's-1' } });

    clearAnalysisGloss(record, 'en');

    expect(record).toStrictEqual(
      analysis({ glossSenseRef: { authority: 'fwlite', senseId: 's-1' } }),
    );
  });
});

describe('carryOverUnsettledContent', () => {
  it("carries a donor's gloss in another language onto a survivor with no gloss", () => {
    const survivor: TokenAnalysis = { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'In' };
    const donor: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'In',
      gloss: { en: 'in', fr: 'dans' },
    };

    carryOverUnsettledContent(survivor, [donor], 'en', undefined);

    expect(survivor.gloss).toStrictEqual({ fr: 'dans' });
  });

  it("adds a donor's gloss in another language beside the survivor's own", () => {
    const survivor: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'In',
      gloss: { en: 'in' },
    };
    const donor: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'In',
      gloss: { fr: 'dans' },
    };

    carryOverUnsettledContent(survivor, [donor], 'en', undefined);

    expect(survivor.gloss).toStrictEqual({ en: 'in', fr: 'dans' });
  });

  it('carries nothing from a donor with no gloss', () => {
    const survivor: TokenAnalysis = { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'In' };
    const donor: TokenAnalysis = { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'In' };

    carryOverUnsettledContent(survivor, [donor], 'en', undefined);

    expect(survivor).not.toHaveProperty('gloss');
  });
});

describe('applyMergedContent', () => {
  it('leaves a record with no gloss without one when the merged gloss is blank', () => {
    const record: TokenAnalysis = { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'In' };

    applyMergedContent(record, { gloss: ' ', morphemes: [] }, 'en');

    expect(record).not.toHaveProperty('gloss');
  });

  it('writes the merged gloss beside the record’s glosses in other languages', () => {
    const record: TokenAnalysis = {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'In',
      gloss: { fr: 'dans' },
    };

    applyMergedContent(record, { gloss: 'in', morphemes: [] }, 'en');

    expect(record.gloss).toStrictEqual({ fr: 'dans', en: 'in' });
  });

  it('gives a record with no gloss the merged one', () => {
    const record: TokenAnalysis = { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'In' };

    applyMergedContent(record, { gloss: 'in', morphemes: [] }, 'en');

    expect(record.gloss).toStrictEqual({ en: 'in' });
  });
});
