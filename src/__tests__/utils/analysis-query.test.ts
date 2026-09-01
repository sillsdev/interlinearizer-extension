/// <reference types="jest" />

import type { AssignmentStatus, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { Collator } from 'platform-bible-utils';
import { emptyAnalysis } from '../../types/empty-factories';
import { FIXTURE_STAMPS } from '../test-helpers';
import {
  applyCatalogQuery,
  buildCatalogRows,
  deriveFacets,
  reconcileFilters,
  type CatalogFilters,
  type CatalogQuery,
  type CatalogScope,
} from '../../utils/analysis-query';

const scope: CatalogScope = { analysisLanguage: 'en', currentBook: 'GEN' };

/** Builds a query that neither searches nor filters, so each test varies one dimension. */
function makeQuery(overrides: Partial<CatalogQuery> = {}): CatalogQuery {
  return {
    search: '',
    sort: 'usageCount',
    filters: {},
    surfaceCollator: new Collator('el'),
    glossCollator: new Collator('en'),
    ...overrides,
  };
}

/** Builds a link from `tokenRef` to the analysis, approved unless another status is given. */
function link(
  analysisId: string,
  tokenRef: string,
  status: AssignmentStatus = 'approved',
): TokenAnalysisLink {
  return { ...FIXTURE_STAMPS, analysisId, status, token: { tokenRef, surfaceText: 'word' } };
}

describe('buildCatalogRows', () => {
  it('builds one row per token analysis, carrying its id and surface form', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'λόγος' },
      ],
    };

    expect(buildCatalogRows(analysis, scope).map((r) => [r.analysisId, r.surfaceText])).toEqual([
      ['ta-1', 'ἀρχῇ'],
      ['ta-2', 'λόγος'],
    ]);
  });

  it('counts each approved link on a payload as a usage', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-1', 'GEN 1:2:4')],
    };

    expect(buildCatalogRows(analysis, scope)[0].usageCount).toBe(2);
  });

  // The data model allows a token only one approved analysis, so a second link on it is a
  // duplicate rather than a second place the analysis is applied.
  it('counts a token carrying the same approval twice as one usage', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-1', 'GEN 1:1:0')],
    };

    expect(buildCatalogRows(analysis, scope)[0].usageCount).toBe(1);
  });

  it('does not count a rejected link as a usage', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0', 'rejected')],
    };

    expect(buildCatalogRows(analysis, scope)[0].usageCount).toBe(0);
  });

  it('lists a payload with no links at all as a zero-usage row', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
    };

    expect(buildCatalogRows(analysis, scope)).toHaveLength(1);
    expect(buildCatalogRows(analysis, scope)[0].usageCount).toBe(0);
  });

  it('counts only usages in the scope book toward the per-book count', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [
        link('ta-1', 'GEN 1:1:0'),
        link('ta-1', 'GEN 1:2:4'),
        link('ta-1', 'JHN 1:1:0'),
      ],
    };

    const [row] = buildCatalogRows(analysis, scope);
    expect(row.usageCount).toBe(3);
    expect(row.usageCountInBook).toBe(2);
  });

  it('parses a usage location out of the token ref', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:5:12')],
    };

    expect(buildCatalogRows(analysis, scope)[0].usages).toEqual([
      { tokenRef: 'GEN 1:5:12', book: 'GEN', chapter: 1, verse: 5, charStart: 12 },
    ]);
  });

  // A USJ verse sid is verbatim, so a bridged verse reaches the catalog as "GEN 1:3-4".
  it('resolves a bridged verse sid to its first verse', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:3-4:0')],
    };

    expect(buildCatalogRows(analysis, scope)[0].usages[0].verse).toBe(3);
  });

  // EXO precedes ACT canonically but follows it alphabetically, so the order cannot come from the
  // ref strings.
  it('orders usages by document position across books', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [
        link('ta-1', 'ACT 1:1:0'),
        link('ta-1', 'EXO 2:1:0'),
        link('ta-1', 'EXO 1:2:5'),
        link('ta-1', 'EXO 1:2:0'),
        link('ta-1', 'EXO 1:1:0'),
      ],
    };

    expect(buildCatalogRows(analysis, scope)[0].usages.map((u) => u.tokenRef)).toEqual([
      'EXO 1:1:0',
      'EXO 1:2:0',
      'EXO 1:2:5',
      'EXO 2:1:0',
      'ACT 1:1:0',
    ]);
  });
});

