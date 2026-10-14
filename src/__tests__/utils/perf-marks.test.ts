/// <reference types="jest" />

type PerfMarks = typeof import('../../utils/perf-marks');

type Entry = {
  name: string;
  entryType: string;
  startTime: number;
  duration?: number;
  detail?: unknown;
};

let entries: Entry[];
let clock: number;

/** Loads a fresh copy of the module, as a new window would, with the storage key as given. */
function loadPerfMarks(flag?: string): PerfMarks {
  if (flag === undefined) localStorage.removeItem('interlinearizer.perfMarks');
  else localStorage.setItem('interlinearizer.perfMarks', flag);
  let loaded: PerfMarks | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<PerfMarks>('../../utils/perf-marks');
  });
  if (!loaded) throw new Error('perf-marks did not load');
  return loaded;
}

beforeEach(() => {
  entries = [];
  clock = 100;
  Object.assign(performance, {
    now: jest.fn(() => clock),
    mark: jest.fn((name: string, options?: { detail?: unknown }) => {
      entries.push({ name, entryType: 'mark', startTime: clock, detail: options?.detail });
    }),
    measure: jest.fn(),
    getEntriesByName: jest.fn((name: string, type: string) =>
      entries.filter((e) => e.name === name && e.entryType === type),
    ),
    getEntriesByType: jest.fn((type: string) => entries.filter((e) => e.entryType === type)),
    clearMeasures: jest.fn(),
    clearMarks: jest.fn(),
  });
});

afterEach(() => {
  localStorage.clear();
});

describe('perfMarksEnabled', () => {
  it('is off when the storage key is absent', () => {
    expect(loadPerfMarks().perfMarksEnabled()).toBe(false);
  });

  it('is on when the storage key is "true"', () => {
    expect(loadPerfMarks('true').perfMarksEnabled()).toBe(true);
  });

  it('is off when the storage key holds anything else', () => {
    expect(loadPerfMarks('yes').perfMarksEnabled()).toBe(false);
  });

  it('is off when storage cannot be read', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(loadPerfMarks('true').perfMarksEnabled()).toBe(false);
  });

  it('keeps its first answer for the life of the window', () => {
    const perfMarks = loadPerfMarks('true');
    perfMarks.perfMarksEnabled();
    localStorage.removeItem('interlinearizer.perfMarks');

    expect(perfMarks.perfMarksEnabled()).toBe(true);
  });
});

describe('setPerfMarksEnabled', () => {
  it('turns entries on where storage leaves them off', () => {
    const perfMarks = loadPerfMarks();

    perfMarks.setPerfMarksEnabled(true);

    expect(perfMarks.perfMarksEnabled()).toBe(true);
  });

  it('turns entries off where storage turns them on', () => {
    const perfMarks = loadPerfMarks('true');

    perfMarks.setPerfMarksEnabled(false);

    expect(perfMarks.perfMarksEnabled()).toBe(false);
  });
});

describe('takePerfEntries', () => {
  it("returns this extension's measures without their prefix", () => {
    entries.push(
      { name: 'ilz:getDraft', entryType: 'measure', startTime: 0, duration: 12, detail: 7 },
      { name: 'other:render', entryType: 'measure', startTime: 0, duration: 3, detail: 0 },
    );

    expect(loadPerfMarks().takePerfEntries()).toEqual([
      { name: 'getDraft', duration: 12, detail: 7 },
    ]);
  });

  it('carries no detail from an entry that has none', () => {
    entries.push({ name: 'ilz:getDraft', entryType: 'measure', startTime: 0, duration: 12 });

    expect(loadPerfMarks().takePerfEntries()).toEqual([
      { name: 'getDraft', duration: 12, detail: undefined },
    ]);
  });

  it('clears its own entries from the timeline, once per name', () => {
    entries.push(
      { name: 'ilz:getDraft', entryType: 'measure', startTime: 0, duration: 12 },
      { name: 'ilz:getDraft', entryType: 'measure', startTime: 20, duration: 9 },
      { name: 'ilz:dispatch', entryType: 'mark', startTime: 5 },
    );

    loadPerfMarks().takePerfEntries();

    expect(performance.clearMeasures).toHaveBeenCalledTimes(1);
    expect(performance.clearMeasures).toHaveBeenCalledWith('ilz:getDraft');
    expect(performance.clearMarks).toHaveBeenCalledWith('ilz:dispatch');
  });

  it('leaves entries other code recorded on the timeline', () => {
    entries.push(
      { name: 'other:render', entryType: 'measure', startTime: 0, duration: 3 },
      { name: 'other:start', entryType: 'mark', startTime: 0 },
    );

    loadPerfMarks().takePerfEntries();

    expect(performance.clearMeasures).not.toHaveBeenCalled();
    expect(performance.clearMarks).not.toHaveBeenCalled();
  });
});

