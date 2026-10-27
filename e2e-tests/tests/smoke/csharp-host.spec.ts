import fs from 'fs';
import path from 'path';
import { test, expect } from '../../fixtures/app.fixture';
import { sendPapiRequestOnce, waitForPapiMethodRegistered } from '../../fixtures/helpers';

const PING_REQUEST_TYPE = 'command:interlinearizer.csharpPing';

/**
 * The runtime identifier `npm run build:c-sharp` publishes each platform and processor's host
 * under.
 */
const RUNTIME_IDENTIFIERS: Record<string, string | undefined> = {
  'win32 x64': 'win-x64',
  'linux x64': 'linux-x64',
  'darwin x64': 'osx-x64',
  'darwin arm64': 'osx-arm64',
};

const RUNTIME_IDENTIFIER = RUNTIME_IDENTIFIERS[`${process.platform} ${process.arch}`];

test.describe('C# host', () => {
  // CI always publishes the host; locally it exists only after `npm run build:c-sharp`.
  test.skip(
    !process.env.CI &&
      !(
        RUNTIME_IDENTIFIER &&
        fs.existsSync(
          path.join(__dirname, '..', '..', '..', 'c-sharp', 'publish', RUNTIME_IDENTIFIER),
        )
      ),
    `C# host not published for this machine; run \`npm run build:c-sharp -- ${RUNTIME_IDENTIFIER ?? '<runtime identifier>'}\` first`,
  );

  test('should answer a ping routed through Platform.Bible', async ({ mainPage }) => {
    await mainPage.waitForSelector('#root', { state: 'attached', timeout: 30_000 });
    await waitForPapiMethodRegistered(PING_REQUEST_TYPE, undefined, 60_000);

    const message = `e2e-${Date.now()}`;
    const result = await sendPapiRequestOnce<{
      message: string;
      runtimeVersion: string;
      processId: number;
    }>(PING_REQUEST_TYPE, [message]);

    expect(result.message).toBe(message);
    // The host's bundled runtime, not the .NET 8 that Platform.Bible ships.
    expect(result.runtimeVersion).toMatch(/^10\./);
    expect(result.processId).toBeGreaterThan(0);
  });
});