/** An analysis whose morpheme form and gloss share no text with the token's surface form. */
const analyzedEimi: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [
    {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'ἦν',
      morphemes: [{ id: 'm-1', form: 'εἰμί', writingSystem: 'grc', gloss: { en: 'to be' } }],
    },
  ],
};

/**
 * One analysis holding the same single letter in every field a search reads, so a query for more
 * than that letter can only match by reaching across fields — whichever pair it reaches for, and
 * whatever order they are assembled in.
 */
const singleLetterFields: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [
    {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'a',
      gloss: { en: 'a', fr: 'a' },
      morphemes: [
        { id: 'm-1', form: 'a', writingSystem: 'en', gloss: { en: 'a' } },
        { id: 'm-2', form: 'a', writingSystem: 'en', gloss: { en: 'a' } },
      ],
    },
  ],
};

describe('applyCatalogQuery search', () => {
  it('finds a row by a gloss in a language other than the active one', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        {
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'λόγος',
          gloss: { en: 'word', fr: 'parole' },
        },
      ],
    };
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'parole' }))).toHaveLength(1);
  });

  it('finds a row by a morpheme form', () => {
    const rows = buildCatalogRows(analyzedEimi, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'ειμι' }))).toHaveLength(1);
  });

  it('finds a row by a morpheme gloss', () => {
    const rows = buildCatalogRows(analyzedEimi, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'to be' }))).toHaveLength(1);
  });

  // Both words are present, but only as separate fields.
  it('matches the whole query as one substring rather than splitting it into terms', () => {
    const rows = buildCatalogRows(analyzedEimi, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'ην to be' }))).toHaveLength(0);
  });

  // The lone letter matching is what makes the misses meaningful: the text is searchable, and only
  // the reach across a boundary is not.
  it('matches no row on a query reaching past a single field, however it spells the gap', () => {
    const rows = buildCatalogRows(singleLetterFields, scope);
    const hits = (search: string) => applyCatalogQuery(rows, makeQuery({ search })).length;

    expect(hits('a')).toBe(1);
    expect(hits('aa')).toBe(0);
    expect(hits('a a')).toBe(0);
    expect(hits('a\na')).toBe(0);
  });

  // The gloss is one field, so the query has to fold to the space inside it rather than to a
  // carriage return no field can hold.
  it('finds a row on a query carrying a pasted Windows line ending', () => {
    const rows = buildCatalogRows(analyzedEimi, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'to\r\nbe' }))).toHaveLength(1);
  });

  // A gloss holding a line break of its own would otherwise spell the separator no match may span.
  it('finds a row by a gloss whose own line break the query spells as a space', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'spoken\nword' } },
      ],
    };
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'spoken word' }))).toHaveLength(1);
  });

  // No keyboard types a vertical tab, so a gloss carrying one arrived as imported text.
  it('finds a row by a gloss whose line break is not a newline', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'spoken\vword' } },
      ],
    };
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'spoken word' }))).toHaveLength(1);
  });

  // The marks fold away, leaving the empty query rather than one nothing can match.
  it('keeps every row on a query made only of combining marks', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχῇ' },
      ],
    };
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: '\u0301\u0308' }))).toHaveLength(2);
  });

  it('ignores whitespace around the query, which a typed or pasted search carries', () => {
    const rows = buildCatalogRows(analyzedEimi, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: '  to be  ' }))).toHaveLength(1);
  });

  // The tonos folds to a bare space, which is whitespace only once the fold has run.
  it('ignores a leading character of the query that folds to a space', () => {
    const rows = buildCatalogRows(analyzedEimi, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: '΄to be' }))).toHaveLength(1);
  });

  // Both sides fold, so the word-final sigma the text carries meets the ordinary one typed.
  it('finds a row whose surface form ends in a letter the query spells mid-word', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } },
      ],
    };
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'λογοσ' }))).toHaveLength(1);
  });
});

