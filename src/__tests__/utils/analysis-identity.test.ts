/** @file Unit tests for utils/analysis-identity.ts. */
/// <reference types="jest" />

import type { TokenAnalysis } from 'interlinearizer';
import { analysesAreIdentical, normalizeSurfaceForm } from '../../utils/analysis-identity';

describe('normalizeSurfaceForm', () => {
  it('lowercases so a sentence-initial form matches a mid-sentence form', () => {
    expect(normalizeSurfaceForm('The')).toBe(normalizeSurfaceForm('the'));
  });

  it('collapses decomposed and composed forms to the same key', () => {
    const composed = 'café'; // "café" with precomposed é (U+00E9)
    const decomposed = 'café'; // "café" as e + combining acute (U+0301)
    expect(decomposed).not.toBe(composed); // distinct raw strings...
    expect(normalizeSurfaceForm(decomposed)).toBe(normalizeSurfaceForm(composed)); // ...one key once normalized.
  });
});

/**
 * Builds a `TokenAnalysis` with the given fields over a stable id/surface, so each matrix test can
 * vary exactly one field.
 *
 * @param overrides - Partial fields to merge onto the base analysis.
 * @returns A `TokenAnalysis` for use in equality assertions.
 */
function ta(overrides: Partial<TokenAnalysis>): TokenAnalysis {
  return { id: 'id', surfaceText: 'word', ...overrides };
}

describe('analysesAreIdentical', () => {
  it('treats two analyses with the same surface form and gloss as identical', () => {
    expect(analysesAreIdentical(ta({ gloss: { en: 'hi' } }), ta({ gloss: { en: 'hi' } }))).toBe(
      true,
    );
  });

  it('ignores id and surface case when content matches', () => {
    const a: TokenAnalysis = { id: 'a', surfaceText: 'The', gloss: { en: 'the' } };
    const b: TokenAnalysis = { id: 'b', surfaceText: 'the', gloss: { en: 'the' } };
    expect(analysesAreIdentical(a, b)).toBe(true);
  });

  it('treats two morpheme-only analyses with no gloss as identical', () => {
    const morphemes = [{ id: 'm', form: 'un-', writingSystem: 'en' }];
    expect(analysesAreIdentical(ta({ morphemes }), ta({ morphemes }))).toBe(true);
  });

  it('differs when the surface form differs', () => {
    expect(analysesAreIdentical(ta({ surfaceText: 'cat' }), ta({ surfaceText: 'dog' }))).toBe(
      false,
    );
  });

  it('differs when a gloss value differs', () => {
    expect(analysesAreIdentical(ta({ gloss: { en: 'hi' } }), ta({ gloss: { en: 'bye' } }))).toBe(
      false,
    );
  });

  it('differs when one gloss has an extra language key', () => {
    expect(
      analysesAreIdentical(ta({ gloss: { en: 'hi' } }), ta({ gloss: { en: 'hi', fr: 'salut' } })),
    ).toBe(false);
  });

  it('differs when the gloss language keys differ but counts match', () => {
    expect(analysesAreIdentical(ta({ gloss: { en: 'hi' } }), ta({ gloss: { fr: 'hi' } }))).toBe(
      false,
    );
  });

  it('differs when one has a gloss and the other does not', () => {
    expect(analysesAreIdentical(ta({ gloss: { en: 'hi' } }), ta({}))).toBe(false);
  });

  it('differs when pos differs', () => {
    expect(analysesAreIdentical(ta({ pos: 'N' }), ta({ pos: 'V' }))).toBe(false);
  });

  it('differs when features differ', () => {
    expect(
      analysesAreIdentical(ta({ features: { Case: 'Nom' } }), ta({ features: { Case: 'Acc' } })),
    ).toBe(false);
  });

  it('differs when the gloss sense reference differs', () => {
    expect(
      analysesAreIdentical(
        ta({ glossSenseRef: { senseId: 'sense-1' } }),
        ta({ glossSenseRef: { senseId: 'sense-2' } }),
      ),
    ).toBe(false);
  });

  it('differs when the morpheme count differs', () => {
    expect(
      analysesAreIdentical(
        ta({ morphemes: [{ id: 'm', form: 'un-', writingSystem: 'en' }] }),
        ta({
          morphemes: [
            { id: 'm', form: 'un-', writingSystem: 'en' },
            { id: 'n', form: 'do', writingSystem: 'en' },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('differs when a morpheme form differs', () => {
    expect(
      analysesAreIdentical(
        ta({ morphemes: [{ id: 'm', form: 'un-', writingSystem: 'en' }] }),
        ta({ morphemes: [{ id: 'm', form: 'in-', writingSystem: 'en' }] }),
      ),
    ).toBe(false);
  });

  it('differs when a morpheme gloss differs', () => {
    expect(
      analysesAreIdentical(
        ta({ morphemes: [{ id: 'm', form: 'un-', writingSystem: 'en', gloss: { en: 'not' } }] }),
        ta({ morphemes: [{ id: 'm', form: 'un-', writingSystem: 'en', gloss: { en: 'NOT' } }] }),
      ),
    ).toBe(false);
  });

  it('differs when a morpheme entry reference differs', () => {
    expect(
      analysesAreIdentical(
        ta({
          morphemes: [{ id: 'm', form: 'un-', writingSystem: 'en', entryRef: { entryId: 'e1' } }],
        }),
        ta({
          morphemes: [{ id: 'm', form: 'un-', writingSystem: 'en', entryRef: { entryId: 'e2' } }],
        }),
      ),
    ).toBe(false);
  });

  it('ignores morpheme id and writing system when form, gloss, and refs match', () => {
    expect(
      analysesAreIdentical(
        ta({ morphemes: [{ id: 'm-1', form: 'un-', writingSystem: 'en', gloss: { en: 'not' } }] }),
        ta({ morphemes: [{ id: 'm-2', form: 'un-', writingSystem: 'grc', gloss: { en: 'not' } }] }),
      ),
    ).toBe(true);
  });
});
