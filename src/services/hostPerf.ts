import {
  perfMarksEnabled,
  setPerfMarksEnabled,
  takePerfEntries,
  type PerfEntry,
} from '../utils/perf-marks';

/** The extension host's memory, in bytes, as `process.memoryUsage` reports it. */
export interface HostHeap {
  heapUsed: number;
  external: number;
  rss: number;
  /** Whether a full collection ran first, which needs the host started with `--expose-gc`. */
  gcForced: boolean;
}

/** What the host has recorded since the last reading. */
export interface HostPerfReading {
  entries: PerfEntry[];
  /** Absent unless the reading asked for it. */
  heap?: HostHeap;
}

/** Turns the host's timing entries on or off, discarding any it holds. */
export function setHostPerfMarks(on: boolean): void {
  setPerfMarksEnabled(on);
  takePerfEntries();
}

function readHeap(): HostHeap {
  const { gc } = globalThis;
  if (gc) gc();
  const { heapUsed, external, rss } = process.memoryUsage();
  return { heapUsed, external, rss, gcForced: !!gc };
}

/**
 * Takes the timing entries the host recorded since the last reading, and its heap when asked.
 *
 * @returns `undefined` while the host's timing entries are off.
 */
export function readHostPerf(includeHeap = false): HostPerfReading | undefined {
  if (!perfMarksEnabled()) return undefined;
  return { entries: takePerfEntries(), ...(includeHeap && { heap: readHeap() }) };
}