describe('applyCatalogQuery sort', () => {
  const analysis: TextAnalysis = {
    ...emptyAnalysis(),
    tokenAnalyses: [
      { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
      { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
      { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'c' },
    ],
    tokenAnalysisLinks: [
      link('ta-1', 'GEN 1:1:0'),
      link('ta-2', 'GEN 1:2:0'),
      link('ta-2', 'GEN 1:3:0'),
      link('ta-2', 'GEN 1:4:0'),
      link('ta-3', 'GEN 1:5:0'),
      link('ta-3', 'GEN 1:6:0'),
    ],
  };

  it('orders by usage count, most used first', () => {
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'usageCount' })).map((r) => r.analysisId)) //
      .toEqual(['ta-2', 'ta-3', 'ta-1']);
  });

  it('collates surface forms by the source language rather than by code point', () => {
    const greek: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'βίβλος' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'ἀρχή' },
      ],
    };
    // Code-point order would leave these as given: the accented alpha sits in the Greek Extended
    // block, above beta.
    expect('βίβλος' < 'ἀρχή').toBe(true);
    const rows = buildCatalogRows(greek, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'surfaceText' })).map((r) => r.analysisId)) //
      .toEqual(['ta-2', 'ta-1']);
  });

  it('orders by usage count in the scope book, most used first', () => {
    // ta-1 is the more used analysis overall, ta-2 the more used one in GEN.
    const acrossBooks: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
      ],
      tokenAnalysisLinks: [
        link('ta-1', 'GEN 1:1:0'),
        link('ta-1', 'JHN 1:1:0'),
        link('ta-1', 'JHN 1:2:0'),
        link('ta-2', 'GEN 1:2:0'),
        link('ta-2', 'GEN 1:3:0'),
      ],
    };
    const rows = buildCatalogRows(acrossBooks, scope);

    expect(
      applyCatalogQuery(rows, makeQuery({ sort: 'usageCountInBook' })).map((r) => r.analysisId),
    ).toEqual(['ta-2', 'ta-1']);
  });

  // Swedish collates "ä" after "z"; English collates it near "a". Passing the Swedish collator
  // proves the query's collator decides, not a default.
  it('collates glosses with the query collator', () => {
    const glossed: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', gloss: { en: 'äpple' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b', gloss: { en: 'zebra' } },
      ],
    };
    const rows = buildCatalogRows(glossed, scope);
    const sortByGloss = (glossCollator: Collator) =>
      applyCatalogQuery(rows, makeQuery({ sort: 'gloss', glossCollator })).map((r) => r.analysisId);

    expect(sortByGloss(new Collator('sv'))).toEqual(['ta-2', 'ta-1']);
    expect(sortByGloss(new Collator('en'))).toEqual(['ta-1', 'ta-2']);
  });

  // Collating alone would open the list with ta-2: a missing gloss is the empty string, which sorts
  // ahead of every word.
  it('sorts a row with no gloss in the scope language after every glossed one', () => {
    const partlyGlossed: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', gloss: { en: 'zebra' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b', gloss: { fr: 'parole' } },
        { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'c', gloss: { en: 'apple' } },
      ],
    };
    const rows = buildCatalogRows(partlyGlossed, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'gloss' })).map((r) => r.analysisId)) //
      .toEqual(['ta-3', 'ta-1', 'ta-2']);
  });

  it('orders two rows that both lack a gloss by surface form', () => {
    const unglossed: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'β' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'α' },
      ],
    };
    const rows = buildCatalogRows(unglossed, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'gloss' })).map((r) => r.analysisId)) //
      .toEqual(['ta-2', 'ta-1']);
  });

  // ta-1 is the more used analysis, so a count sort would put it first; ta-2 appears earlier.
  it('orders by the first usage in document order', () => {
    const spread: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
      ],
      tokenAnalysisLinks: [
        link('ta-1', 'JHN 1:1:0'),
        link('ta-1', 'JHN 1:2:0'),
        link('ta-1', 'JHN 1:3:0'),
        link('ta-2', 'GEN 1:1:0'),
      ],
    };
    const rows = buildCatalogRows(spread, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'firstUsage' })).map((r) => r.analysisId)) //
      .toEqual(['ta-2', 'ta-1']);
  });

  it('puts rows with no usages last in first-usage order', () => {
    const someUnused: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
        { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'c' },
        { ...FIXTURE_STAMPS, id: 'ta-4', surfaceText: 'd' },
      ],
      tokenAnalysisLinks: [
        link('ta-2', 'JHN 1:1:0'),
        link('ta-2', 'JHN 1:2:0'),
        link('ta-2', 'JHN 1:3:0'),
        link('ta-3', 'GEN 1:1:0'),
      ],
    };
    const rows = buildCatalogRows(someUnused, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'firstUsage' })).map((r) => r.analysisId)) //
      .toEqual(['ta-3', 'ta-2', 'ta-1', 'ta-4']);
  });

  // Every row here is unused, so the count sort separates none of them.
  it('orders rows the sort key cannot separate by surface form', () => {
    const tied: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'γ' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'β' },
        { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'α' },
      ],
    };
    const rows = buildCatalogRows(tied, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'usageCount' })).map((r) => r.analysisId)) //
      .toEqual(['ta-3', 'ta-2', 'ta-1']);
  });

  it('orders two rows sharing a surface form by gloss', () => {
    const homographs: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'α', gloss: { en: 'second' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'α', gloss: { en: 'first' } },
      ],
    };
    const rows = buildCatalogRows(homographs, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'usageCount' })).map((r) => r.analysisId)) //
      .toEqual(['ta-2', 'ta-1']);
  });
});

