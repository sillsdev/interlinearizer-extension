import { DebouncedWriter } from '../../utils/debounced-writer';

/** One write handed to the writer, settled by the test. */
type HeldWrite = { value: string; resolve: () => void; reject: (e: Error) => void };

/** A writer over writes the test settles by hand, with every failure recorded. */
function heldWriter(delayMs = 100) {
  const writes: HeldWrite[] = [];
  const failures: unknown[] = [];
  const writer = new DebouncedWriter<string>({
    write: (value) =>
      new Promise<void>((resolve, reject) => {
        writes.push({ value, resolve, reject });
      }),
    delayMs,
    onFailure: (e) => failures.push(e),
  });
  return { writer, writes, failures };
}

/** Lets every promise reaction queued so far run. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('DebouncedWriter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes a scheduled value once the delay passes with no later value', () => {
    const { writer, writes } = heldWriter();

    writer.schedule('a');
    writer.schedule('b');
    jest.advanceTimersByTime(99);
    expect(writes).toHaveLength(0);

    jest.advanceTimersByTime(1);
    expect(writes.map((w) => w.value)).toEqual(['b']);
  });

  it('drops a scheduled value on cancel', () => {
    const { writer, writes } = heldWriter();

    writer.schedule('a');
    writer.cancel();
    jest.advanceTimersByTime(100);

    expect(writes).toHaveLength(0);
  });

  it('writes at once on writeNow, dropping the scheduled value', () => {
    const { writer, writes } = heldWriter();

    writer.schedule('a');
    writer.writeNow('b');
    jest.advanceTimersByTime(100);

    expect(writes.map((w) => w.value)).toEqual(['b']);
  });

  it('sends the scheduled value at once on flush', () => {
    const { writer, writes } = heldWriter();

    writer.schedule('a');
    writer.flush();

    expect(writes.map((w) => w.value)).toEqual(['a']);
    jest.advanceTimersByTime(100);
    expect(writes).toHaveLength(1);
  });

  it('sends nothing on flush when no value is scheduled', () => {
    const { writer, writes } = heldWriter();

    writer.flush();

    expect(writes).toHaveLength(0);
  });

  it('reports each failed write', async () => {
    const { writer, writes, failures } = heldWriter();
    const failure = new Error('disk full');

    writer.writeNow('a');
    writes[0].reject(failure);
    await flushMicrotasks();

    expect(failures).toEqual([failure]);
  });

  describe('settle', () => {
    it('resolves at once when nothing was ever written', async () => {
      const { writer } = heldWriter();

      await expect(writer.settle()).resolves.toBeUndefined();
    });

    it('sends the scheduled value and resolves once it lands', async () => {
      const { writer, writes } = heldWriter();
      writer.schedule('a');

      let settled = false;
      const settle = (async () => {
        await writer.settle();
        settled = true;
      })();
      expect(writes.map((w) => w.value)).toEqual(['a']);
      await flushMicrotasks();
      expect(settled).toBe(false);

      writes[0].resolve();
      await settle;
      expect(settled).toBe(true);
    });

    it('waits for a write in flight', async () => {
      const { writer, writes } = heldWriter();
      writer.writeNow('a');

      let settled = false;
      const settle = (async () => {
        await writer.settle();
        settled = true;
      })();
      await flushMicrotasks();
      expect(settled).toBe(false);

      writes[0].resolve();
      await settle;
      expect(settled).toBe(true);
    });

    it('waits for a value written while it waits, and sends one scheduled meanwhile', async () => {
      const { writer, writes } = heldWriter();
      writer.writeNow('a');
      let settled = false;
      const settle = (async () => {
        await writer.settle();
        settled = true;
      })();

      writer.writeNow('b');
      writes[0].resolve();
      await flushMicrotasks();
      expect(settled).toBe(false);

      writer.schedule('c');
      writes[1].resolve();
      await flushMicrotasks();
      expect(settled).toBe(false);
      expect(writes.map((w) => w.value)).toEqual(['a', 'b', 'c']);

      writes[2].resolve();
      await settle;
      expect(settled).toBe(true);
    });

    it('sends the last value again when its write failed', async () => {
      const { writer, writes } = heldWriter();
      writer.writeNow('a');
      writes[0].reject(new Error('disk full'));
      await flushMicrotasks();

      const settle = writer.settle();
      expect(writes.map((w) => w.value)).toEqual(['a', 'a']);

      writes[1].resolve();
      await expect(settle).resolves.toBeUndefined();
    });

    it('rejects with the failure when the value sent again fails too', async () => {
      const { writer, writes } = heldWriter();
      writer.writeNow('a');
      writes[0].reject(new Error('first'));
      await flushMicrotasks();

      const settle = writer.settle();
      const second = new Error('second');
      writes[1].reject(second);

      await expect(settle).rejects.toBe(second);
    });

    it('does not count a failure of a write that a later write superseded', async () => {
      const { writer, writes } = heldWriter();
      writer.writeNow('a');
      writer.writeNow('b');
      writes[0].reject(new Error('stale'));
      writes[1].resolve();
      await flushMicrotasks();

      const settle = writer.settle();

      expect(writes).toHaveLength(2);
      await expect(settle).resolves.toBeUndefined();
    });
  });
});
