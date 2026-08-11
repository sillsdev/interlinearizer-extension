/// <reference types="jest" />

import type { AssignmentStatus, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import {
  applyCatalogQuery,
  buildCatalogRows,
  deriveFacets,
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
    surfaceCollator: new Intl.Collator('el'),
    glossCollator: new Intl.Collator('en'),
    ...overrides,
  };
}

/** Builds a link from `tokenRef` to the analysis, approved unless another status is given. */
function link(
  analysisId: string,
  tokenRef: string,
  status: AssignmentStatus = 'approved',
): TokenAnalysisLink {
  return { analysisId, status, token: { tokenRef, surfaceText: 'word' } };
}

describe('buildCatalogRows', () => {
  it('builds one row per token analysis, carrying its id and surface form', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'ἀρχῇ' },
        { id: 'ta-2', surfaceText: 'λόγος' },
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
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-1', 'GEN 1:2:4')],
    };

    expect(buildCatalogRows(analysis, scope)[0].usageCount).toBe(2);
  });

  it('does not count a rejected link as a usage', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0', 'rejected')],
    };

    expect(buildCatalogRows(analysis, scope)[0].usageCount).toBe(0);
  });

  it('lists a payload with no links at all as a zero-usage row', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος' }],
    };

    expect(buildCatalogRows(analysis, scope)).toHaveLength(1);
    expect(buildCatalogRows(analysis, scope)[0].usageCount).toBe(0);
  });

  it('counts only usages in the scope book toward the per-book count', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος' }],
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
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος' }],
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
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος' }],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:3-4:0')],
    };

    expect(buildCatalogRows(analysis, scope)[0].usages[0].verse).toBe(3);
  });

  // EXO precedes ACT canonically but follows it alphabetically, so the order cannot come from the
  // ref strings.
  it('orders usages by document position across books', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος' }],
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
      id: 'ta-1',
      surfaceText: 'ἦν',
      morphemes: [{ id: 'm-1', form: 'εἰμί', writingSystem: 'grc', gloss: { en: 'to be' } }],
    },
  ],
};

describe('applyCatalogQuery search', () => {
  it('finds a row by a gloss in a language other than the active one', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word', fr: 'parole' } }],
    };
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'parole' }))).toHaveLength(1);
  });

  // The morpheme form is suppletive, so a match cannot come from the surface form instead.
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

  // The two fields are adjacent in the folded text, so only the newline between them is in the way.
  it('matches no row on a query carrying the newline that separates two fields', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } }],
    };
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'λογος\nword' }))).toHaveLength(0);
  });

  it('ignores whitespace around the query, which a typed or pasted search carries', () => {
    const rows = buildCatalogRows(analyzedEimi, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: '  to be  ' }))).toHaveLength(1);
  });

  // Both sides fold, so the word-final sigma the text carries meets the ordinary one typed.
  it('finds a row whose surface form ends in a letter the query spells mid-word', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ id: 'ta-1', surfaceText: 'λόγος', gloss: { en: 'word' } }],
    };
    const rows = buildCatalogRows(analysis, scope);

    expect(applyCatalogQuery(rows, makeQuery({ search: 'λογοσ' }))).toHaveLength(1);
  });
});

describe('applyCatalogQuery sort', () => {
  const analysis: TextAnalysis = {
    ...emptyAnalysis(),
    tokenAnalyses: [
      { id: 'ta-1', surfaceText: 'a' },
      { id: 'ta-2', surfaceText: 'b' },
      { id: 'ta-3', surfaceText: 'c' },
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
        { id: 'ta-1', surfaceText: 'βίβλος' },
        { id: 'ta-2', surfaceText: 'ἀρχή' },
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
        { id: 'ta-1', surfaceText: 'a' },
        { id: 'ta-2', surfaceText: 'b' },
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
        { id: 'ta-1', surfaceText: 'a', gloss: { en: 'äpple' } },
        { id: 'ta-2', surfaceText: 'b', gloss: { en: 'zebra' } },
      ],
    };
    const rows = buildCatalogRows(glossed, scope);
    const sortByGloss = (glossCollator: Intl.Collator) =>
      applyCatalogQuery(rows, makeQuery({ sort: 'gloss', glossCollator })).map((r) => r.analysisId);

    expect(sortByGloss(new Intl.Collator('sv'))).toEqual(['ta-2', 'ta-1']);
    expect(sortByGloss(new Intl.Collator('en'))).toEqual(['ta-1', 'ta-2']);
  });

  // ta-1 is the more used analysis, so a count sort would put it first; ta-2 appears earlier.
  it('orders by the first usage in document order', () => {
    const spread: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'a' },
        { id: 'ta-2', surfaceText: 'b' },
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
        { id: 'ta-1', surfaceText: 'a' },
        { id: 'ta-2', surfaceText: 'b' },
        { id: 'ta-3', surfaceText: 'c' },
        { id: 'ta-4', surfaceText: 'd' },
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
        { id: 'ta-1', surfaceText: 'γ' },
        { id: 'ta-2', surfaceText: 'β' },
        { id: 'ta-3', surfaceText: 'α' },
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
        { id: 'ta-1', surfaceText: 'α', gloss: { en: 'second' } },
        { id: 'ta-2', surfaceText: 'α', gloss: { en: 'first' } },
      ],
    };
    const rows = buildCatalogRows(homographs, scope);

    expect(applyCatalogQuery(rows, makeQuery({ sort: 'usageCount' })).map((r) => r.analysisId)) //
      .toEqual(['ta-2', 'ta-1']);
  });
});

