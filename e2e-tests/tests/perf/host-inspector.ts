/** Port Node's inspector listens on when a running process is asked to open it. */
const INSPECTOR_PORT = 9229;

const INSPECTOR_TIMEOUT_MS = 10_000;

/** The extension host's memory after a full garbage collection, in bytes. */
export type HostHeap = { heapUsed: number; external: number; rss: number };

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** Asks Node process `pid` to open its inspector; a no-op once it is open. */
function openInspector(pid: number): void {
  // Node's undeclared counterpart to `kill -USR1`, which also works on Windows.
  const debugProcess: unknown = Reflect.get(process, '_debugProcess');
  if (typeof debugProcess !== 'function')
    throw new Error("This Node cannot open another process's inspector");
  debugProcess.call(process, pid);
}

async function inspectorUrl(deadline: number): Promise<string> {
  try {
    const response = await fetch(`http://127.0.0.1:${INSPECTOR_PORT}/json/list`);
    const targets: { webSocketDebuggerUrl?: string }[] = await response.json();
    const url = targets[0]?.webSocketDebuggerUrl;
    if (url) return url;
  } catch {
    // Not listening yet.
  }
  if (Date.now() > deadline)
    throw new Error(
      `No inspector opened on port ${INSPECTOR_PORT} within ${INSPECTOR_TIMEOUT_MS} ms`,
    );
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100);
  });
  return inspectorUrl(deadline);
}

/** Runs `use` against process `pid`'s inspector, closing the connection after. */
async function withInspector<T>(pid: number, use: (send: Send) => Promise<T>): Promise<T> {
  openInspector(pid);
  const socket = new WebSocket(await inspectorUrl(Date.now() + INSPECTOR_TIMEOUT_MS));
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (e: Error) => void }
  >();
  socket.addEventListener('message', (event) => {
    const { id, result, error } = JSON.parse(String(event.data));
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (error) waiter.reject(new Error(`${error.message} (${error.code})`));
    else waiter.resolve(result);
  });
  let nextId = 0;
  const send: Send = (method, params) =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
  try {
    return await use(send);
  } finally {
    socket.close();
  }
}

/** Evaluates `expression` in the inspected process, returning its JSON-compatible value. */
async function evaluate(send: Send, expression: string): Promise<unknown> {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true });
  const value = reply && typeof reply === 'object' && 'result' in reply ? reply.result : undefined;
  return value && typeof value === 'object' && 'value' in value ? value.value : undefined;
}

/**
 * Reads the memory of the extension host, process `pid`, right after a full garbage collection.
 *
 * @throws If the inspector does not open, or the one on {@link INSPECTOR_PORT} belongs to another
 *   process.
 */
export async function readHostHeap(pid: number): Promise<HostHeap> {
  return withInspector(pid, async (send) => {
    const inspected = await evaluate(send, 'process.pid');
    if (inspected !== pid)
      throw new Error(
        `The inspector on port ${INSPECTOR_PORT} belongs to process ${inspected}, not the extension host`,
      );
    await send('HeapProfiler.collectGarbage');
    const json = await evaluate(send, 'JSON.stringify(process.memoryUsage())');
    if (typeof json !== 'string') throw new Error('The extension host reported no memory usage');
    const { heapUsed, external, rss } = JSON.parse(json);
    return { heapUsed, external, rss };
  });
}
