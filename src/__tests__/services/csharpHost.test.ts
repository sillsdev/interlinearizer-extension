import papi, { logger } from '@papi/backend';
import { EventEmitter } from 'events';
import {
  HOST_READY_LINE,
  hostExecutable,
  startCSharpHost,
  type HostLauncher,
  type HostProcess,
} from '../../services/csharpHost';
import { createTestActivationContext } from '../test-helpers';

const token = createTestActivationContext().executionToken;

/** A started process whose output and lifecycle events the test emits. */
class FakeHost extends EventEmitter implements HostProcess {
  stdout = new EventEmitter();

  stderr = new EventEmitter();

  kill = jest.fn(() => true);
}

/** A launcher for `platform` that hands out `host` and records what it was asked to start. */
function makeLauncher(platform: string, host: FakeHost) {
  const spawn = jest.fn<HostProcess, Parameters<HostLauncher['spawn']>>(() => host);
  const launcher: HostLauncher = { osData: { platform }, spawn };
  return { launcher, spawn };
}

/** Lets the ping's command and its logging settle. */
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('startCSharpHost', () => {
  it('starts nothing without the createProcess privilege', () => {
    const stop = startCSharpHost(token, undefined);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('createProcess'));
    expect(stop()).toBe(true);
  });

  it('starts nothing on a platform with no host build', () => {
    const host = new FakeHost();
    const { launcher, spawn } = makeLauncher('linux', host);

    startCSharpHost(token, launcher, 'arm64');

    expect(spawn).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('linux on arm64'));
  });

  it('starts the build for the platform and processor it runs on', () => {
    const { launcher, spawn } = makeLauncher('darwin', new FakeHost());

    startCSharpHost(token, launcher, 'arm64');

    expect(spawn).toHaveBeenCalledWith(
      token,
      'c-sharp/osx-arm64/InterlinearizerHost',
      [],
      expect.anything(),
    );
  });

  it('defaults to the processor the extension host runs on', () => {
    const { launcher, spawn } = makeLauncher('darwin', new FakeHost());

    startCSharpHost(token, launcher);

    expect(spawn).toHaveBeenCalledWith(
      token,
      `c-sharp/osx-${process.arch}/InterlinearizerHost`,
      [],
      expect.anything(),
    );
  });

  it('stops the host when the returned function runs', () => {
    const host = new FakeHost();

    const stop = startCSharpHost(token, makeLauncher('win32', host).launcher);
    stop();

    expect(host.kill).toHaveBeenCalled();
  });

  it('pings the host once it reports ready, and logs who answered', async () => {
    jest.mocked(papi.commands.sendCommand).mockResolvedValue({
      message: 'activation',
      runtimeVersion: '8.0.1',
      processId: 42,
    });
    const host = new FakeHost();
    startCSharpHost(token, makeLauncher('win32', host).launcher);

    host.stdout.emit('data', 'PapiClient connecting\n');
    expect(papi.commands.sendCommand).not.toHaveBeenCalled();
    host.stdout.emit('data', `${HOST_READY_LINE}\n`);
    await flushPromises();

    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.csharpPing',
      'activation',
    );
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('.NET 8.0.1, process 42'));
  });

  it('logs a ping the host does not answer', async () => {
    const failure = new Error('no handler');
    jest.mocked(papi.commands.sendCommand).mockRejectedValue(failure);
    const host = new FakeHost();
    startCSharpHost(token, makeLauncher('win32', host).launcher);

    host.stdout.emit('data', HOST_READY_LINE);
    await flushPromises();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not answer'), failure);
  });

  it('logs a host that cannot start, its errors, and its exit', () => {
    const host = new FakeHost();
    startCSharpHost(token, makeLauncher('win32', host).launcher);
    const failure = new Error('ENOENT');

    host.emit('error', failure);
    host.stderr.emit('data', 'Could not connect');
    host.emit('exit', 1);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not start'), failure);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not connect'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('exited with code 1'));
  });
});

describe('hostExecutable', () => {
  it.each([
    ['win32', 'x64', 'c-sharp/win-x64/InterlinearizerHost.exe'],
    ['win32', 'arm64', 'c-sharp/win-x64/InterlinearizerHost.exe'],
    ['linux', 'x64', 'c-sharp/linux-x64/InterlinearizerHost'],
    ['darwin', 'x64', 'c-sharp/osx-x64/InterlinearizerHost'],
    ['darwin', 'arm64', 'c-sharp/osx-arm64/InterlinearizerHost'],
  ])('finds the %s %s build', (platform, arch, executable) => {
    expect(hostExecutable(platform, arch)).toBe(executable);
  });

  it.each([
    ['linux', 'arm64'],
    ['darwin', 'ia32'],
    ['aix', 'x64'],
  ])('has no build for %s on %s', (platform, arch) => {
    expect(hostExecutable(platform, arch)).toBeUndefined();
  });
});
