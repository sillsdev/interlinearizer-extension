import type { OutlineSegment, PageFailure } from '../types/segment-pages';

/** Consecutive outline indexes `[start, end)` whose segments failed to load in the same way. */
export type FailedRun = Readonly<{ start: number; end: number; failure: PageFailure }>;

/** Whether two failures read alike: the same cause, at the same stage of retrying. */
function isSameFailure(a: PageFailure | undefined, b: PageFailure): boolean {
  return (
    a !== undefined &&
    a.cause === b.cause &&
    a.isRetrying === b.isRetrying &&
    a.failedAgain === b.failedAgain
  );
}

/**
 * The runs of failed segments that reach into outline indexes `[start, end)` of a book of `count`
 * segments, each at its full length in the book rather than cut at the edges of the range. Each run
 * holds segments that failed alike, and ends where the next segment failed in another way.
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
 * Gathers `runs` into groups that failed alike, ordered by each group's first run. Each group keeps
 * its runs in order.
 */
export function groupRunsByFailure(runs: readonly FailedRun[]): FailedRun[][] {
  const groups: FailedRun[][] = [];
  runs.forEach((run) => {
    const group = groups.find((candidate) => isSameFailure(candidate[0].failure, run.failure));
    if (group) group.push(run);
    else groups.push([run]);
  });
  return groups;
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