/** One analysis with a morpheme breakdown and one without. */
const mixedBreakdowns: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [
    {
      id: 'ta-1',
      surfaceText: 'a',
      morphemes: [{ id: 'm-1', form: 'a', writingSystem: 'grc' }],
    },
    { id: 'ta-2', surfaceText: 'b' },
  ],
};

/** Two analyses tagged across every closed vocabulary, and one tagged with none of them. */
const tagged: TextAnalysis = {
  ...emptyAnalysis(),
  tokenAnalyses: [
    {
      id: 'ta-1',
      surfaceText: 'a',
      pos: 'noun',
      confidence: 'high',
      features: { Number: 'Sg', Case: 'Nom' },
    },
    { id: 'ta-2', surfaceText: 'b', pos: 'verb', confidence: 'guess', features: { Number: 'Pl' } },
    { id: 'ta-3', surfaceText: 'c' },
  ],
};

describe('applyCatalogQuery filters', () => {
  it('keeps only rows used in one of the selected books', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'a' },
        { id: 'ta-2', surfaceText: 'b' },
        { id: 'ta-3', surfaceText: 'c' },
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
        { id: 'ta-1', surfaceText: 'a' },
        { id: 'ta-2', surfaceText: 'b' },
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
        { id: 'ta-1', surfaceText: 'a', gloss: { en: 'word' } },
        { id: 'ta-2', surfaceText: 'b', gloss: { fr: 'parole' } },
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
        { id: 'ta-1', surfaceText: 'a' },
        { id: 'ta-2', surfaceText: 'b' },
      ],
      tokenAnalysisLinks: [link('ta-1', 'JHN 1:1:0'), link('ta-2', 'GEN 1:1:0')],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).books).toEqual(['GEN', 'JHN']);
  });

  it('hides the book facet when every row sits in one book', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'a' },
        { id: 'ta-2', surfaceText: 'b' },
      ],
      tokenAnalysisLinks: [link('ta-1', 'GEN 1:1:0'), link('ta-2', 'GEN 1:2:0')],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).books).toBeUndefined();
  });

  it('offers a part-of-speech facet once the rows disagree', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'a', pos: 'noun' },
        { id: 'ta-2', surfaceText: 'b', pos: 'verb' },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).pos).toEqual(['noun', 'verb']);
  });

  it('offers a confidence facet once the rows disagree', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'a', confidence: 'high' },
        { id: 'ta-2', surfaceText: 'b', confidence: 'guess' },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).confidence).toEqual(['high', 'guess']);
  });

  // Number varies across the rows; Case does not, so only Number earns a facet.
  it('offers a facet per feature name the rows disagree on', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'a', features: { Case: 'Nom', Number: 'Sg' } },
        { id: 'ta-2', surfaceText: 'b', features: { Case: 'Nom', Number: 'Pl' } },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).features).toEqual({
      Number: ['Pl', 'Sg'],
    });
  });

  it('draws a feature facet from the rows that carry the feature at all', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'a', features: { Number: 'Sg' } },
        { id: 'ta-2', surfaceText: 'b', features: { Number: 'Pl' } },
        { id: 'ta-3', surfaceText: 'c' },
      ],
    };

    expect(deriveFacets(buildCatalogRows(analysis, scope)).features).toEqual({
      Number: ['Pl', 'Sg'],
    });
  });

  // Nothing in the app writes pos, features, or confidence yet, so an analysis shaped the way the
  // gloss and morpheme write paths shape it must not raise a dropdown with nothing behind it.
  it('derives no facet from fields no write path populates', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { id: 'ta-1', surfaceText: 'ἀρχῇ', gloss: { en: 'beginning' } },
        {
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
