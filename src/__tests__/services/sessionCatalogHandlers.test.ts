/// <reference types="jest" />

import type { TextAnalysis } from 'interlinearizer';
import {
  sessionCatalogHandlers,
  type CatalogRowsRequest,
} from '../../services/sessionCatalogHandlers';
import { FIXTURE_STAMPS, makeTokenLink, makeVerseBook, tokenRefOf } from '../test-helpers';
import { BOOK, GLOSSED, glossing, ref, sessionOver } from '../cache/session-source';

/** A request for the first page of every row, sorted by surface form, against Genesis. */
function makeRequest(overrides: Partial<CatalogRowsRequest> = {}): CatalogRowsRequest {
  return {
    currentBook: 'GEN',
    search: '',
    sort: 'surfaceText',
    filters: {},
    sourceLanguageTag: 'en',
    offset: 0,
    count: 50,
    ...overrides,
  };
}

/**
 * The catalog handlers over a session of a draft holding `analysis`, {@link GLOSSED} by default, on
 * a source whose text holds every form unless `isFormInText` says otherwise.
 */
async function handlersOver({
  analysis = GLOSSED,
  isFormInText = () => true,
}: {
  analysis?: Partial<TextAnalysis>;
  isFormInText?: (sourceProjectId: string, form: string) => boolean | undefined;
} = {}) {
  const { sessions, sessionId, edit } = await sessionOver(analysis);
  const handlers = sessionCatalogHandlers({
    sessions,
    logger: { error: jest.fn() },
    getOpenVerseBook: async () => BOOK,
    getVerseBook: async () => BOOK,
    isFormInText,
  });
  return { handlers, sessionId, edit };
}

describe('getCatalogRows', () => {
  it("serves a page of the session's catalog as JSON, each row's books as a list", async () => {
    const { handlers, sessionId } = await handlersOver();

    const json = await handlers['interlinearizer.getCatalogRows']({
      sessionId,
      request: makeRequest(),
    });

    expect(JSON.parse(json).rows).toEqual([
      expect.objectContaining({
        analysisId: 'ta-god',
        gloss: 'God',
        usageCount: 1,
        books: ['GEN'],
      }),
    ]);
  });

  it("keeps a row whose form the session's source text lacks under the not-in-text filter", async () => {
    const { handlers, sessionId } = await handlersOver({
      isFormInText: (source, form) => (source === 'src' ? form !== 'god' : true),
    });

    const json = await handlers['interlinearizer.getCatalogRows']({
      sessionId,
      request: makeRequest({ filters: { notInText: true } }),
    });

    expect(JSON.parse(json).keptIds).toEqual(['ta-god']);
  });

  it('keeps no row under the not-in-text filter while the text is still being read', async () => {
    const { handlers, sessionId } = await handlersOver({ isFormInText: () => undefined });

    const json = await handlers['interlinearizer.getCatalogRows']({
      sessionId,
      request: makeRequest({ filters: { notInText: true } }),
    });

    expect(JSON.parse(json).keptIds).toEqual([]);
  });

  it('serves the catalog when the source has no text for the current book', async () => {
    const { sessions, sessionId } = await sessionOver();
    const handlers = sessionCatalogHandlers({
      sessions,
      logger: { error: jest.fn() },
      getOpenVerseBook: async () => undefined,
      getVerseBook: async () => undefined,
      isFormInText: () => true,
    });

    const json = await handlers['interlinearizer.getCatalogRows']({
      sessionId,
      request: makeRequest({ currentBook: 'EXO' }),
    });

    expect(JSON.parse(json).keptIds).toEqual(['ta-god']);
  });

  it('serves the catalog, logging the failure, when the current book cannot be read', async () => {
    const { sessions, sessionId } = await sessionOver();
    const logger = { error: jest.fn() };
    const handlers = sessionCatalogHandlers({
      sessions,
      logger,
      getOpenVerseBook: async () => {
        throw new Error('unreadable');
      },
      getVerseBook: async () => undefined,
      isFormInText: () => true,
    });

    const json = await handlers['interlinearizer.getCatalogRows']({
      sessionId,
      request: makeRequest(),
    });

    expect(JSON.parse(json).keptIds).toEqual(['ta-god']);
    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: could not read GEN to place its headings',
      expect.any(Error),
    );
  });

  it('serves what an edit in the session left', async () => {
    const { handlers, sessionId, edit } = await handlersOver();
    await edit('gloss', glossing('beginning', 'start'));

    const json = await handlers['interlinearizer.getCatalogRows']({
      sessionId,
      request: makeRequest(),
    });

    expect(JSON.parse(json).keptIds).toEqual(['ta-start', 'ta-god']);
  });
});

describe('countUsages', () => {
  it('counts the distinct tokens in the session that approve any of the analyses', async () => {
    const { handlers, sessionId, edit } = await handlersOver();
    await edit('gloss', glossing('beginning', 'start'));

    await expect(
      handlers['interlinearizer.countUsages']({ sessionId, analysisIds: ['ta-god', 'ta-start'] }),
    ).resolves.toBe(2);
  });
});

describe('getCatalogRowsByIds', () => {
  it("serves the rows of the named analyses in the session's draft, each row's books as a list", async () => {
    const { handlers, sessionId } = await handlersOver();

    const json = await handlers['interlinearizer.getCatalogRowsByIds']({
      sessionId,
      currentBook: 'GEN',
      analysisIds: ['ta-gone', 'ta-god'],
    });

    expect(JSON.parse(json)).toEqual([
      expect.objectContaining({ analysisId: 'ta-god', books: ['GEN'] }),
    ]);
  });
});

