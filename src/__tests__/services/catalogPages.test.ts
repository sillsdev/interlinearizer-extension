/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { emptyAnalysis } from '../../types/empty-factories';
import { FIXTURE_STAMPS } from '../test-helpers';
import {
  countUsages,
  getCatalogPage,
  getHomographRows,
  getRowsByIds,
  restoreUntagged,
  summarizeSelection,
  type CatalogPageRequest,
} from '../../services/catalogPages';
import type { CatalogScope } from '../../utils/analysis-query';

const scope: CatalogScope = { analysisLanguage: 'en', currentBook: 'GEN' };

/** Builds a request that neither searches nor filters, sorted by surface form, from the start. */
function makeRequest(overrides: Partial<CatalogPageRequest> = {}): CatalogPageRequest {
  return {
    search: '',
    sort: 'surfaceText',
    filters: {},
    sourceLanguageTag: 'en',
    offset: 0,
    count: 50,
    ...overrides,
  };
}

/** Builds an approved link from `tokenRef` to the analysis. */
function link(analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    id: `${tokenRef}:${analysisId}`,
    ...FIXTURE_STAMPS,
    analysisId,
    status: 'approved',
    token: { tokenRef, surfaceText: 'word' },
  };
}

/** An analysis of five words, one analysis each, so sorting by surface form orders them a–e. */
function fiveWords(): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: ['d', 'b', 'e', 'a', 'c'].map((surfaceText) => ({
      ...FIXTURE_STAMPS,
      id: `ta-${surfaceText}`,
      surfaceText,
    })),
    tokenAnalysisLinks: [link('ta-a', 'GEN 1:1:0')],
  };
}

const formInText = () => true;

describe('getCatalogPage', () => {
  it('returns the rows from the offset onward, as many as the count asks for', () => {
    const page = getCatalogPage(
      fiveWords(),
      scope,
      makeRequest({ offset: 1, count: 2 }),
      formInText,
    );

    expect(page.rows.map((r) => r.surfaceText)).toEqual(['b', 'c']);
  });

  it('keeps only rows whose form the text lacks under the not-in-text filter', () => {
    const page = getCatalogPage(
      fiveWords(),
      scope,
      makeRequest({ filters: { notInText: true } }),
      (form) => form !== 'b' && form !== 'd',
    );

    expect(page.rows.map((r) => r.surfaceText)).toEqual(['b', 'd']);
  });

  it('lists the id of every row the query keeps, in order, beyond the page', () => {
    const page = getCatalogPage(
      fiveWords(),
      scope,
      makeRequest({ offset: 1, count: 1 }),
      formInText,
    );

    expect(page.keptIds).toEqual(['ta-a', 'ta-b', 'ta-c', 'ta-d', 'ta-e']);
  });

  it('flags each row whose normalized form another row shares', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'Run' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'run' },
        { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'dog' },
      ],
    };

    const page = getCatalogPage(analysis, scope, makeRequest(), formInText);

    expect(Object.fromEntries(page.rows.map((r) => [r.analysisId, r.hasHomograph]))).toEqual({
      'ta-1': true,
      'ta-2': true,
      'ta-3': false,
    });
  });

  it("marks each row whose form the text lacks, once the text's forms are known", () => {
    const page = getCatalogPage(fiveWords(), scope, makeRequest(), (form) => form !== 'b');

    expect(page.rows.filter((r) => r.isNotInText).map((r) => r.analysisId)).toEqual(['ta-b']);
  });

  it('marks no row as not in the text while the text is unread', () => {
    const page = getCatalogPage(fiveWords(), scope, makeRequest(), () => undefined);

    expect(page.rows.some((r) => r.isNotInText)).toBe(false);
  });

  it('counts every row the draft holds, whatever the query keeps', () => {
    const page = getCatalogPage(
      fiveWords(),
      scope,
      makeRequest({ search: 'nothing matches this' }),
      formInText,
    );

    expect(page.rowCount).toBe(5);
  });

  it('offers facets taken against every row, not only the rows the filters keep', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'run', pos: 'verb' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'dog', pos: 'noun' },
      ],
    };

    const page = getCatalogPage(
      analysis,
      scope,
      makeRequest({ filters: { pos: ['noun'] } }),
      formInText,
    );

    expect(page.facets.pos).toEqual(['noun', 'verb']);
  });
});

