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
}

let sessionReadsSkipped = false;

/**
 * Turns on or off skipping the whole-text read that a session starts once a feature needs the whole
 * text, so the harness can time the view without it. Off until turned on.
 */
export function setSessionReadsSkipped(on: boolean): void {
  sessionReadsSkipped = on;
}

/** Whether sessions read no text, even once a feature needs it. */
export function sessionReadsAreSkipped(): boolean {
  return sessionReadsSkipped;
}

/** Turns the host's timing entries on or off, discarding any it holds. */
export function setHostPerfMarks(on: boolean): void {
  setPerfMarksEnabled(on);
  takePerfEntries();
}

/**
 * Takes the timing entries the host recorded since the last reading.
 *
 * @returns `undefined` while the host's timing entries are off.
 */
export function readHostPerf(): HostPerfReading | undefined {
  if (!perfMarksEnabled()) return undefined;
  return { entries: takePerfEntries(), pid: process.pid };
}
