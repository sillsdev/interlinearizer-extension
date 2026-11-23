/// <reference types="jest" />

import type { SegmentationDelta, TextAnalysis } from 'interlinearizer';
import { sessionPageHandlers } from '../../services/sessionPageHandlers';
import { sessionOver } from '../cache/session-source';
import { FIXTURE_STAMPS, makeTokenLink, makeVerseBook } from '../test-helpers';

const VERSE_BOOK = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning God' },
  { sid: 'GEN 1:2', text: 'And the earth' },
]);

const SEGMENTATION: SegmentationDelta = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };

/** A free translation left on a verse that the book no longer holds. */
const ORPHANED: Partial<TextAnalysis> = {
  segmentAnalyses: [{ id: 'sa-9', ...FIXTURE_STAMPS, surfaceText: 'lost' }],
  segmentAnalysisLinks: [
    { id: 'sl-9', analysisId: 'sa-9', ...FIXTURE_STAMPS, status: 'stale', segmentId: 'GEN 1:9' },
  ],
};

/**
 * The page handlers over a session of a draft holding `analysis` under `segmentation`, on a source
 * whose text is {@link VERSE_BOOK}.
 */
async function handlersOver({
  analysis = {},
  segmentation,
}: {
  analysis?: Partial<TextAnalysis>;
  segmentation?: SegmentationDelta;
} = {}) {
  const { sessions, sessionId } = await sessionOver(analysis, segmentation, VERSE_BOOK);
  const host = {
    sessions,
    logger: { error: jest.fn(), warn: jest.fn() },
    getOpenBook: jest.fn(async (): Promise<typeof VERSE_BOOK | undefined> => VERSE_BOOK),
    getOpenVerseBook: jest.fn(async (): Promise<typeof VERSE_BOOK | undefined> => VERSE_BOOK),
    getSegmentedBook: jest.fn(async (): Promise<typeof VERSE_BOOK | undefined> => VERSE_BOOK),
  };
  return { handlers: sessionPageHandlers(host), host, sessions, sessionId };
}

describe('getDraftEnvelope', () => {
  it("replies with the session's draft envelope, without its analysis or boundaries", async () => {
    const { handlers, sessionId } = await handlersOver({ segmentation: SEGMENTATION });

    const envelope = JSON.parse(await handlers['interlinearizer.getDraftEnvelope']({ sessionId }));

    expect(envelope).toMatchObject({ sourceProjectId: 'src', analysisLanguages: ['en'] });
    expect(envelope).not.toHaveProperty('analysis');
    expect(envelope).not.toHaveProperty('segmentation');
  });

  it('logs and rethrows an envelope asked of a session not open', async () => {
    const { handlers, host } = await handlersOver();

    await expect(
      handlers['interlinearizer.getDraftEnvelope']({ sessionId: 'gone' }),
    ).rejects.toThrow('no session gone is open');
    expect(host.logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to read the draft envelope of session gone',
      expect.any(Error),
    );
  });
});

describe('getBookOutline', () => {
  it("outlines a book under the draft's boundaries, counting its orphaned cards", async () => {
    const { handlers, host, sessionId } = await handlersOver({
      analysis: ORPHANED,
      segmentation: SEGMENTATION,
    });

    const json = await handlers['interlinearizer.getBookOutline']({ sessionId }, 'GEN');

    expect(host.getOpenBook).toHaveBeenCalledWith('src', 'GEN', SEGMENTATION);
    expect(
      JSON.parse(json ?? '').segments.map(
        ({ orphanedCardCount }: { orphanedCardCount?: number }) => orphanedCardCount,
      ),
    ).toStrictEqual([undefined, 1]);
  });

  it('names no boundaries for a book the draft sets none in', async () => {
    const { handlers, host, sessionId } = await handlersOver();

    await handlers['interlinearizer.getBookOutline']({ sessionId }, 'GEN');

    expect(host.getOpenBook).toHaveBeenCalledWith('src', 'GEN', undefined);
  });

  it("re-anchors the draft to a book's text before the book's first outline", async () => {
    const { handlers, sessions, sessionId } = await handlersOver({
      analysis: {
        tokenAnalyses: [{ id: 'ta', ...FIXTURE_STAMPS, surfaceText: 'Out' }],
        tokenAnalysisLinks: [makeTokenLink('ta', 'GEN 1:1:0', { id: 'tl', surfaceText: 'Out' })],
      },
    });

    await handlers['interlinearizer.getBookOutline']({ sessionId }, 'GEN');

    const { draft } = await sessions.run(sessionId, (session) => session.repository.exportAll());
    expect(draft.analysis.tokenAnalysisLinks[0].status).toBe('stale');
  });

  it('logs a failed re-anchor and still outlines the book', async () => {
    const { handlers, host, sessions, sessionId } = await handlersOver();
    jest.spyOn(sessions, 'reanchorOpenedBook').mockRejectedValue(new Error('unreadable'));

    await expect(handlers['interlinearizer.getBookOutline']({ sessionId }, 'GEN')).resolves.toEqual(
      expect.any(String),
    );
    expect(host.logger.warn).toHaveBeenCalledWith(
      `Interlinearizer: could not re-anchor GEN of session ${sessionId}`,
      expect.any(Error),
    );
  });

  it('resolves undefined for a book the source has no text for', async () => {
    const { handlers, host, sessionId } = await handlersOver();
    host.getOpenBook.mockResolvedValue(undefined);
    host.getOpenVerseBook.mockResolvedValue(undefined);

    await expect(
      handlers['interlinearizer.getBookOutline']({ sessionId }, 'GEN'),
    ).resolves.toBeUndefined();
  });

  it('logs and rethrows an outline asked of a session not open', async () => {
    const { handlers, host } = await handlersOver();

    await expect(
      handlers['interlinearizer.getBookOutline']({ sessionId: 'gone' }, 'GEN'),
    ).rejects.toThrow('no session gone is open');
    expect(host.logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to outline book GEN of session gone',
      expect.any(Error),
    );
  });
});

