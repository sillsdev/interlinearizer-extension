/// <reference types="jest" />

type PerfMarks = typeof import('../../utils/perf-marks');

type Entry = { name: string; entryType: string; startTime: number; detail?: unknown };

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
    clock = 400;

    perfMarks.perfMeasure('book-render', 'book-change');

    expect(performance.measure).toHaveBeenCalledWith('ilz:book-render', {
      start: 150,
      end: 400,
      detail: { book: 'EXO' },
    });
  });

  it('carries no detail from a start entry that has none', () => {
    const perfMarks = loadPerfMarks('true');
    entries.push({ name: 'ilz:dispatch', entryType: 'mark', startTime: 10 });

    perfMarks.perfMeasure('dispatch-render', 'dispatch');

    expect(performance.measure).toHaveBeenCalledWith('ilz:dispatch-render', {
      start: 10,
      end: 100,
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
      end: 130,
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

describe('perfTrack', () => {
  it('resolves as the promise it was given does, recording when it settled', async () => {
    const tracked = loadPerfMarks('true').perfTrack('autosave', Promise.resolve('saved'), {
      bytes: 12,
    });
    clock = 180;

    await expect(tracked).resolves.toBe('saved');
    expect(performance.measure).toHaveBeenCalledWith('ilz:autosave', {
      start: 100,
      end: 180,
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