describe('getHomographRows', () => {
  it("serves the rows sharing the analysis's form in the session's draft", async () => {
    const { handlers, sessionId } = await handlersOver({
      analysis: {
        ...GLOSSED,
        tokenAnalyses: [
          ...(GLOSSED.tokenAnalyses ?? []),
          { id: 'ta-deity', ...FIXTURE_STAMPS, surfaceText: 'god', gloss: { en: 'deity' } },
        ],
      },
    });

    const json = await handlers['interlinearizer.getHomographRows']({
      sessionId,
      currentBook: 'GEN',
      analysisId: 'ta-god',
    });

    expect(JSON.parse(json).map((row: { analysisId: string }) => row.analysisId)).toEqual([
      'ta-god',
      'ta-deity',
    ]);
  });
});

describe('getSelectionSummary', () => {
  it("summarizes the selected analyses of the session's draft", async () => {
    const { handlers, sessionId } = await handlersOver();

    const json = await handlers['interlinearizer.getSelectionSummary']({
      sessionId,
      analysisIds: ['ta-god'],
    });

    expect(JSON.parse(json)).toEqual({ usageCount: 1, glossedIds: ['ta-god'] });
  });
});

describe('previewDeletion', () => {
  const EXODUS = makeVerseBook([{ sid: 'EXO 1:1', text: 'God spoke' }]);

  it('names the fallback of a token in a book other than the open one', async () => {
    const { sessions, sessionId } = await sessionOver({
      tokenAnalyses: [
        { id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'God' } },
        { id: 'ta-deity', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'Deity' } },
      ],
      tokenAnalysisLinks: [
        makeTokenLink('ta-god', tokenRefOf(EXODUS, 'God'), { surfaceText: 'God' }),
        makeTokenLink('ta-deity', ref('God'), { surfaceText: 'God' }),
      ],
    });
    const handlers = sessionCatalogHandlers({
      sessions,
      logger: { error: jest.fn() },
      getOpenVerseBook: async () => BOOK,
      getVerseBook: async (_source, bookId) => (bookId === 'EXO' ? EXODUS : BOOK),
      isFormInText: () => true,
    });

    const json = await handlers['interlinearizer.previewDeletion']({
      sessionId,
      analysisId: 'ta-god',
    });

    expect(JSON.parse(json)).toEqual({
      kind: 'fallback',
      usageCount: 1,
      fallbackGloss: 'Deity',
      unappliedCount: 0,
    });
  });

  it('leaves the fallback uncertain, logging the failure, when its book cannot be read', async () => {
    const { sessions, sessionId } = await sessionOver({
      tokenAnalyses: [
        { id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'God' } },
        { id: 'ta-deity', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'Deity' } },
      ],
      tokenAnalysisLinks: [
        makeTokenLink('ta-god', tokenRefOf(EXODUS, 'God'), { surfaceText: 'God' }),
        makeTokenLink('ta-deity', ref('God'), { surfaceText: 'God' }),
      ],
    });
    const logger = { error: jest.fn() };
    const handlers = sessionCatalogHandlers({
      sessions,
      logger,
      getOpenVerseBook: async () => BOOK,
      getVerseBook: async (_source, bookId) => {
        if (bookId === 'EXO') throw new Error('unreadable');
        return BOOK;
      },
      isFormInText: () => true,
    });

    const json = await handlers['interlinearizer.previewDeletion']({
      sessionId,
      analysisId: 'ta-god',
    });

    expect(JSON.parse(json)).toEqual(
      expect.objectContaining({ kind: 'fallback', uncertain: true }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Interlinearizer: could not read EXO to preview a deletion',
      expect.any(Error),
    );
  });

  it('answers null for an id no analysis carries', async () => {
    const { handlers, sessionId } = await handlersOver();

    await expect(
      handlers['interlinearizer.previewDeletion']({ sessionId, analysisId: 'ta-gone' }),
    ).resolves.toBe('null');
  });
});

describe('a session not open', () => {
  it('logs and rethrows each query asked of it', async () => {
    const { sessions } = await sessionOver();
    const logger = { error: jest.fn() };
    const handlers = sessionCatalogHandlers({
      sessions,
      logger,
      getOpenVerseBook: async () => BOOK,
      getVerseBook: async () => BOOK,
      isFormInText: () => true,
    });
    const sessionId = 'no-such-session';

    await expect(
      handlers['interlinearizer.getCatalogRows']({ sessionId, request: makeRequest() }),
    ).rejects.toThrow();
    await expect(
      handlers['interlinearizer.countUsages']({ sessionId, analysisIds: [] }),
    ).rejects.toThrow();
    await expect(
      handlers['interlinearizer.getCatalogRowsByIds']({
        sessionId,
        currentBook: 'GEN',
        analysisIds: [],
      }),
    ).rejects.toThrow();
    await expect(
      handlers['interlinearizer.getHomographRows']({
        sessionId,
        currentBook: 'GEN',
        analysisId: 'ta-god',
      }),
    ).rejects.toThrow();

    await expect(
      handlers['interlinearizer.getSelectionSummary']({ sessionId, analysisIds: [] }),
    ).rejects.toThrow();
    await expect(
      handlers['interlinearizer.previewDeletion']({ sessionId, analysisId: 'ta-god' }),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledTimes(6);
  });
});
