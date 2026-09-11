import type { AssignmentStatus, TextAnalysis } from 'interlinearizer';
import { FIXTURE_STAMPS } from '../test-helpers';
import { emptyAnalysis } from '../../types/empty-factories';
import {
  isPt9ImportProvenance,
  isTextAnalysis,
  validateTextAnalysis,
} from '../../types/type-guards';

/** Stands in for any id space: the boundary never checks which authority a ref names. */
const AUTHORITY = 'x-test';

/** Token snapshot every link fixture points at; its text is never under test. */
const TOKEN = { tokenRef: 'GEN 1:1:0', surfaceText: 'word' };

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

  it('accepts an analysis record carrying a known confidence', () => {
    expect(isTextAnalysis(analysisWithTokenFields({ confidence: 'guess' }))).toBe(true);
  });

  it('rejects an analysis record whose confidence is not a known level', () => {
    expect(isTextAnalysis(analysisWithTokenFields({ confidence: 'certain' }))).toBe(false);
  });

  it('rejects a link whose confidence is not a known level', () => {
    expect(
      isTextAnalysis({
        ...emptyAnalysis(),
        tokenAnalysisLinks: [
          { analysisId: 'ta-1', status: 'approved', confidence: 'certain', token: TOKEN },
        ],
      }),
    ).toBe(false);
  });
});

function tokenAnalysis(id: string) {
  return { ...FIXTURE_STAMPS, id, surfaceText: 'word' };
}

function tokenLink(
  analysisId: string,
  status: AssignmentStatus = 'approved',
  tokenRef = TOKEN.tokenRef,
) {
  return { ...FIXTURE_STAMPS, analysisId, status, token: { ...TOKEN, tokenRef } };
}

function phraseLink(
  analysisId: string,
  tokenRefs: string[],
  status: AssignmentStatus = 'approved',
) {
  return {
    ...FIXTURE_STAMPS,
    analysisId,
    status,
    tokens: tokenRefs.map((tokenRef) => ({ ...TOKEN, tokenRef })),
  };
}

/** Builds a structurally valid analysis with the token layer populated as the test needs. */
function tokenLayer(fields: Partial<TextAnalysis>): TextAnalysis {
  return { ...emptyAnalysis(), ...fields };
}

describe('validateTextAnalysis', () => {
  it('reports nothing for an empty analysis', () => {
    expect(validateTextAnalysis(emptyAnalysis())).toEqual([]);
  });

  it('reports nothing when each link resolves to a payload and no target repeats approval', () => {
    expect(
      validateTextAnalysis(
        tokenLayer({
          tokenAnalyses: [tokenAnalysis('ta-1')],
          tokenAnalysisLinks: [tokenLink('ta-1')],
        }),
      ),
    ).toEqual([]);
  });

  it('reports a target carrying two approved links', () => {
    expect(
      validateTextAnalysis(
        tokenLayer({
          tokenAnalyses: [tokenAnalysis('ta-1'), tokenAnalysis('ta-2')],
          tokenAnalysisLinks: [tokenLink('ta-1'), tokenLink('ta-2')],
        }),
      ),
    ).toEqual([{ kind: 'multipleApproved', layer: 'token', count: 1, sample: ['GEN 1:1:0'] }]);
  });

  it('does not report a target whose second link is unapproved', () => {
    expect(
      validateTextAnalysis(
        tokenLayer({
          tokenAnalyses: [tokenAnalysis('ta-1'), tokenAnalysis('ta-2')],
          tokenAnalysisLinks: [tokenLink('ta-1'), tokenLink('ta-2', 'suggested')],
        }),
      ),
    ).toEqual([]);
  });

  it('reports a link whose analysisId names no payload', () => {
    expect(
      validateTextAnalysis(tokenLayer({ tokenAnalysisLinks: [tokenLink('ta-missing')] })),
    ).toEqual([{ kind: 'danglingLink', layer: 'token', count: 1, sample: ['GEN 1:1:0'] }]);
  });

  it('reports a segment payload no link references', () => {
    expect(validateTextAnalysis(tokenLayer({ segmentAnalyses: [tokenAnalysis('sa-1')] }))).toEqual([
      { kind: 'unreferencedAnalysis', layer: 'segment', count: 1, sample: ['sa-1'] },
    ]);
  });

  it('does not report a token payload no link references', () => {
    // A token payload describes a spelling, so an inventory may hold one the text never uses.
    expect(validateTextAnalysis(tokenLayer({ tokenAnalyses: [tokenAnalysis('ta-1')] }))).toEqual(
      [],
    );
  });

  it('reports a phrase payload no link references', () => {
    expect(validateTextAnalysis(tokenLayer({ phraseAnalyses: [tokenAnalysis('pa-1')] }))).toEqual([
      { kind: 'unreferencedAnalysis', layer: 'phrase', count: 1, sample: ['pa-1'] },
    ]);
  });

  it('reports a token shared by two approved phrases whose spans differ', () => {
    expect(
      validateTextAnalysis(
        tokenLayer({
          phraseAnalyses: [tokenAnalysis('pa-1'), tokenAnalysis('pa-2')],
          phraseAnalysisLinks: [
            phraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:5']),
            phraseLink('pa-2', ['GEN 1:1:5', 'GEN 1:1:9']),
          ],
        }),
      ),
    ).toEqual([{ kind: 'multipleApproved', layer: 'phrase', count: 1, sample: ['GEN 1:1:5'] }]);
  });

  it('does not report two approved phrases that share no token', () => {
    expect(
      validateTextAnalysis(
        tokenLayer({
          phraseAnalyses: [tokenAnalysis('pa-1'), tokenAnalysis('pa-2')],
          phraseAnalysisLinks: [
            phraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:5']),
            phraseLink('pa-2', ['GEN 1:1:7', 'GEN 1:1:9']),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('does not report a token shared with an unapproved phrase', () => {
    expect(
      validateTextAnalysis(
        tokenLayer({
          phraseAnalyses: [tokenAnalysis('pa-1'), tokenAnalysis('pa-2')],
          phraseAnalysisLinks: [
            phraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:5']),
            phraseLink('pa-2', ['GEN 1:1:5', 'GEN 1:1:9'], 'suggested'),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('reports the segment layer by its segment id', () => {
    expect(
      validateTextAnalysis(
        tokenLayer({
          segmentAnalysisLinks: [
            { ...FIXTURE_STAMPS, analysisId: 'sa-1', status: 'approved', segmentId: 'GEN 1:1' },
          ],
        }),
      ),
    ).toEqual([{ kind: 'danglingLink', layer: 'segment', count: 1, sample: ['GEN 1:1'] }]);
  });

  it('reports the phrase layer by the joined refs of its token span', () => {
    expect(
      validateTextAnalysis(
        tokenLayer({
          phraseAnalysisLinks: [
            {
              ...FIXTURE_STAMPS,
              analysisId: 'pa-1',
              status: 'approved',
              tokens: [TOKEN, { ...TOKEN, tokenRef: 'GEN 1:1:5' }],
            },
          ],
        }),
      ),
    ).toEqual([
      { kind: 'danglingLink', layer: 'phrase', count: 1, sample: ['GEN 1:1:0,GEN 1:1:5'] },
    ]);
  });

  it('counts every occurrence but samples at most ten identifiers', () => {
    const analyses = Array.from({ length: 12 }, (_, i) => tokenAnalysis(`sa-${i}`));

    const [reported] = validateTextAnalysis(tokenLayer({ segmentAnalyses: analyses }));

    expect(reported).toMatchObject({ kind: 'unreferencedAnalysis', count: 12 });
    expect(reported.sample).toHaveLength(10);
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
