/// <reference types="jest" />

import papi from '@papi/frontend';
import { useEvent } from 'platform-bible-react';
import { act, renderHook, waitFor } from '@testing-library/react';
import useSessionPages from '../../hooks/useSessionPages';
import { resegmentBook } from '../../parsers/papi/resegmentBook';
import { BOOK, glossing, ref, sessionOver } from '../cache/session-source';

/** Stands in for the network event that the session reports changes on. */
const ANALYSIS_CHANGED_EVENT = () => () => true;

const SCR_REF = { book: 'GEN', chapterNum: 1, verseNum: 1 };

/**
 * Routes the session forms of the page queries to `made`'s session, segmenting the book by the
 * draft's boundaries as the host does, and fails any other command.
 */
function serve(made: Awaited<ReturnType<typeof sessionOver>>) {
  const segmented = async () => {
    const { segmentation } = await made.sessions.run(made.sessionId, (session) =>
      session.repository.getScope(),
    );
    return segmentation ? resegmentBook(BOOK, segmentation) : BOOK;
  };
  jest.mocked(papi.commands.sendCommand).mockImplementation(async (...call: unknown[]) => {
    const [command, address, bookId, start, end] = call;
    if (typeof address !== 'object' || bookId !== BOOK.bookRef) throw new Error('bad address');
    if (command === 'interlinearizer.getBookOutline')
      return JSON.stringify(await made.fetchOutline(await segmented()));
    if (command === 'interlinearizer.getSegments' && typeof start === 'number')
      return JSON.stringify(await made.fetchPage(start, Number(end), await segmented()));
    throw new Error(`unexpected ${String(command)}`);
  });
}

/** Relays `change` to the hook, as the platform does. */
function relay(change: unknown): void {
  const handler = [...jest.mocked(useEvent).mock.calls]
    .reverse()
    .find(([event]) => event === ANALYSIS_CHANGED_EVENT)?.[1];
  if (typeof handler !== 'function') throw new Error('nothing listens for the change event');
  act(() => handler(change));
}

beforeEach(() => {
  jest.mocked(papi.network.getNetworkEvent).mockReturnValue(ANALYSIS_CHANGED_EVENT);
});

describe('useSessionPages', () => {
  it("publishes the session's outline of the book with the pages around the verse loaded", async () => {
    const made = await sessionOver();
    serve(made);

    const { result } = renderHook(() =>
      useSessionPages({ sessionId: made.sessionId, bookId: 'GEN', scrRef: SCR_REF }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pages?.outline).toStrictEqual(made.outline?.segments);
    expect(result.current.pages?.segmentAt(0)?.id).toBe(BOOK.segments[0].id);
    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.getBookOutline',
      { sessionId: made.sessionId },
      'GEN',
    );
  });

  it('loads no pages without a session', () => {
    const { result } = renderHook(() =>
      useSessionPages({ sessionId: undefined, bookId: 'GEN', scrRef: SCR_REF }),
    );

    expect(result.current).toMatchObject({ pages: undefined, isLoading: true, error: undefined });
    expect(papi.commands.sendCommand).not.toHaveBeenCalled();
  });

  it('takes in a change the session reports, fetching again what it leaves out of date', async () => {
    const made = await sessionOver();
    serve(made);
    const { result } = renderHook(() =>
      useSessionPages({ sessionId: made.sessionId, bookId: 'GEN', scrRef: SCR_REF }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    made.onChange(relay);

    await act(async () => {
      await made.edit('writeGloss', glossing('earth', 'land'));
      await result.current.client?.settled();
    });

    expect(result.current.client?.heldAnalysis().tokenAnalyses.map(({ id }) => id)).toContain(
      'ta-land',
    );
  });

  it("ignores a change another session reports, and the source project's form", async () => {
    const made = await sessionOver();
    serve(made);
    const { result } = renderHook(() =>
      useSessionPages({ sessionId: made.sessionId, bookId: 'GEN', scrRef: SCR_REF }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const { client } = result.current;
    if (!client) throw new Error('no client');
    const hear = jest.spyOn(client, 'hear');

    relay({
      sessionId: 'other',
      changeId: 'c',
      books: [],
      analysisIds: [],
      forms: [],
      queries: [],
    });
    relay({ sourceProjectId: 'src', changeId: 'c', scriptureEdit: { bookId: 'GEN' } });

    expect(hear).not.toHaveBeenCalled();
  });

  it('publishes a new segment list once a boundary edit moves the outline', async () => {
    const made = await sessionOver();
    serve(made);
    const { result } = renderHook(() =>
      useSessionPages({ sessionId: made.sessionId, bookId: 'GEN', scrRef: SCR_REF }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const before = result.current.pages;

    await act(async () => {
      await result.current.client?.send((changeId) =>
        made.edit(
          'mergeSegments',
          async (buffer) => {
            buffer.putScope({
              ...(await buffer.getScope()),
              segmentation: { removedVerseStarts: [ref('And')], addedStarts: [] },
            });
          },
          changeId,
        ),
      );
      await result.current.client?.settled();
    });

    await waitFor(() => expect(result.current.pages).not.toBe(before));
    expect(result.current.pages?.outline).toHaveLength(2);
    expect(result.current.pages?.segmentationVersion).toBeGreaterThan(
      before?.segmentationVersion ?? Infinity,
    );
  });

  it('serves the segments of a range a view asks for', async () => {
    const made = await sessionOver();
    serve(made);
    const { result } = renderHook(() =>
      useSessionPages({ sessionId: made.sessionId, bookId: 'GEN', scrRef: SCR_REF }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const { pages } = result.current;
    pages?.subscribe(() => {})();
    pages?.release('list');

    await act(async () => {
      pages?.load(0, 3, 'strip');
      await result.current.client?.settled();
    });

    expect(pages?.segmentAt(2)?.id).toBe(BOOK.segments[2].id);
    expect(pages?.loadedVersion()).toBe(result.current.client?.loadedVersion());
  });

  it('reports an outline that fails with something other than an error', async () => {
    jest.mocked(papi.commands.sendCommand).mockRejectedValue('offline');

    const { result } = renderHook(() =>
      useSessionPages({ sessionId: 's-1', bookId: 'GEN', scrRef: SCR_REF }),
    );

    await waitFor(() => expect(result.current.error).toBe('offline'));
  });

  it('reports a book the source has no text for', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useSessionPages({ sessionId: 's-1', bookId: 'GEN', scrRef: SCR_REF }),
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
  });

  it('reports an outline it cannot read', async () => {
    jest.mocked(papi.commands.sendCommand).mockRejectedValue(new Error('no book'));

    const { result } = renderHook(() =>
      useSessionPages({ sessionId: 's-1', bookId: 'GEN', scrRef: SCR_REF }),
    );

    await waitFor(() => expect(result.current.error).toBe('no book'));
    expect(result.current.isLoading).toBe(false);
  });
});