describe('getStaleSummary', () => {
  it("summarizes a book's stale analyses under the draft's boundaries", async () => {
    const { handlers, host, sessionId } = await handlersOver({
      analysis: {
        ...ORPHANED,
        tokenAnalyses: [{ id: 'ta-in', ...FIXTURE_STAMPS, surfaceText: 'In', gloss: { en: 'at' } }],
        tokenAnalysisLinks: [
          makeTokenLink('ta-in', 'GEN 1:1:0', { id: 'tl', surfaceText: 'In', status: 'stale' }),
        ],
      },
      segmentation: SEGMENTATION,
    });

    const json = await handlers['interlinearizer.getStaleSummary']({ sessionId, bookId: 'GEN' });

    expect(host.getOpenBook).toHaveBeenCalledWith('src', 'GEN', SEGMENTATION);
    expect(JSON.parse(json ?? '')).toStrictEqual({
      glosses: [{ analysisId: 'ta-in', tokenRef: 'GEN 1:1:0' }],
      phrases: [],
      freeTranslations: [{ analysisId: 'sa-9', segmentId: 'GEN 1:2' }],
    });
  });

  it('summarizes nothing for a book the source has no text for', async () => {
    const { handlers, host, sessionId } = await handlersOver();
    host.getOpenBook.mockResolvedValue(undefined);

    await expect(
      handlers['interlinearizer.getStaleSummary']({ sessionId, bookId: 'GEN' }),
    ).resolves.toBeUndefined();
  });

  it('logs and rethrows a stale summary asked of a session not open', async () => {
    const { handlers, host } = await handlersOver();

    await expect(
      handlers['interlinearizer.getStaleSummary']({ sessionId: 'gone', bookId: 'GEN' }),
    ).rejects.toThrow('no session gone is open');
    expect(host.logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to summarize the stale analyses of book GEN of session gone',
      expect.any(Error),
    );
  });
});

describe('getSegments', () => {
  it("serves a run of a book's segments under the draft's boundaries, with its analysis", async () => {
    const { handlers, host, sessionId } = await handlersOver({
      analysis: ORPHANED,
      segmentation: SEGMENTATION,
    });

    const page = JSON.parse(
      (await handlers['interlinearizer.getSegments']({ sessionId }, 'GEN', 1, 2)) ?? '',
    );

    expect(host.getSegmentedBook).toHaveBeenCalledWith('src', 'GEN', SEGMENTATION);
    expect(page).toMatchObject({
      start: 1,
      segments: [VERSE_BOOK.segments[1]],
      analysis: { staleFreeTranslations: { orphanedAfter: { 'GEN 1:2': ['sl-9'] } } },
    });
  });

  it('resolves undefined for a book the source has no text for', async () => {
    const { handlers, host, sessionId } = await handlersOver();
    host.getSegmentedBook.mockResolvedValue(undefined);

    await expect(
      handlers['interlinearizer.getSegments']({ sessionId }, 'GEN', 0, 1),
    ).resolves.toBeUndefined();
  });

  it('logs and rethrows a page asked of a session not open', async () => {
    const { handlers, host } = await handlersOver();

    await expect(
      handlers['interlinearizer.getSegments']({ sessionId: 'gone' }, 'GEN', 0, 1),
    ).rejects.toThrow('no session gone is open');
    expect(host.logger.error).toHaveBeenCalledWith(
      'Interlinearizer: failed to serve segments 0-1 of book GEN of session gone',
      expect.any(Error),
    );
  });
});
