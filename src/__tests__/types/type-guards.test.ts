/** @file Unit tests for the `isDraftProject` type guard in type-guards.ts. */
/// <reference types="jest" />

import { isDraftProject } from '../../types/type-guards';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';

describe('isDraftProject', () => {
  /**
   * Builds a valid `DraftProject` object as the accept baseline. Each reject test starts from this
   * shape and breaks exactly one field so the failure is attributable to that branch.
   *
   * @returns A fresh, structurally valid `DraftProject`.
   */
  function validDraft(): unknown {
    return emptyDraft('src-project');
  }

  it('accepts a valid DraftProject', () => {
    expect(isDraftProject(validDraft())).toBe(true);
  });

  it('accepts a fully-populated DraftProject with all optional fields', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: ['en', 'fr'],
      targetProjectId: 'tgt-project',
      suggestedName: 'My Draft',
      suggestedDescription: 'A description',
      analysis: emptyAnalysis(),
      dirty: true,
    };

    expect(isDraftProject(draft)).toBe(true);
  });

  it('rejects a non-object value', () => {
    expect(isDraftProject('not an object')).toBe(false);
  });

  it('rejects null', () => {
    // `JSON.parse('null')` yields a real null payload (typed unknown) without a bare null literal,
    // which the no-null lint rule forbids; this mirrors parsing a stored draft that is literally null.
    expect(isDraftProject(JSON.parse('null'))).toBe(false);
  });

  it('rejects an object missing sourceProjectId', () => {
    const draft: unknown = {
      analysisLanguages: [],
      analysis: emptyAnalysis(),
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects a non-string sourceProjectId', () => {
    const draft: unknown = {
      sourceProjectId: 42,
      analysisLanguages: [],
      analysis: emptyAnalysis(),
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects an object missing analysisLanguages', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysis: emptyAnalysis(),
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects analysisLanguages that is not an array', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: 'en',
      analysis: emptyAnalysis(),
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects analysisLanguages containing a non-string element', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: ['en', 7],
      analysis: emptyAnalysis(),
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects an object missing dirty', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: [],
      analysis: emptyAnalysis(),
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects a non-boolean dirty', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: [],
      analysis: emptyAnalysis(),
      dirty: 'yes',
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects a wrong-typed targetProjectId', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: [],
      targetProjectId: 99,
      analysis: emptyAnalysis(),
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects a wrong-typed suggestedName', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: [],
      suggestedName: 123,
      analysis: emptyAnalysis(),
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects a wrong-typed suggestedDescription', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: [],
      suggestedDescription: false,
      analysis: emptyAnalysis(),
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects an object missing analysis', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: [],
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });

  it('rejects an object whose analysis fails isTextAnalysis', () => {
    const draft: unknown = {
      sourceProjectId: 'src-project',
      analysisLanguages: [],
      analysis: { segmentAnalyses: [] },
      dirty: false,
    };

    expect(isDraftProject(draft)).toBe(false);
  });
});
