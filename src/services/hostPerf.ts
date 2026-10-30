import {
  perfMarksEnabled,
  setPerfMarksEnabled,
  takePerfEntries,
  type PerfEntry,
} from '../utils/perf-marks';

/** What the host has recorded since the last reading. */
export interface HostPerfReading {
  entries: PerfEntry[];
  pid: number;
  /** Re-anchor passes queued or running on the host's sessions. */
  passesPending: number;
}

/** Turns the host's timing entries on or off, discarding any it holds. */
export function setHostPerfMarks(on: boolean): void {
  setPerfMarksEnabled(on);
  takePerfEntries();
}

/**
 * Takes the timing entries the host recorded since the last reading, and reports them with
 * `passesPending`.
 *
 * @returns `undefined` while the host's timing entries are off.
 */
export function readHostPerf(passesPending: number): HostPerfReading | undefined {
  if (!perfMarksEnabled()) return undefined;
  return { entries: takePerfEntries(), pid: process.pid, passesPending };
}
