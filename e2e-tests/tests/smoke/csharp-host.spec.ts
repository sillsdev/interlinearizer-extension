import fs from 'fs';
import path from 'path';
import { test, expect } from '../../fixtures/app.fixture';
import { sendPapiRequestOnce, waitForPapiMethodRegistered } from '../../fixtures/helpers';

const PING_REQUEST_TYPE = 'command:interlinearizer.csharpPing';

const PUBLISH_DIR = path.join(__dirname, '..', '..', '..', 'c-sharp', 'publish');

test.describe('C# host', () => {
  // CI always publishes the host; locally it exists only after `npm run build:c-sharp`.
  test.skip(
    !process.env.CI && !fs.existsSync(PUBLISH_DIR),
    'C# host not published; run `npm run build:c-sharp -- <runtime identifier>` first',
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
