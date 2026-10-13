/**
 * Storage key that turns timing entries on when set to `'true'`; absent, every function here is a
 * no-op.
 */
export const PERF_MARKS_STORAGE_KEY = 'interlinearizer.perfMarks';

/** Prefix of every entry this extension puts on the performance timeline. */
export const PERF_ENTRY_PREFIX = 'ilz:';

let enabled: boolean | undefined;

/** Whether this window records timing entries, decided once per window. */
export function perfMarksEnabled(): boolean {
  if (enabled === undefined) {
    try {
      enabled = globalThis.localStorage?.getItem(PERF_MARKS_STORAGE_KEY) === 'true';
    } catch {
      // A frame denied storage has no way to turn them on.
      enabled = false;
    }
  }
  return enabled;
}

/** Turns timing entries on or off for this realm, overriding the storage key. */
export function setPerfMarksEnabled(on: boolean): void {
  enabled = on;
}

/** A recorded duration, named without {@link PERF_ENTRY_PREFIX}. */
export interface PerfEntry {
  name: string;
  duration: number;
  detail: unknown;
}

/**
 * Returns every duration this extension has recorded and removes its entries from the timeline,
 * leaving entries other code shares the timeline with.
 */
export function takePerfEntries(): PerfEntry[] {
  const ours = (type: string) =>
    performance.getEntriesByType(type).filter((entry) => entry.name.startsWith(PERF_ENTRY_PREFIX));
  const measures = ours('measure');
  new Set(measures.map((entry) => entry.name)).forEach((name) => performance.clearMeasures(name));
  new Set(ours('mark').map((entry) => entry.name)).forEach((name) => performance.clearMarks(name));
  return measures.map((entry) => ({
    name: entry.name.slice(PERF_ENTRY_PREFIX.length),
    duration: entry.duration,
    detail: 'detail' in entry ? entry.detail : undefined,
  }));
}

/** Records a point on the timeline that a later {@link perfMeasure} can time from. */
export function perfMark(name: string, detail?: unknown): void {
  if (perfMarksEnabled()) performance.mark(PERF_ENTRY_PREFIX + name, { detail });
}

/**
 * Records the time since the latest `startMark` as `name`, carrying that mark's detail. Records
 * nothing when no such mark was made.
 */
export function perfMeasure(name: string, startMark: string): void {
  if (!perfMarksEnabled()) return;
  const start = performance.getEntriesByName(PERF_ENTRY_PREFIX + startMark, 'mark').at(-1);
  if (!start) return;
  performance.measure(PERF_ENTRY_PREFIX + name, {
    start: start.startTime,
    end: performance.now(),
    detail: 'detail' in start ? start.detail : undefined,
  });
}

/** Runs `work`, recording how long it took as `name`. */
export function perfTime<T>(name: string, work: () => T, detail?: unknown): T {
  if (!perfMarksEnabled()) return work();
  const start = performance.now();
  try {
    return work();
  } finally {
    performance.measure(PERF_ENTRY_PREFIX + name, { start, end: performance.now(), detail });
  }
}

/** Runs `work`, recording how long it took to settle as `name`, its synchronous start included. */
export function perfTimeAsync<T>(
  name: string,
  work: () => Promise<T>,
  detail?: unknown,
): Promise<T> {
  if (!perfMarksEnabled()) return work();
  const start = performance.now();
  return work().finally(() =>
    performance.measure(PERF_ENTRY_PREFIX + name, { start, end: performance.now(), detail }),
  );
}

/**
 * Runs `work`, recording as `name` how long it took to settle less the `nested` measures recorded
 * within it, so work that interleaves with the timed work is not counted twice.
 */
export function perfTimeAsyncExcluding<T>(
  name: string,
  nested: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!perfMarksEnabled()) return work();
  const start = performance.now();
  return work().finally(() => {
    const end = performance.now();
    const overlapped = performance
      .getEntriesByName(PERF_ENTRY_PREFIX + nested, 'measure')
      .filter((entry) => entry.startTime >= start && entry.startTime + entry.duration <= end)
      .reduce((total, entry) => total + entry.duration, 0);
    performance.measure(PERF_ENTRY_PREFIX + name, { start, duration: end - start - overlapped });
  });
}

/** Settles as `pending` does, once it has recorded how long `pending` took to settle as `name`. */
export function perfTrack<T>(name: string, pending: Promise<T>, detail?: unknown): Promise<T> {
  if (!perfMarksEnabled()) return pending;
  const start = performance.now();
  return pending.finally(() =>
    performance.measure(PERF_ENTRY_PREFIX + name, { start, end: performance.now(), detail }),
  );
}
