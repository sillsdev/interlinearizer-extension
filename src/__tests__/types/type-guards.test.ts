import { emptyAnalysis } from '../../types/empty-factories';
import { isTextAnalysis } from '../../types/type-guards';

/**
 * The authority every ref in this file carries. No authority label is known to this build — the
 * boundary validates that a ref names one, never which one it names — so an `x-` label stands in
 * for any id space at all.
 */
const AUTHORITY = 'x-test';

/** The four ref fields a morpheme may carry, paired with the id field each ref kind requires. */
const MORPHEME_REFS = [
  ['entryRef', 'entryId'],
  ['senseRef', 'senseId'],
  ['allomorphRef', 'allomorphId'],
  ['grammarRef', 'msaId'],
] as const;

function analysisWithTokenFields(fields: object): unknown {
  return { ...emptyAnalysis(), tokenAnalyses: [{ id: 'ta-1', surfaceText: 'word', ...fields }] };
}

function analysisWithMorphemeFields(fields: object): unknown {
  return analysisWithTokenFields({
    morphemes: [{ id: 'm-1', form: 'word', writingSystem: 'und', ...fields }],
  });
}

function analysisWithPhraseFields(fields: object): unknown {
  return {
    ...emptyAnalysis(),
    phraseAnalyses: [{ id: 'pa-1', surfaceText: 'a phrase', ...fields }],
  };
}

describe('isTextAnalysis', () => {
  it.each(MORPHEME_REFS)('accepts a morpheme %s naming any authority', (field, idField) => {
    expect(
      isTextAnalysis(
        analysisWithMorphemeFields({ [field]: { authority: AUTHORITY, [idField]: 'id-1' } }),
      ),
    ).toBe(true);
  });

  it.each(MORPHEME_REFS)('rejects a morpheme %s that names no authority', (field, idField) => {
    expect(isTextAnalysis(analysisWithMorphemeFields({ [field]: { [idField]: 'id-1' } }))).toBe(
      false,
    );
  });

  it.each(MORPHEME_REFS)('rejects a morpheme %s that carries no id', (field) => {
    expect(isTextAnalysis(analysisWithMorphemeFields({ [field]: { authority: AUTHORITY } }))).toBe(
      false,
    );
  });

  it('accepts a token gloss sense reference naming any authority', () => {
    expect(
      isTextAnalysis(
        analysisWithTokenFields({ glossSenseRef: { authority: AUTHORITY, senseId: 's-1' } }),
      ),
    ).toBe(true);
  });

  it('rejects a token gloss sense reference that names no authority', () => {
    expect(isTextAnalysis(analysisWithTokenFields({ glossSenseRef: { senseId: 's-1' } }))).toBe(
      false,
    );
  });

  it('accepts a phrase sense reference naming any authority', () => {
    expect(
      isTextAnalysis(
        analysisWithPhraseFields({ senseRef: { authority: AUTHORITY, senseId: 's-1' } }),
      ),
    ).toBe(true);
  });

  it('rejects a phrase sense reference that names no authority', () => {
    expect(isTextAnalysis(analysisWithPhraseFields({ senseRef: { senseId: 's-1' } }))).toBe(false);
  });

  it('rejects a reference whose authority is not a string', () => {
    expect(
      isTextAnalysis(analysisWithTokenFields({ glossSenseRef: { authority: 7, senseId: 's-1' } })),
    ).toBe(false);
  });

  it('accepts a reference carrying a projectId', () => {
    expect(
      isTextAnalysis(
        analysisWithTokenFields({
          glossSenseRef: { authority: AUTHORITY, projectId: 'dataset-1', senseId: 's-1' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects a reference whose projectId is not a string', () => {
    expect(
      isTextAnalysis(
        analysisWithTokenFields({
          glossSenseRef: { authority: AUTHORITY, projectId: 7, senseId: 's-1' },
        }),
      ),
    ).toBe(false);
  });

  it('rejects a reference that is not an object', () => {
    expect(isTextAnalysis(analysisWithTokenFields({ glossSenseRef: 's-1' }))).toBe(false);
  });

  it('rejects a null reference', () => {
    // eslint-disable-next-line no-null/no-null -- stored JSON can carry null where a ref is expected
    expect(isTextAnalysis(analysisWithTokenFields({ glossSenseRef: null }))).toBe(false);
  });
});
