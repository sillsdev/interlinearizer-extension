/// <reference types="jest" />

import { readHostPerf, setHostPerfMarks } from '../../services/hostPerf';
import { perfMarksEnabled, setPerfMarksEnabled, takePerfEntries } from '../../utils/perf-marks';

jest.mock('../../utils/perf-marks');

const entries = [{ name: 'getDraft', duration: 12, detail: undefined }];
const memory = { heapUsed: 10, external: 20, rss: 30, heapTotal: 40, arrayBuffers: 50 };

beforeEach(() => {
  jest.mocked(takePerfEntries).mockReturnValue(entries);
  jest.spyOn(process, 'memoryUsage').mockReturnValue(memory);
});

afterEach(() => {
  globalThis.gc = undefined;
});

describe('setHostPerfMarks', () => {
  it("switches the host's timing entries as asked", () => {
    setHostPerfMarks(true);

    expect(setPerfMarksEnabled).toHaveBeenCalledWith(true);
  });

  it('discards the entries the host already holds', () => {
    setHostPerfMarks(false);

    expect(takePerfEntries).toHaveBeenCalled();
  });
});

describe('readHostPerf', () => {
  it('reads nothing while timing entries are off', () => {
    jest.mocked(perfMarksEnabled).mockReturnValue(false);

    expect(readHostPerf(true)).toBeUndefined();
    expect(takePerfEntries).not.toHaveBeenCalled();
  });

  it('takes the recorded entries without the heap by default', () => {
    jest.mocked(perfMarksEnabled).mockReturnValue(true);

    expect(readHostPerf()).toEqual({ entries });
  });

  it('collects garbage before reading the heap when the host allows it', () => {
    jest.mocked(perfMarksEnabled).mockReturnValue(true);
    const gc = jest.fn();
    globalThis.gc = gc;

    expect(readHostPerf(true)).toEqual({
      entries,
      heap: { heapUsed: 10, external: 20, rss: 30, gcForced: true },
    });
    expect(gc).toHaveBeenCalled();
  });

  it('reads the heap as it stands when the host cannot collect garbage', () => {
    jest.mocked(perfMarksEnabled).mockReturnValue(true);

    expect(readHostPerf(true)?.heap).toEqual({
      heapUsed: 10,
      external: 20,
      rss: 30,
      gcForced: false,
    });
  });
});