describe('perfMark', () => {
  it('records a prefixed mark carrying its detail when marks are on', () => {
    loadPerfMarks('true').perfMark('book-change', { book: 'GEN' });

    expect(performance.mark).toHaveBeenCalledWith('ilz:book-change', { detail: { book: 'GEN' } });
  });

  it('records nothing when marks are off', () => {
    loadPerfMarks().perfMark('book-change');

    expect(performance.mark).not.toHaveBeenCalled();
  });
});

describe('perfMeasure', () => {
  it('times from the latest start mark, carrying its detail', () => {
    const perfMarks = loadPerfMarks('true');
    perfMarks.perfMark('book-change', { book: 'GEN' });
    clock = 150;
    perfMarks.perfMark('book-change', { book: 'EXO' });

    perfMarks.perfMeasure('book-render', 'book-change');

    expect(performance.measure).toHaveBeenCalledWith('ilz:book-render', {
      start: 150,
      detail: { book: 'EXO' },
    });
  });

  it('carries no detail from a start entry that has none', () => {
    const perfMarks = loadPerfMarks('true');
    entries.push({ name: 'ilz:dispatch', entryType: 'mark', startTime: 10 });

    perfMarks.perfMeasure('dispatch-render', 'dispatch');

    expect(performance.measure).toHaveBeenCalledWith('ilz:dispatch-render', {
      start: 10,
      detail: undefined,
    });
  });

  it('records nothing when no start mark was made', () => {
    loadPerfMarks('true').perfMeasure('book-render', 'book-change');

    expect(performance.measure).not.toHaveBeenCalled();
  });

  it('records nothing when marks are off', () => {
    entries.push({ name: 'ilz:book-change', entryType: 'mark', startTime: 10 });

    loadPerfMarks().perfMeasure('book-render', 'book-change');

    expect(performance.measure).not.toHaveBeenCalled();
  });
});

describe('perfTime', () => {
  it('returns what the work returns and records how long it took', () => {
    const result = loadPerfMarks('true').perfTime(
      'tokenize',
      () => {
        clock = 130;
        return 'tokens';
      },
      { book: 'GEN' },
    );

    expect(result).toBe('tokens');
    expect(performance.measure).toHaveBeenCalledWith('ilz:tokenize', {
      start: 100,
      detail: { book: 'GEN' },
    });
  });

  it('records the time even when the work throws', () => {
    const perfMarks = loadPerfMarks('true');

    expect(() =>
      perfMarks.perfTime('tokenize', () => {
        throw new Error('bad USJ');
      }),
    ).toThrow('bad USJ');
    expect(performance.measure).toHaveBeenCalledTimes(1);
  });

  it('only runs the work when marks are off', () => {
    const work = jest.fn(() => 'tokens');

    expect(loadPerfMarks().perfTime('tokenize', work)).toBe('tokens');
    expect(work).toHaveBeenCalledTimes(1);
    expect(performance.measure).not.toHaveBeenCalled();
  });
});

