/// <reference types="jest" />

import { renderHook } from '@testing-library/react';
import useConcordanceEntries, {
  type UseConcordanceEntriesArgs,
} from '../../hooks/useConcordanceEntries';
import { buildConcordanceEntries, type BookConcordance } from '../../utils/concordance';

// The entries' own contents are the concordance core's concern; this stand-in names each entry by
// the book and text version it was built from, so a test can read off which reading went in.
jest.mock('../../utils/concordance');

/** A stand-in index of one book, which the stand-in entries read only the code and version of. */
function index(book: string, textVersion: string): BookConcordance {
  return { book, textVersion, occurrencesByForm: new Map(), spellingCountsByForm: new Map() };
}

/** Indexes keyed by book, as the source text holds them. */
function byBook(...indexes: BookConcordance[]): ReadonlyMap<string, BookConcordance> {
  return new Map(indexes.map((i) => [i.book, i]));
}

const READINGS = byBook(index('GEN', 'v1'), index('EXO', 'v1'));

const baseArgs: UseConcordanceEntriesArgs = {
  text: { status: 'ready', readings: READINGS, liveVersions: new Map() },
  shown: true,
  writingSystem: 'en',
};

beforeEach(() => {
  jest.mocked(buildConcordanceEntries).mockImplementation((books) =>
    [...books].map((b) => ({
      form: `${b.book}@${b.textVersion}`,
      displayText: b.book,
      occurrences: [],
      countByBook: new Map(),
    })),
  );
});

/** The book and version each entry was built from. */
function builtFrom(entries: readonly { form: string }[]): string[] {
  return entries.map((e) => e.form).sort();
}

describe('useConcordanceEntries', () => {
  it('builds nothing until every book has been read', () => {
    const { result } = renderHook(() =>
      useConcordanceEntries({
        ...baseArgs,
        text: { status: 'loading', readings: undefined, liveVersions: new Map() },
      }),
    );

    expect(result.current).toEqual([]);
  });

  it('builds an entry from every reading', () => {
    const { result } = renderHook(() => useConcordanceEntries(baseArgs));

    expect(builtFrom(result.current)).toEqual(['EXO@v1', 'GEN@v1']);
  });

  it('takes a live version in place of its reading', () => {
    const { result } = renderHook(() =>
      useConcordanceEntries({
        ...baseArgs,
        text: { ...baseArgs.text, liveVersions: byBook(index('GEN', 'v2')) },
      }),
    );

    expect(builtFrom(result.current)).toEqual(['EXO@v1', 'GEN@v2']);
  });

  it('holds back live versions while the concordance is hidden', () => {
    const { result, rerender } = renderHook(
      (args: UseConcordanceEntriesArgs) => useConcordanceEntries(args),
      { initialProps: { ...baseArgs, shown: false } },
    );
    const builds = jest.mocked(buildConcordanceEntries).mock.calls.length;

    rerender({
      ...baseArgs,
      shown: false,
      text: { ...baseArgs.text, liveVersions: byBook(index('GEN', 'v2')) },
    });

    expect(jest.mocked(buildConcordanceEntries).mock.calls.length).toBe(builds);
    expect(builtFrom(result.current)).toEqual(['EXO@v1', 'GEN@v1']);
  });

  it('takes in live versions held back while hidden once the concordance is shown', () => {
    const liveVersions = byBook(index('GEN', 'v2'));
    const { result, rerender } = renderHook(
      (args: UseConcordanceEntriesArgs) => useConcordanceEntries(args),
      { initialProps: { ...baseArgs, shown: false } },
    );
    rerender({ ...baseArgs, shown: false, text: { ...baseArgs.text, liveVersions } });

    rerender({ ...baseArgs, text: { ...baseArgs.text, liveVersions } });

    expect(builtFrom(result.current)).toEqual(['EXO@v1', 'GEN@v2']);
  });
});
