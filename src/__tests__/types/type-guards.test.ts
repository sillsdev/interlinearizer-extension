import { emptyAnalysis } from '../../types/empty-factories';
import { isPt9ImportProvenance, isTextAnalysis } from '../../types/type-guards';

/** Stands in for any id space: the boundary never checks which authority a ref names. */
const AUTHORITY = 'x-test';

/** Each morpheme ref field paired with the id field its ref kind requires. */
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

const PROVENANCE = {
  fileHashes: { 'Lexicon.xml': 'aaaa1111' },
  importedAt: '2026-08-01T00:00:00.000Z',
};

describe('isPt9ImportProvenance', () => {
  it('accepts hashes keyed by path with an import timestamp', () => {
    expect(isPt9ImportProvenance(PROVENANCE)).toBe(true);
  });

  it('rejects a missing importedAt', () => {
    expect(isPt9ImportProvenance({ fileHashes: {} })).toBe(false);
  });

  it('rejects a non-string hash value', () => {
    expect(isPt9ImportProvenance({ fileHashes: { 'Lexicon.xml': 5 }, importedAt: 'now' })).toBe(
      false,
    );
  });

  it('rejects a non-object', () => {
    expect(isPt9ImportProvenance('pt9')).toBe(false);
  });
});
