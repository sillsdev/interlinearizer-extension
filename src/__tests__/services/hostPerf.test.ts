/// <reference types="jest" />

import {
  readHostPerf,
  sessionReadsAreSkipped,
  setHostPerfMarks,
  setSessionReadsSkipped,
} from '../../services/hostPerf';
import { perfMarksEnabled, setPerfMarksEnabled, takePerfEntries } from '../../utils/perf-marks';

jest.mock('../../utils/perf-marks');

const entries = [{ name: 'getDraft', duration: 12, detail: undefined }];

beforeEach(() => {
  jest.mocked(takePerfEntries).mockReturnValue(entries);
});

describe('setSessionReadsSkipped', () => {
  it('skips session reads once turned on', () => {
    setSessionReadsSkipped(true);

    expect(sessionReadsAreSkipped()).toBe(true);
  });

  it('reads again once turned off', () => {
    setSessionReadsSkipped(true);
    setSessionReadsSkipped(false);

    expect(sessionReadsAreSkipped()).toBe(false);
  });
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

    expect(readHostPerf()).toBeUndefined();
    expect(takePerfEntries).not.toHaveBeenCalled();
  });

  it("takes the recorded entries with the host's process id", () => {
    jest.mocked(perfMarksEnabled).mockReturnValue(true);

    expect(readHostPerf()).toEqual({ entries, pid: process.pid });
  });
});
