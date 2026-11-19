import type { OutlineSegment, PageFailure } from '../types/segment-pages';

/** Consecutive outline indexes `[start, end)` whose segments failed to load. */
export type FailedRun = Readonly<{ start: number; end: number }>;

/**
 * The runs of failed segments that reach into outline indexes `[start, end)` of a book of `count`
 * segments, each at its full length in the book rather than cut at the edges of the range.
 */
export function failedRunsIn(
  failureAt: (index: number) => PageFailure | undefined,
  count: number,
  start: number,
  end: number,
): FailedRun[] {
  const isFailed = (index: number) => failureAt(index) !== undefined;
  const runs: FailedRun[] = [];
  let index = start;
  while (index < end) {
    if (isFailed(index)) {
      let runStart = index;
      while (runStart > 0 && isFailed(runStart - 1)) runStart -= 1;
      let runEnd = index + 1;
      while (runEnd < count && isFailed(runEnd)) runEnd += 1;
      runs.push({ start: runStart, end: runEnd });
      index = runEnd;
    } else index += 1;
  }
  return runs;
}

/**
 * The verses that `run` covers, as a reference without the book: `13:18`, `13:18–25`, or
 * `13:18–14:3`.
 */
export function runVerses(outline: readonly OutlineSegment[], run: FailedRun): string {
  const first = outline[run.start].startRef;
  const lastSegment = outline[run.end - 1];
  const lastStart = lastSegment.verseStarts[lastSegment.verseStarts.length - 1];
  const lastChapter = lastStart?.chapter ?? lastSegment.startRef.chapter;
  const lastVerse = lastStart?.number ?? String(lastSegment.startRef.verse);
  const from = `${first.chapter}:${first.verse}`;
  if (lastChapter !== first.chapter) return `${from}–${lastChapter}:${lastVerse}`;
  if (lastVerse !== String(first.verse)) return `${from}–${lastVerse}`;
  return from;
}
