/// <reference types="jest" />

import type { MorphemeAnalysis } from 'interlinearizer';
import type { CatalogRow } from '../../utils/analysis-query';
import { deriveMergeMaster } from '../../utils/merge-master';

const analysisLanguage = 'en';
const sourceLanguageTag = 'grc';

/** Builds a morpheme, glossed in the analysis language when a gloss is given. */
function morpheme(id: string, form: string, gloss?: string): MorphemeAnalysis {
  const base = { id, form, writingSystem: sourceLanguageTag };
  return gloss === undefined ? base : { ...base, gloss: { [analysisLanguage]: gloss } };
}

/** Builds a catalog row of the one surface form these tests merge, carrying only what a case sets. */
function row(analysisId: string, overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    analysisId,
    surfaceText: 'λόγος',
    gloss: '',
    morphemes: [],
    usageCount: 0,
    usageCountInBook: 0,
    usages: [],
    books: new Set(),
    searchText: '',
    ...overrides,
  };
}

describe('deriveMergeMaster', () => {
  it('takes every field from the top analysis when nothing has been edited', () => {
    const top = row('ta-1', {
      gloss: 'word',
      morphemes: [morpheme('m-1', 'λόγ', 'word'), morpheme('m-2', 'ος', 'NOM.SG')],
      pos: 'noun',
      features: { Case: 'Nom' },
      confidence: 'high',
    });

    const { master } = deriveMergeMaster({
      order: [top, row('ta-2', { gloss: 'speech' })],
      checked: new Set(['ta-1']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master).toEqual({
      gloss: 'word',
      morphemes: top.morphemes,
      pos: 'noun',
      features: { Case: 'Nom' },
      confidence: 'high',
    });
  });

  it('fills a field the top lacks from the next checked analysis below that has one', () => {
    const { master } = deriveMergeMaster({
      order: [
        row('ta-1', { gloss: 'word' }),
        row('ta-2', { pos: 'noun' }),
        row('ta-3', { pos: 'verb', features: { Case: 'Nom' } }),
      ],
      checked: new Set(['ta-1', 'ta-2', 'ta-3']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.pos).toBe('noun');
    expect(master.features).toEqual({ Case: 'Nom' });
  });

  it('leaves a field absent when only an unchecked analysis has a value for it', () => {
    const { master } = deriveMergeMaster({
      order: [row('ta-1', { gloss: 'word' }), row('ta-2', { pos: 'noun' })],
      checked: new Set(['ta-1']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.pos).toBeUndefined();
  });

  it('fills a field from an analysis once it is checked', () => {
    const order = [row('ta-1', { gloss: 'word' }), row('ta-2', { pos: 'noun' })];

    const { master } = deriveMergeMaster({
      order,
      checked: new Set(['ta-1', 'ta-2']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.pos).toBe('noun');
  });

  it('takes the whole breakdown from the first checked analysis that has one', () => {
    const donor = row('ta-2', { morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] });

    const { master } = deriveMergeMaster({
      order: [
        row('ta-1', { gloss: 'word' }),
        donor,
        row('ta-3', { morphemes: [morpheme('m-3', 'λόγος')] }),
      ],
      checked: new Set(['ta-1', 'ta-2', 'ta-3']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.morphemes).toEqual(donor.morphemes);
  });

  it('fills an unglossed morpheme from a lower analysis whose breakdown has the same form', () => {
    const { master } = deriveMergeMaster({
      order: [
        row('ta-1', { morphemes: [morpheme('m-1', 'λόγ', 'word'), morpheme('m-2', 'ος')] }),
        row('ta-2', {
          morphemes: [morpheme('m-3', 'λόγ', 'speech'), morpheme('m-4', 'ος', 'NOM.SG')],
        }),
      ],
      checked: new Set(['ta-1', 'ta-2']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.morphemes.map((m) => [m.form, m.gloss?.[analysisLanguage]])).toEqual([
      ['λόγ', 'word'],
      ['ος', 'NOM.SG'],
    ]);
  });

  it('leaves a morpheme unglossed when no lower analysis has that form', () => {
    const { master } = deriveMergeMaster({
      order: [
        row('ta-1', { morphemes: [morpheme('m-1', 'λόγ')] }),
        row('ta-2', { morphemes: [morpheme('m-2', 'ος', 'NOM.SG')] }),
      ],
      checked: new Set(['ta-1', 'ta-2']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.morphemes[0].gloss).toBeUndefined();
  });

  it('takes an edited field from the edit rather than from any analysis', () => {
    const { master } = deriveMergeMaster({
      order: [row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })],
      checked: new Set(['ta-1', 'ta-2']),
      edits: { gloss: 'utterance' },
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.gloss).toBe('utterance');
  });

  it('keeps a blanked field empty rather than falling back to a lower analysis', () => {
    const { master } = deriveMergeMaster({
      order: [row('ta-1', { gloss: 'dog' }), row('ta-2', { gloss: 'hound' })],
      checked: new Set(['ta-1', 'ta-2']),
      edits: { gloss: '' },
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.gloss).toBe('');
  });

  it('keeps an edited field across a change of master', () => {
    const first = row('ta-1', { gloss: 'word', pos: 'noun' });
    const second = row('ta-2', { gloss: 'speech', pos: 'verb' });
    const edits = { gloss: 'utterance' };
    const checked = new Set(['ta-1', 'ta-2']);

    const { master } = deriveMergeMaster({
      order: [second, first],
      checked,
      edits,
      analysisLanguage,
      sourceLanguageTag,
    });

    // The edit stands where it was typed; the untouched field refills from the new master.
    expect([master.gloss, master.pos]).toEqual(['utterance', 'verb']);
  });

  it('takes each of the other fields from its edit when one has been made', () => {
    const { master } = deriveMergeMaster({
      order: [row('ta-1', { pos: 'noun', features: { Case: 'Nom' }, confidence: 'low' })],
      checked: new Set(['ta-1']),
      edits: { pos: 'verb', features: { Tense: 'Aor' }, confidence: 'high' },
      analysisLanguage,
      sourceLanguageTag,
    });

    expect([master.pos, master.features, master.confidence]).toEqual([
      'verb',
      { Tense: 'Aor' },
      'high',
    ]);
  });

  it('takes the breakdown from its edit when one has been made', () => {
    const { master } = deriveMergeMaster({
      order: [row('ta-1', { morphemes: [morpheme('m-1', 'λόγος')] })],
      checked: new Set(['ta-1']),
      edits: { morphemeForms: ['λόγ', 'ος'] },
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.morphemes.map((m) => m.form)).toEqual(['λόγ', 'ος']);
  });

  it('keeps a morpheme gloss edit whose form the breakdown still carries', () => {
    const { master } = deriveMergeMaster({
      order: [row('ta-1', { morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] })],
      checked: new Set(['ta-1']),
      edits: { morphemeForms: ['λόγ', 'ου'], morphemeGlosses: { λόγ: 'word' } },
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.morphemes[0].gloss?.[analysisLanguage]).toBe('word');
  });

  it('drops a morpheme gloss edit whose form the breakdown no longer carries', () => {
    const { master } = deriveMergeMaster({
      order: [row('ta-1', { morphemes: [morpheme('m-1', 'λόγ'), morpheme('m-2', 'ος')] })],
      checked: new Set(['ta-1']),
      edits: { morphemeForms: ['λόγ', 'ου'], morphemeGlosses: { ος: 'NOM.SG' } },
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(master.morphemes.map((m) => m.gloss?.[analysisLanguage])).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('deriveMergeMaster verdict', () => {
  it('withholds confirmation while the survivor is the only analysis checked', () => {
    const { verdict } = deriveMergeMaster({
      order: [row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })],
      checked: new Set(['ta-1']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(verdict).toEqual({ canConfirm: false, reason: 'nothing-checked' });
  });

  it('allows confirmation once another analysis is checked', () => {
    const { verdict } = deriveMergeMaster({
      order: [row('ta-1', { gloss: 'word' }), row('ta-2', { gloss: 'speech' })],
      checked: new Set(['ta-1', 'ta-2']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(verdict).toEqual({ canConfirm: true });
  });

  it('warns that an unchecked analysis the master matches will be collapsed into it', () => {
    const { verdict } = deriveMergeMaster({
      order: [
        row('ta-1', { gloss: 'word' }),
        row('ta-2', { gloss: 'speech' }),
        row('ta-3', { gloss: 'word' }),
      ],
      checked: new Set(['ta-1', 'ta-2']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(verdict).toEqual({
      canConfirm: true,
      reason: 'will-collapse',
      collapsingAnalysisId: 'ta-3',
    });
  });

  it('raises no collapse warning while every unchecked analysis still says something different', () => {
    const { verdict } = deriveMergeMaster({
      order: [
        row('ta-1', { gloss: 'word' }),
        row('ta-2', { gloss: 'speech' }),
        row('ta-3', { gloss: 'account' }),
      ],
      checked: new Set(['ta-1', 'ta-2']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(verdict).toEqual({ canConfirm: true });
  });

  // Confidence is provenance, which analysis identity excludes, so it cannot keep two records apart.
  it('warns about an unchecked analysis differing from the master only in confidence', () => {
    const { verdict } = deriveMergeMaster({
      order: [
        row('ta-1', { gloss: 'word', confidence: 'high' }),
        row('ta-2', { gloss: 'speech' }),
        row('ta-3', { gloss: 'word', confidence: 'guess' }),
      ],
      checked: new Set(['ta-1', 'ta-2']),
      edits: {},
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(verdict).toEqual({
      canConfirm: true,
      reason: 'will-collapse',
      collapsingAnalysisId: 'ta-3',
    });
  });

  it('warns about an analysis the master converges on only after an edit', () => {
    const { verdict } = deriveMergeMaster({
      order: [
        row('ta-1', { gloss: 'word' }),
        row('ta-2', { gloss: 'speech' }),
        row('ta-3', { gloss: 'utterance' }),
      ],
      checked: new Set(['ta-1', 'ta-2']),
      edits: { gloss: 'utterance' },
      analysisLanguage,
      sourceLanguageTag,
    });

    expect(verdict).toEqual({
      canConfirm: true,
      reason: 'will-collapse',
      collapsingAnalysisId: 'ta-3',
    });
  });
});
