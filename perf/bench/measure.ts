import { performance } from 'perf_hooks';

/** Timing of one benchmarked operation. */
export interface Timing {
  runs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

/**
 * Runs a full collection when Node was started with `--expose-gc`, so one run's garbage is not
 * billed to the next.
 */
export function collectGarbage(): void {
  if (typeof globalThis.gc === 'function') globalThis.gc();
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const round = (ms: number) => Math.round(ms * 1000) / 1000;

/** Summarizes durations as the median and p95 the protocol reports. */
export function summarize(durations: number[]): Timing {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    runs: sorted.length,
    medianMs: round(percentile(sorted, 50)),
    p95Ms: round(percentile(sorted, 95)),
    minMs: round(sorted[0]),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

/**
 * Times `run` after `warmup` unrecorded calls, preparing each call's input untimed with `setup` so
 * every run can start from fresh state.
 */
export function measure<T>(
  { runs, warmup }: { runs: number; warmup: number },
  setup: (index: number) => T,
  run: (input: T, index: number) => unknown,
): Timing {
  const durations: number[] = [];
  for (let i = 0; i < warmup + runs; i += 1) {
    const input = setup(i);
    collectGarbage();
    const start = performance.now();
    run(input, i);
    const elapsed = performance.now() - start;
    if (i >= warmup) durations.push(elapsed);
  }
  return summarize(durations);
}

/** Heap bytes `build`'s result keeps alive, measured across forced collections. */
export function retainedBytes(build: () => unknown): number {
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  const kept = build();
  collectGarbage();
  const after = process.memoryUsage().heapUsed;
  // Reading `kept` after the second collection keeps it reachable through the measurement.
  return kept === undefined ? 0 : after - before;
}