/** Analyses with and without a morpheme breakdown. */
const mixedBreakdowns: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [
    {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'a',
      morphemes: [{ id: 'm-1', form: 'a', writingSystem: 'grc' }],
    },
    { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
  ],
};

/** Analyses tagged across every closed vocabulary, alongside an untagged analysis to filter out. */
const tagged: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [
    {
      ...FIXTURE_STAMPS,
      id: 'ta-1',
      surfaceText: 'a',
      pos: 'noun',
      confidence: 'high',
      features: { Number: 'Sg', Case: 'Nom' },
    },
    {
      ...FIXTURE_STAMPS,
      id: 'ta-2',
      surfaceText: 'b',
      pos: 'verb',
      confidence: 'guess',
      features: { Number: 'Pl' },
    },
    { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'c' },
  ],
};

describe('applyCatalogQuery filters', () => {
  it('keeps only rows used in one of the selected books', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
        { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'c' },
      ],
      tokenAnalysisLinks: [
        link('ta-1', 'GEN 1:1:0'),
        link('ta-2', 'JHN 1:1:0'),
        link('ta-3', 'GEN 1:2:0'),
        link('ta-3', 'MRK 1:1:0'),
      ],
    };
    const rows = buildCatalogRows(analysis, scope);
    const query = makeQuery({ filters: { books: ['JHN', 'MRK'] } });

    // The query's default sort puts the more-used ta-3 first.
    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-3', 'ta-2']);
  });

  it('keeps only unused rows when filtering for zero usages', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0')],
    };
    const rows = buildCatalogRows(analysis, scope);
    const query = makeQuery({ filters: { zeroUsages: true } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-2']);
  });

  // ta-2 is glossed, just not in the scope's language, so an any-language check would drop it.
  it('keeps a row glossed only in another language when filtering for a missing gloss', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', gloss: { en: 'word' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b', gloss: { fr: 'parole' } },
      ],
    };
    const rows = buildCatalogRows(analysis, scope);
    const query = makeQuery({ filters: { missingGloss: true } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-2']);
  });

  // A blank gloss reaches storage only in a project file, never from an edit.
  it('keeps a row whose stored gloss is only whitespace when filtering for a missing gloss', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', gloss: { en: 'word' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b', gloss: { en: '  ' } },
      ],
    };
    const rows = buildCatalogRows(analysis, scope);
    const query = makeQuery({ filters: { missingGloss: true } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-2']);
  });

  it('keeps only rows with a morpheme breakdown when filtering for one', () => {
    const rows = buildCatalogRows(mixedBreakdowns, scope);
    const query = makeQuery({ filters: { morphemes: 'has' } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-1']);
  });

  it('keeps only rows without a morpheme breakdown when filtering against one', () => {
    const rows = buildCatalogRows(mixedBreakdowns, scope);
    const query = makeQuery({ filters: { morphemes: 'lacks' } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-2']);
  });

  it('keeps only rows carrying one of the selected parts of speech', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { pos: ['noun'] } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-1']);
  });

  it('drops a row carrying no part of speech at all when filtering on one', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { pos: ['noun', 'verb'] } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-1', 'ta-2']);
  });

  it('keeps only rows carrying no part of speech when that is the selected choice', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { pos: [undefined] } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-3']);
  });

  it('keeps rows carrying no feature value alongside those carrying a selected one', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { features: { Case: ['Nom', undefined] } } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual([
      'ta-1',
      'ta-2',
      'ta-3',
    ]);
  });

  it('keeps only rows carrying one of the selected confidence levels', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { confidence: ['guess'] } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-2']);
  });

  it('keeps only rows matching the selected value of a feature', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { features: { Number: ['Sg'] } } });

    expect(applyCatalogQuery(rows, query).map((r) => r.analysisId)).toEqual(['ta-1']);
  });

  // ta-1 is the only Sg row, and its Case is Nom rather than Acc, so nothing satisfies both.
  it('requires a row to match every feature named in the selection', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { features: { Number: ['Sg'], Case: ['Acc'] } } });

    expect(applyCatalogQuery(rows, query)).toHaveLength(0);
  });

  it('treats an empty book selection as no filter rather than as an impossible one', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { books: [] } });

    expect(applyCatalogQuery(rows, query)).toHaveLength(rows.length);
  });

  it('treats an empty chosen-value selection as no filter', () => {
    const rows = buildCatalogRows(tagged, scope);
    const query = makeQuery({ filters: { pos: [], confidence: [], features: { Number: [] } } });

    expect(applyCatalogQuery(rows, query)).toHaveLength(rows.length);
  });
});