describe('perfTimeAsync', () => {
  it('resolves as the work does, timing from before the work started', async () => {
    const timed = loadPerfMarks('true').perfTimeAsync(
      'getDraft',
      () => {
        clock = 120;
        return Promise.resolve('draft');
      },
      { bytes: 5 },
    );

    await expect(timed).resolves.toBe('draft');
    expect(performance.measure).toHaveBeenCalledWith('ilz:getDraft', {
      start: 100,
      detail: { bytes: 5 },
    });
  });

  it('records the time even when the work rejects', async () => {
    const timed = loadPerfMarks('true').perfTimeAsync('getDraft', () =>
      Promise.reject(new Error('disk full')),
    );

    await expect(timed).rejects.toThrow('disk full');
    expect(performance.measure).toHaveBeenCalledTimes(1);
  });

  it('only runs the work when marks are off', async () => {
    const work = jest.fn(() => Promise.resolve('draft'));

    await expect(loadPerfMarks().perfTimeAsync('getDraft', work)).resolves.toBe('draft');
    expect(work).toHaveBeenCalledTimes(1);
    expect(performance.measure).not.toHaveBeenCalled();
  });
});

describe('perfTimeAsyncExcluding', () => {
  it('records the span less the nested measures recorded within it', async () => {
    const timed = loadPerfMarks('true').perfTimeAsyncExcluding(
      'getDraft:read',
      'getDraft:parse',
      () => {
        entries.push(
          { name: 'ilz:getDraft:parse', entryType: 'measure', startTime: 110, duration: 20 },
          { name: 'ilz:getDraft:parse', entryType: 'measure', startTime: 150, duration: 10 },
        );
        return Promise.resolve('shards');
      },
    );
    clock = 180;

    await expect(timed).resolves.toBe('shards');
    expect(performance.measure).toHaveBeenCalledWith('ilz:getDraft:read', {
      start: 100,
      duration: 50,
    });
  });

  it('counts no nested measure recorded outside the span', async () => {
    entries.push({ name: 'ilz:getDraft:parse', entryType: 'measure', startTime: 40, duration: 20 });
    const timed = loadPerfMarks('true').perfTimeAsyncExcluding(
      'getDraft:read',
      'getDraft:parse',
      () => Promise.resolve('shards'),
    );
    clock = 180;

    await timed;

    expect(performance.measure).toHaveBeenCalledWith('ilz:getDraft:read', {
      start: 100,
      duration: 80,
    });
  });

  it('only runs the work when marks are off', async () => {
    const work = jest.fn(() => Promise.resolve('shards'));

    await expect(
      loadPerfMarks().perfTimeAsyncExcluding('getDraft:read', 'getDraft:parse', work),
    ).resolves.toBe('shards');
    expect(work).toHaveBeenCalledTimes(1);
    expect(performance.measure).not.toHaveBeenCalled();
  });
});

describe('perfTrack', () => {
  it('resolves as the promise it was given does, recording when it settled', async () => {
    const tracked = loadPerfMarks('true').perfTrack('autosave', Promise.resolve('saved'), {
      bytes: 12,
    });

    await expect(tracked).resolves.toBe('saved');
    expect(performance.measure).toHaveBeenCalledWith('ilz:autosave', {
      start: 100,
      detail: { bytes: 12 },
    });
  });

  it('records when the promise rejects', async () => {
    const pending = Promise.reject(new Error('offline'));

    await expect(loadPerfMarks('true').perfTrack('autosave', pending)).rejects.toThrow('offline');
    expect(performance.measure).toHaveBeenCalledTimes(1);
  });

  it('hands back the promise it was given, recording nothing, when marks are off', async () => {
    const pending = Promise.resolve('saved');

    const tracked = loadPerfMarks().perfTrack('autosave', pending);
    await tracked;

    expect(tracked).toBe(pending);
    expect(performance.measure).not.toHaveBeenCalled();
  });
});
