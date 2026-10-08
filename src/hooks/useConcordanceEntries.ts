import { useMemo, useState } from 'react';
import { buildConcordanceEntries, type ConcordanceEntry } from '../utils/concordance';
import { collatorForTag } from '../utils/language-tags';
import type { SourceText } from './useSourceTextReader';

/** Arguments for {@link useConcordanceEntries}. */
export interface UseConcordanceEntriesArgs {
  /** The source text the entries are built from. */
  text: Pick<SourceText, 'status' | 'readings' | 'liveVersions'>;
  /** Whether the concordance is on screen; the entries take in live-book edits only while it is. */
  shown: boolean;
  /** BCP 47 tag of the source text, which the entries are collated by. */
  writingSystem: string;
}

/**
 * Builds the concordance's entries, one per form across every book, from the source text; empty
 * until every book has been read.
 */
export default function useConcordanceEntries({
  text: { status, readings, liveVersions },
  shown,
  writingSystem,
}: UseConcordanceEntriesArgs): readonly ConcordanceEntry[] {
  const collator = useMemo(() => collatorForTag(writingSystem), [writingSystem]);

  // Held back while hidden: merging every book again is too costly to repeat for edits nobody sees.
  const [mergedLiveVersions, setMergedLiveVersions] = useState(liveVersions);
  if (shown && mergedLiveVersions !== liveVersions) setMergedLiveVersions(liveVersions);

  return useMemo(() => {
    if (status !== 'ready' || !readings) return [];
    const books = new Map(readings);
    mergedLiveVersions.forEach((index, book) => books.set(book, index));
    return buildConcordanceEntries(books.values(), collator);
  }, [status, readings, mergedLiveVersions, collator]);
}
