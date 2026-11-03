import { spawn, type ChildProcess } from 'child_process';
import { once } from 'events';
import path from 'path';
import { WebSocketServer, type WebSocket } from 'ws';
import { HOST_READY_LINE } from '../../services/csharpHost';

/** The host published for this machine, as `npm run build:c-sharp` lays it out. */
export function publishedHostExecutable(): string {
  const rid: Record<string, string> = {
    'win32 x64': 'win-x64',
    'linux x64': 'linux-x64',
    'darwin x64': 'osx-x64',
    'darwin arm64': 'osx-arm64',
  };
  const identifier = rid[`${process.platform} ${process.arch}`];
  if (!identifier) throw new Error(`No C# host build for ${process.platform} on ${process.arch}`);
  return path.join(
    __dirname,
    '..',
    '..',
    '..',
    'c-sharp',
    'publish',
    identifier,
    process.platform === 'win32' ? 'InterlinearizerHost.exe' : 'InterlinearizerHost',
  );
}

/** A JSON-RPC 2.0 message as the host and the network exchange them. */
type RpcMessage = {
  id?: number;
  method?: string;
  params?: unknown[];
  result?: unknown;
  error?: { message: string };
};

/**
 * Stands in for the Platform.Bible network: one process of the C# host connects to it, registers
 * its commands, and answers the requests it is sent. The host is started from the published
 * executable, or the one `INTERLINEARIZER_HOST` names.
 */
export class FakePapi {
  private nextId = 1;

  private readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(
    private readonly server: WebSocketServer,
    private readonly host: ChildProcess,
    private readonly socket: WebSocket,
  ) {
    socket.on('message', (data) => this.receive(JSON.parse(String(data))));
  }

  /**
   * Starts a host that keeps its data in `dataDirectory`.
   *
   * @returns Resolves once the host has registered its commands.
   * @throws If the host exits before it is ready.
   */
  static async start(dataDirectory: string): Promise<FakePapi> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    const address = server.address();
    if (typeof address !== 'object' || !address) throw new Error('The server has no port');

    const executable = process.env.INTERLINEARIZER_HOST ?? publishedHostExecutable();
    const host = spawn(
      executable,
      ['--papi-port', String(address.port), '--data-dir', dataDirectory],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let papi: FakePapi | undefined;
    const registrations: Promise<void>[] = [];
    const connected = new Promise<WebSocket>((resolve) => {
      server.once('connection', (socket) => {
        // Registrations arrive before anything awaits them, so they are answered here and the
        // connection is handed over once the host reports ready.
        socket.on('message', (data) => {
          const message: RpcMessage = JSON.parse(String(data));
          if (papi || message.method !== 'network:registerMethod') return;
          registrations.push(FakePapi.reply(socket, message.id, true));
        });
        resolve(socket);
      });
    });

    let output = '';
    const ready = new Promise<void>((resolve, reject) => {
      host.stdout?.on('data', (chunk) => {
        output += String(chunk);
        if (output.includes(HOST_READY_LINE)) resolve();
      });
      host.stderr?.on('data', (chunk) => {
        output += String(chunk);
      });
      host.on('exit', (code) => reject(new Error(`The host exited with ${code}:\n${output}`)));
      host.on('error', reject);
    });
    const socket = await connected;
    await ready;
    await Promise.all(registrations);
    papi = new FakePapi(server, host, socket);
    return papi;
  }

  private static reply(socket: WebSocket, id: number | undefined, result: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, result }), (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  /**
   * Sends `method` one positional argument and resolves with the host's result.
   *
   * @throws {Error} With the host's message when it answers with an error.
   */
  invoke<T>(method: string, args: object): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      // The result is whatever JSON the host answered; callers name its type.
      // eslint-disable-next-line no-type-assertion/no-type-assertion
      this.pending.set(id, { resolve: (result) => resolve(result as T), reject });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: [args] }));
    });
  }

  /** Closes the connection, which the host exits on, and waits for it to exit. */
  async stop(): Promise<void> {
    const exited = once(this.host, 'exit');
    this.socket.close();
    await exited;
    this.server.close();
  }

  private receive(message: RpcMessage): void {
    if (message.method !== undefined) {
      if (message.method === 'network:registerMethod') {
        FakePapi.reply(this.socket, message.id, true);
        return;
      }
      throw new Error(`The host sent a request this network does not serve: ${message.method}`);
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (!pending) return;
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }
}