describe('countUsages', () => {
  it('counts a token approving several of the analyses once', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'run' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'run' },
      ],
      tokenAnalysisLinks: [
        link('ta-1', 'GEN 1:1:0'),
        link('ta-2', 'GEN 1:1:0'),
        link('ta-2', 'GEN 1:2:0'),
      ],
    };

    expect(countUsages(analysis, ['ta-1', 'ta-2'])).toBe(2);
  });

  it('leaves out tokens whose link to the analysis is not approved', () => {
    const analysis: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'run' }],
      tokenAnalysisLinks: [
        link('ta-1', 'GEN 1:1:0'),
        { ...link('ta-1', 'GEN 1:2:0'), status: 'stale' },
      ],
    };

    expect(countUsages(analysis, ['ta-1'])).toBe(1);
  });
});

describe('getRowsByIds', () => {
  it('returns the rows of the named analyses, in the order named', () => {
    const rows = getRowsByIds(fiveWords(), scope, ['ta-c', 'ta-a']);

    expect(rows.map((r) => r.analysisId)).toEqual(['ta-c', 'ta-a']);
  });

  it('leaves out an id no analysis carries', () => {
    const rows = getRowsByIds(fiveWords(), scope, ['ta-gone', 'ta-a']);

    expect(rows.map((r) => r.analysisId)).toEqual(['ta-a']);
  });
});

describe('getHomographRows', () => {
  /**
   * Three analyses of one form in different cases, used once, three times and twice, beside a
   * fourth of another form.
   */
  function homographs(): TextAnalysis {
    return {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'Run' },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'run' },
        { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'RUN' },
        { ...FIXTURE_STAMPS, id: 'ta-4', surfaceText: 'dog' },
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
  }

  it("returns every row sharing the analysis's normalized form, most used first", () => {
    const rows = getHomographRows(homographs(), scope, 'ta-1');

    expect(rows.map((r) => r.analysisId)).toEqual(['ta-2', 'ta-3', 'ta-1']);
  });

  it('returns no rows for an id no analysis carries', () => {
    expect(getHomographRows(homographs(), scope, 'ta-gone')).toEqual([]);
  });
});

describe('summarizeSelection', () => {
  /**
   * Two homographs and a third word. All but the second are glossed; they are used once, twice and
   * once.
   */
  function selectable(): TextAnalysis {
    return {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'Run', gloss: { en: 'go' } },
        { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'run', gloss: { en: ' ' } },
        { ...FIXTURE_STAMPS, id: 'ta-3', surfaceText: 'dog', gloss: { en: 'hound' } },
      ],
      tokenAnalysisLinks: [
        link('ta-1', 'GEN 1:1:0'),
        link('ta-2', 'GEN 1:2:0'),
        link('ta-2', 'GEN 1:3:0'),
        link('ta-3', 'GEN 1:4:0'),
      ],
    };
  }

  it('counts the distinct tokens the selected analyses are used at', () => {
    expect(summarizeSelection(selectable(), scope, ['ta-1', 'ta-3']).usageCount).toBe(2);
  });

  it('names the selected analyses carrying a gloss in the analysis language, in the order given', () => {
    expect(summarizeSelection(selectable(), scope, ['ta-3', 'ta-2', 'ta-1']).glossedIds).toEqual([
      'ta-3',
      'ta-1',
    ]);
  });

  it('offers to merge homographs into the most used of them', () => {
    expect(summarizeSelection(selectable(), scope, ['ta-1', 'ta-2']).merge).toEqual({
      survivorId: 'ta-2',
      mergedIds: ['ta-1'],
    });
  });

  it('breaks a tie in use for the survivor by the order given', () => {
    const analysis = selectable();
    const tied = {
      ...analysis,
      tokenAnalysisLinks: analysis.tokenAnalysisLinks.filter(
        (l) => l.token.tokenRef !== 'GEN 1:3:0',
      ),
    };

    expect(summarizeSelection(tied, scope, ['ta-2', 'ta-1']).merge?.survivorId).toBe('ta-2');
  });

  it('offers no merge of analyses of different forms', () => {
    expect(summarizeSelection(selectable(), scope, ['ta-1', 'ta-3']).merge).toBeUndefined();
  });

  it('offers no merge of a single analysis', () => {
    expect(summarizeSelection(selectable(), scope, ['ta-1']).merge).toBeUndefined();
  });
});

describe('restoreUntagged', () => {
  it('brings back the untagged choice that a trip through JSON turns to null', () => {
    const sent = {
      books: ['GEN'],
      pos: [undefined, 'noun'],
      confidence: [undefined],
      features: { case: [undefined, 'nom'] },
      stale: true,
    };

    expect(restoreUntagged(JSON.parse(JSON.stringify(sent)))).toStrictEqual(sent);
  });

  it('leaves absent choices absent', () => {
    expect(restoreUntagged({ stale: true })).toStrictEqual({ stale: true });
  });
});
