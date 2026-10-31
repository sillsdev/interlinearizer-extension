import papi, { logger } from '@papi/frontend';
import { useEvent } from 'platform-bible-react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import type { NetworkEvents } from 'papi-shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageClient } from '../cache/pageClient';
import type { BookOutline } from '../types/segment-pages';
import useLatestRef from './useLatestRef';
import type { SegmentPages, UseSegmentPagesResult } from './useSegmentPages';
import { EXTEND_CHUNK, INITIAL_WINDOW_HALF, findAnchorIndex } from './useSegmentWindow';

/** Arguments for {@link useSessionPages}. */
export interface UseSessionPagesArgs {
  /** The session whose draft sets the book's segment boundaries; nothing is fetched without one. */
  sessionId: string | undefined;
  /** The book to serve; nothing is fetched without one. */
  bookId: string | undefined;
  /**
   * The verse that the view opens on; the pages around it load before the outline is first
   * published.
   */
  scrRef: SerializedVerseRef;
}

/** Return value of {@link useSessionPages}. */
export type UseSessionPagesResult = UseSegmentPagesResult & {
  /**
   * Holds the book's pages and their analysis, and sends the session's edits; `undefined` until the
   * book's first pages load.
   */
  client: PageClient | undefined;
};

/** The segment list that `client` serves for `outline`, the `version`th outline published from it. */
function segmentPagesOf(client: PageClient, outline: BookOutline, version: number): SegmentPages {
  return {
    bookRef: outline.bookRef,
    outline: outline.segments,
    segmentationVersion: version,
    segmentAt: (index) => client.segmentAt(index),
    load: (start, end, caller) => client.load(start, end, caller),
    release: (caller) => client.release(caller),
    subscribe: (onChange) => client.subscribe(onChange),
    loadedVersion: () => client.loadedVersion(),
  };
}

/** Parses a page query's reply, `undefined` meaning the source has no text for the book. */
function parsed(json: string | undefined) {
  return json === undefined ? undefined : JSON.parse(json);
}

/**
 * Serves the loaded book's segment list from a session: its outline, segmented by the session's
 * draft, and the pages asked for, with their analysis. A new outline is published once the pages
 * around the ranges asked for have loaded. The first outline fails, as a failed outline read does,
 * when any of those pages fails every retry. Takes in each change the session reports.
 */
export default function useSessionPages({
  sessionId,
  bookId,
  scrRef,
}: Readonly<UseSessionPagesArgs>): UseSessionPagesResult {
  const [published, setPublished] = useState<{
    key: string;
    client: PageClient;
    pages: SegmentPages;
  }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const scrRefRef = useLatestRef(scrRef);
  const key = sessionId && bookId ? `${sessionId}:${bookId}` : undefined;

  useEffect(() => {
    if (!sessionId || !bookId || !key) return undefined;
    setFailure((was) => (was?.key === key ? undefined : was));
    let isCurrent = true;
    const address = { sessionId };
    const client = new PageClient({
      getOutline: async () =>
        parsed(await papi.commands.sendCommand('interlinearizer.getBookOutline', address, bookId)),
      getSegments: async (start, end) =>
        parsed(
          await papi.commands.sendCommand(
            'interlinearizer.getSegments',
            address,
            bookId,
            start,
            end,
          ),
        ),
    });
    let shown: BookOutline | undefined;
    let version = 0;
    let ready = false;
    const publish = () => {
      const { outline } = client;
      if (!isCurrent || !outline || outline === shown) return;
      shown = outline;
      version += 1;
      setPublished({ key, client, pages: segmentPagesOf(client, outline, version) });
    };
    const unsubscribe = client.subscribe(async () => {
      if (!ready || client.outline === shown) return;
      await client.settled();
      publish();
    });
    (async () => {
      try {
        await client.open();
        const { outline } = client;
        /* v8 ignore next -- open resolves only once an outline has loaded */
        if (!outline) return;
        const anchor = findAnchorIndex(outline.segments, scrRefRef.current);
        const reach = INITIAL_WINDOW_HALF + EXTEND_CHUNK;
        client.load(anchor - reach, anchor + reach + 1, 'list');
        await client.settled();
        if (!isCurrent) return;
        if (client.failedPages.size > 0) {
          const message = `Interlinearizer: could not load the segments of ${bookId}`;
          logger.warn(message);
          setFailure({ key, message });
          return;
        }
        ready = true;
        publish();
      } catch (e) {
        /* v8 ignore next -- a view that closed before its outline read failed has nowhere to show the failure */
        if (!isCurrent) return;
        logger.warn(`Interlinearizer: could not load the outline of ${bookId}: ${e}`);
        setFailure({ key, message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [sessionId, bookId, key, scrRefRef]);

  const client = published?.key === key ? published?.client : undefined;
  const analysisChangedEvent = useMemo(
    () => papi.network.getNetworkEvent('interlinearizer.onAnalysisChanged'),
    [],
  );
  useEvent(
    analysisChangedEvent,
    useCallback(
      (change: NetworkEvents['interlinearizer.onAnalysisChanged']) => {
        if ('sessionId' in change && change.sessionId === sessionId) client?.hear(change);
      },
      [client, sessionId],
    ),
  );

  const isFailed = !!key && failure?.key === key;
  return {
    pages: client && published?.pages,
    isLoading: !client && !isFailed,
    error: isFailed ? failure.message : undefined,
    client,
  };
}
