import type { OutlineSegment, PageFailure } from '../types/segment-pages';

/** Consecutive outline indexes `[start, end)` whose segments failed to load, all retrying or none. */
export type FailedRun = Readonly<{ start: number; end: number; failure: PageFailure }>;

/** Whether `a` failed and is retrying exactly when `b` is. */
function isSameFailure(a: PageFailure | undefined, b: PageFailure): boolean {
  return a?.isRetrying === b.isRetrying;
}

/**
 * The runs of failed segments that reach into outline indexes `[start, end)` of a book of `count`
 * segments, each at its full length in the book rather than cut at the edges of the range. A run
 * ends where the next segment is retrying and its own are not, or the other way round.
 */
export function failedRunsIn(
  failureAt: (index: number) => PageFailure | undefined,
  count: number,
  start: number,
  end: number,
): FailedRun[] {
  const runs: FailedRun[] = [];
  let index = start;
  while (index < end) {
    const failure = failureAt(index);
    if (failure) {
      let runStart = index;
      while (runStart > 0 && isSameFailure(failureAt(runStart - 1), failure)) runStart -= 1;
      let runEnd = index + 1;
      while (runEnd < count && isSameFailure(failureAt(runEnd), failure)) runEnd += 1;
      runs.push({ start: runStart, end: runEnd, failure });
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
  // A bridged marker such as `18-20` ends the run at its last verse.
  const lastVerse = lastStart?.number.split(/[-–]/).at(-1) ?? String(lastSegment.startRef.verse);
  const from = `${first.chapter}:${first.verse}`;
  if (lastChapter !== first.chapter) return `${from}–${lastChapter}:${lastVerse}`;
  if (lastVerse !== String(first.verse)) return `${from}–${lastVerse}`;
  return from;
}