describe('deriveFacets', () => {
  it('offers a book facet once the rows span more than one book', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
      ],
      tokenAnalysisLinks: [link('ta-1', 'JHN 1:1:0'), link('ta-2', 'GEN 1:1:0')],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).books).toEqual(['GEN', 'JHN']);
  });

  it('hides the book facet when every row sits in one book', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 1:2:0')],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).books).toBeUndefined();
  });

  it('offers a part-of-speech facet once the rows disagree', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', pos: 'noun' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b', pos: 'verb' },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).pos).toEqual(['noun', 'verb']);
  });

  it('offers a confidence facet once the rows disagree', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', confidence: 'high' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b', confidence: 'guess' },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).confidence).toEqual(['high', 'guess']);
  });

  // Number varies across the rows; Case does not, so only Number earns a facet.
  it('offers a facet per feature name the rows disagree on', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        {
          ...FIXTURE_STAMPS,
          id: 'ta-1',
          surfaceText: 'a',
          features: { Case: 'Nom', Number: 'Sg' },
        },
        {
          ...FIXTURE_STAMPS,
          id: 'ta-2',
          surfaceText: 'b',
          features: { Case: 'Nom', Number: 'Pl' },
        },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).features).toEqual({
      Number: ['Pl', 'Sg'],
    });
  });

  // ta-3 carries no Number, which is a choice of the facet rather than an omission from it.
  it('offers the untagged choice on a feature only some rows carry', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', features: { Number: 'Sg' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b', features: { Number: 'Pl' } },
        { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'c' },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).features).toStrictEqual({
      Number: ['Pl', 'Sg', undefined],
    });
  });

  it('offers a part-of-speech facet where a single row is tagged and the rest are not', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', pos: 'noun' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).pos).toStrictEqual(['noun', undefined]);
  });

  it('hides the part-of-speech facet when every row carries the same one', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a', pos: 'noun' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b', pos: 'noun' },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).pos).toBeUndefined();
  });

  // Nothing in the app writes pos, features, or confidence yet, so an analysis shaped the way the
  // gloss and morpheme write paths shape it must not raise a dropdown with nothing behind it.
  it('derives no facet from fields no write path populates', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'beginning' } },
        {
          ...FIXTURE_STAMPS,
          id: 'ta-2',
          surfaceText: 'ἦν',
          gloss: { en: 'was' },
          morphemes: [{ id: 'm-1', form: 'εἰμί', writingSystem: 'grc', gloss: { en: 'to be' } }],
        },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'JHN 1:1:0')],
    };

    const facets = deriveFacets(buildCatalogRows(analysis, scope));
    expect(facets.pos).toBeUndefined();
    expect(facets.confidence).toBeUndefined();
    expect(facets.features).toBeUndefined();
    expect(facets.books).toEqual(['GEN', 'JHN']);
  });
});

