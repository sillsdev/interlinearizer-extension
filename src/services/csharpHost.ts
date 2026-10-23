import papi, { logger } from '@papi/backend';
import type { ExecutionToken } from '@papi/core';

/** The parts of a started process the host's supervision uses. */
export interface HostProcess {
  stdout: { on(event: 'data', listener: (chunk: unknown) => void): unknown };
  stderr: { on(event: 'data', listener: (chunk: unknown) => void): unknown };
  on(event: 'error' | 'exit', listener: (detail: unknown) => void): unknown;
  kill(): boolean;
}

/** The parts of the platform's `createProcess` privilege the host needs. */
export interface HostLauncher {
  osData: { platform: string };
  spawn(
    executionToken: ExecutionToken,
    command: string,
    args: readonly string[],
    options: { stdio: ['pipe', 'pipe', 'pipe'] },
  ): HostProcess;
}

/**
 * The host's executable relative to the extension's root, for the platforms and processors
 * Platform.Bible ships for; `undefined` for any other.
 */
export function hostExecutable(platform: string, arch: string): string | undefined {
  if (platform === 'win32') return 'c-sharp/win-x64/InterlinearizerHost.exe';
  if (platform === 'linux' && arch === 'x64') return 'c-sharp/linux-x64/InterlinearizerHost';
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64'))
    return `c-sharp/osx-${arch}/InterlinearizerHost`;
  return undefined;
}

/** What stops a host that never started. */
const stopNothing = (): boolean => true;

/** The line the host writes once it has registered its commands. */
export const HOST_READY_LINE = 'Interlinearizer host ready';

/**
 * Starts the interlinearizer's .NET process, which serves its C# commands over the Platform.Bible
 * network, and pings it once it is ready. Anything that goes wrong is logged, never thrown: the
 * extension works without the process. `arch` is the processor the extension host runs on, as Node
 * names it.
 *
 * @returns Stops the process. Register it so deactivation does, since the platform stops the
 *   processes extensions start only in packaged builds.
 */
export function startCSharpHost(
  executionToken: ExecutionToken,
  createProcess: HostLauncher | undefined,
  arch: string = process.arch,
): () => boolean {
  if (!createProcess) {
    logger.warn('Interlinearizer: the manifest grants no createProcess, so the C# host is off');
    return stopNothing;
  }
  const { platform } = createProcess.osData;
  const executable = hostExecutable(platform, arch);
  if (!executable) {
    logger.warn(`Interlinearizer: no C# host for ${platform} on ${arch}`);
    return stopNothing;
  }

  const host = createProcess.spawn(executionToken, executable, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  host.on('error', (e) => logger.warn('Interlinearizer: the C# host could not start', e));
  host.on('exit', (code) =>
    logger.info(`Interlinearizer: the C# host exited with code ${String(code)}`),
  );
  host.stderr.on('data', (chunk) => logger.warn(`Interlinearizer C# host: ${String(chunk)}`));
  // Output arrives in chunks that need not end at a line break, so the end of each chunk is
  // carried into the next, where the rest of a split ready line would arrive.
  let carried = '';
  host.stdout.on('data', (chunk) => {
    const output = String(chunk);
    logger.debug(`Interlinearizer C# host: ${output}`);
    const unread = carried + output;
    if (unread.includes(HOST_READY_LINE)) pingHost();
    carried = unread.slice(1 - HOST_READY_LINE.length);
  });

  return () => host.kill();
}

/** Logs which .NET runtime and process answer the host's ping, or why none did. */
async function pingHost(): Promise<void> {
  try {
    const answer = await papi.commands.sendCommand('interlinearizer.csharpPing', 'activation');
    logger.info(
      `Interlinearizer: the C# host answered "${answer.message}" from .NET ${answer.runtimeVersion}, process ${answer.processId}`,
    );
  } catch (e) {
    logger.warn('Interlinearizer: the C# host did not answer its ping', e);
  }
}