describe('reconcileFilters', () => {
  it('drops a selection whose facet is no longer offered', () => {
    const filters = reconcileFilters({ books: ['EXO'] }, { books: undefined });

    expect(filters.books).toBeUndefined();
  });

  it('drops only the chosen values the facet stopped offering', () => {
    const filters = reconcileFilters({ books: ['GEN', 'EXO'] }, { books: ['GEN', 'JHN'] });

    expect(filters.books).toEqual(['GEN']);
  });

  it('drops a selection whose every choice the facet stopped offering', () => {
    const filters = reconcileFilters({ books: ['EXO'] }, { books: ['GEN', 'JHN'] });

    expect(filters.books).toBeUndefined();
  });

  it('keeps a selection the facet still offers whole', () => {
    const filters = reconcileFilters({ books: ['GEN'] }, { books: ['GEN', 'JHN'] });

    expect(filters.books).toEqual(['GEN']);
  });

  it('returns the same object when every selection survives', () => {
    const chosen: CatalogFilters = { books: ['GEN'], missingGloss: true };

    expect(reconcileFilters(chosen, { books: ['GEN', 'JHN'] })).toBe(chosen);
  });

  it('leaves the filters no facet governs untouched', () => {
    const filters = reconcileFilters(
      { books: ['EXO'], missingGloss: true, zeroUsages: true, morphemes: 'has' },
      { books: undefined },
    );

    expect(filters.missingGloss).toBe(true);
    expect(filters.zeroUsages).toBe(true);
    expect(filters.morphemes).toBe('has');
  });

  it('drops a feature selection whose name lost its facet', () => {
    const filters = reconcileFilters(
      { features: { case: ['nom'], number: ['sg'] } },
      { features: { number: ['sg', 'pl'] } },
    );

    expect(filters.features).toEqual({ number: ['sg'] });
  });

  it('drops the feature filter entirely once no name survives', () => {
    const filters = reconcileFilters({ features: { case: ['nom'] } }, { features: undefined });

    expect(filters.features).toBeUndefined();
  });

  it('keeps the untagged choice while its facet still offers it', () => {
    const filters = reconcileFilters({ pos: [undefined] }, { pos: ['noun', undefined] });

    expect(filters.pos).toEqual([undefined]);
  });

  // Reconciliation withdraws choices; it does not re-interpret the ones it keeps.
  it('leaves a surviving selection narrowing the same rows', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'a' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'b' },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'JHN 1:1:0')],
    };
    const rows = buildCatalogRows(analysis, scope);
    const filters = reconcileFilters({ books: ['GEN'] }, deriveFacets(rows));

    expect(applyCatalogQuery(rows, makeQuery({ filters })).map((row) => row.analysisId)).toEqual([
      'ta-1',
    ]);
  });
});
