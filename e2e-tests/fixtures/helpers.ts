// Adapted from paranext-core/e2e-tests/fixtures/helpers.ts
import {
  _electron as electron,
  ElectronApplication,
  expect,
  FrameLocator,
  Locator,
  Page,
} from '@playwright/test';
import escapeStringRegexp from 'escape-string-regexp';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

const DEFAULT_WEBSOCKET_PORT = 8876;
const RPC_DISCOVER_POLL_INTERVAL_MS = 250;
export const PROCESS_READY_TIMEOUT = process.env.CI ? 600_000 : 120_000;

/**
 * Same serialized request type as `registerCommand('platform.about', ...)` in command.service
 * (`command` + `:` + `platform.about`).
 */
const PLATFORM_ABOUT_COMMAND = 'command:platform.about';

/**
 * Keep in sync with GET_METHODS from @shared/data/rpc.model. Required to be 'rpc.discover' by the
 * OpenRPC specification.
 */
const GET_METHODS = 'rpc.discover';

/** Subset of the `rpc.discover` response we actually inspect. */
type RpcDiscoverResult = {
  methods?: Array<{ name: string }>;
};

/** Return value from {@link launchElectronWithExtension}. */
export interface ElectronAppContext {
  electronApp: ElectronApplication;
  userDataDir: string;
  /** Resolves when the Electron process closes (registered before yielding to tests). */
  appClosed: Promise<void>;
}

/** Options accepted by {@link launchElectronWithExtension}. */
export interface LaunchElectronAppOptions {
  /**
   * Additional environment variables to merge into the child process environment, applied after the
   * defaults. Keys present here override the defaults (e.g. `{ DEV_NOISY: 'false' }`).
   */
  envOverrides?: Record<string, string>;
}

/**
 * Wait for the WebSocket server to be ready on the specified port.
 *
 * @param port Port number to connect to.
 * @param timeout Maximum time in milliseconds to wait before throwing.
 * @returns Resolves when a WebSocket connection to the port succeeds.
 * @throws {Error} If the WebSocket server is not ready within `timeout` milliseconds.
 */
async function waitForWebSocketReady(port: number, timeout: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('Connection timeout'));
        }, 2000);

        ws.on('open', () => {
          clearTimeout(timer);
          ws.close();
          resolve();
        });
        ws.on('error', (err) => {
          clearTimeout(timer);
          ws.close();
          reject(err);
        });
      });
      return;
    } catch {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });
    }
  }
  throw new Error(`WebSocket server not ready on port ${port} after ${timeout}ms`);
}

/**
 * Launch a fresh Electron instance (paranext-core) with the interlinearizer extension loaded via
 * `--extensions`.
 *
 * @param opts Optional launch options (e.g. environment variable overrides).
 * @returns The app handle, the isolated user-data directory path, and a promise that resolves when
 *   the app closes.
 * @throws If Electron fails to launch or the WebSocket server does not become ready.
 */
export async function launchElectronWithExtension(
  opts: LaunchElectronAppOptions = {},
): Promise<ElectronAppContext> {
  const coreDir = path.resolve(__dirname, '../../../paranext-core');
  const extensionDist = path.resolve(__dirname, '../../dist');

  // Resolve the Electron binary from paranext-core's node_modules — the electron package exports
  // the path to the platform binary as its default export.
  const coreRequire = createRequire(path.resolve(coreDir, 'package.json'));
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const electronExecutable = coreRequire('electron') as string;

  console.log(`Launching Platform.Bible from: ${coreDir}`);
  console.log(`Loading extension from: ${extensionDist}`);

  // VSCode/Claude Code set ELECTRON_RUN_AS_NODE=1 which forces the Electron binary to run as plain
  // Node.js. Omit it so the Electron child does not inherit it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ELECTRON_RUN_AS_NODE, ...restEnv } = process.env;
  const env = {
    ...restEnv,
    NODE_ENV: 'development',
    DEV_NOISY: process.env.DEV_NOISY ?? 'false',
    ...opts.envOverrides,
  };

  // Use an isolated user-data directory so the singleton instance lock does not
  // conflict with any already-running Platform.Bible instance.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paranext-e2e-'));

  let electronApp: ElectronApplication;
  try {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [`--user-data-dir=${userDataDir}`, coreDir, '--extensions', extensionDist],
      cwd: coreDir,
      env,
      timeout: PROCESS_READY_TIMEOUT,
    });
  } catch (error) {
    console.error('Failed to launch Electron:', error);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }

  console.log('Waiting for WebSocket server on port 8876...');
  try {
    await waitForWebSocketReady(DEFAULT_WEBSOCKET_PORT, PROCESS_READY_TIMEOUT);
  } catch (error) {
    console.error('WebSocket readiness check failed after Electron launch:', error);
    const proc = electronApp.process();
    if (proc?.pid) {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
  console.log('WebSocket server is ready');

  const appClosed = new Promise<void>((resolve) => {
    electronApp.once('close', () => {
      resolve();
    });
  });

  return { electronApp, userDataDir, appClosed };
}

/**
 * Tear down an Electron instance: kill the process group, wait for close, and clean up the isolated
 * user-data directory.
 *
 * @param ctx The app context returned by {@link launchElectronWithExtension}.
 * @returns Resolves when the Electron process has been killed and user-data cleaned up.
 */
export async function teardownElectronApp(ctx: ElectronAppContext): Promise<void> {
  const { electronApp, userDataDir, appClosed } = ctx;

  const electronProcess = electronApp.process();
  console.log(
    `[teardown] Closing Electron app... pid=${electronProcess?.pid} exitCode=${electronProcess?.exitCode} signalCode=${electronProcess?.signalCode}`,
  );

  /**
   * Send `sig` to the Electron process group, falling back to the process itself if group kill
   * fails.
   *
   * @param sig Signal to send (e.g. `'SIGKILL'`).
   */
  const killGroup = (sig: NodeJS.Signals) => {
    if (!electronProcess?.pid) return;
    try {
      process.kill(-electronProcess.pid, sig);
    } catch {
      try {
        electronProcess.kill(sig);
      } catch {
        /* already dead */
      }
    }
  };

  // Node.js ChildProcess.exitCode/signalCode are null until the process exits
  // eslint-disable-next-line no-null/no-null
  if (electronProcess && electronProcess.exitCode === null && electronProcess.signalCode === null) {
    console.log('[teardown] Sending SIGKILL to process group...');
    killGroup('SIGKILL');
    console.log('[teardown] Waiting for appClosed after SIGKILL (up to 3s)...');
    await Promise.race([
      appClosed,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 3_000);
      }),
    ]);
    console.log('[teardown] Done waiting after SIGKILL');
  }

  console.log('[teardown] Cleaning up user data dir...');
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    console.warn('[teardown] First rmSync attempt failed — retrying in 3s...');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 3_000);
    });
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[teardown] Could not remove ${userDataDir}: ${e}`);
    }
  }
  console.log('[teardown] Complete');
}

/**
 * One JSON-RPC 2.0 request over WebSocket: open, send, wait for response id `1`, close. Ignores
 * unrelated messages until the matching response arrives.
 *
 * @param method JSON-RPC method name to invoke.
 * @param timeoutErrorMessage Custom error message on timeout; defaults to a standard timeout
 *   message.
 * @param params Positional parameters to send with the request.
 * @param port WebSocket port to connect to.
 * @param perRequestTimeoutMs Milliseconds before the request times out.
 * @returns The `result` field of the JSON-RPC response, typed as `T`.
 * @throws {Error} If the request times out or the server returns a JSON-RPC error.
 */
async function sendPapiJsonRpcOnce<T>(
  method: string,
  timeoutErrorMessage?: string,
  params: unknown[] = [],
  port: number = DEFAULT_WEBSOCKET_PORT,
  perRequestTimeoutMs = 10_000,
): Promise<T> {
  const timeoutMessage =
    timeoutErrorMessage ?? `PAPI request "${method}" timed out after ${perRequestTimeoutMs}ms`;

  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(timeoutMessage));
    }, perRequestTimeoutMs);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
      );
    });

    ws.on('message', (data) => {
      let parsed: { id?: number; error?: unknown; result?: unknown };
      try {
        parsed = JSON.parse(data.toString());
      } catch (err) {
        clearTimeout(timeout);
        ws.close();
        reject(err);
        return;
      }
      if (parsed.id !== 1) return;
      clearTimeout(timeout);
      ws.close();
      if (parsed.error) {
        reject(new Error(`PAPI error: ${JSON.stringify(parsed.error)}`));
      } else {
        // eslint-disable-next-line no-type-assertion/no-type-assertion
        resolve(parsed.result as T);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Send a single JSON-RPC request where `method` is a PAPI request type (e.g. `rpc.discover`). Opens
 * a connection, sends one request, waits for the matching response id, then closes.
 *
 * @param method PAPI request type to invoke (e.g. `rpc.discover`).
 * @param params Positional parameters to send with the request.
 * @param port WebSocket port to connect to.
 * @param perRequestTimeoutMs Milliseconds before the request times out.
 * @returns The `result` field of the JSON-RPC response, typed as `T`.
 * @throws {Error} If the request times out or the server returns a JSON-RPC error.
 */
export async function sendPapiRequestOnce<T>(
  method: string,
  params: unknown[] = [],
  port: number = DEFAULT_WEBSOCKET_PORT,
  perRequestTimeoutMs = 10_000,
): Promise<T> {
  return sendPapiJsonRpcOnce<T>(method, undefined, params, port, perRequestTimeoutMs);
}

/**
 * Poll `rpc.discover` until `methodName` appears in `result.methods` or `timeoutMs` elapses.
 *
 * @param methodName The fully-qualified PAPI method name to wait for (e.g. `command:foo.bar`).
 * @param port WebSocket port to connect to.
 * @param timeoutMs Maximum time in milliseconds to poll before throwing.
 * @returns Resolves when the method appears in `rpc.discover`.
 * @throws {Error} If the method is not registered within `timeoutMs` milliseconds.
 */
export async function waitForPapiMethodRegistered(
  methodName: string,
  port: number = DEFAULT_WEBSOCKET_PORT,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - start);
    try {
      const result = await sendPapiRequestOnce<RpcDiscoverResult>(
        GET_METHODS,
        [],
        port,
        Math.min(10_000, Math.max(1000, remaining)),
      );
      if (result.methods?.some((m) => m.name === methodName)) return;
    } catch {
      /* next poll */
    }
    const sleepMs = Math.min(RPC_DISCOVER_POLL_INTERVAL_MS, timeoutMs - (Date.now() - start));
    if (sleepMs <= 0) break;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, sleepMs);
    });
  }
  throw new Error(`PAPI method "${methodName}" not listed in rpc.discover within ${timeoutMs}ms`);
}

/**
 * Wait for the Platform.Bible UI to be fully ready: dock layout appears and `platform.about`
 * command is registered (dialog service has finished initializing).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param timeout Maximum time in milliseconds to wait before throwing.
 * @returns Resolves when the dock layout is visible and `platform.about` is registered.
 * @throws If the dock layout or `platform.about` command does not appear within `timeout`
 *   milliseconds.
 */
export async function waitForAppReady(page: Page, timeout = 60_000): Promise<void> {
  const start = Date.now();
  await page.waitForSelector('div[class*="dock-layout"]', {
    state: 'attached',
    timeout,
  });
  const remaining = Math.max(0, timeout - (Date.now() - start));
  await waitForPapiMethodRegistered(PLATFORM_ABOUT_COMMAND, DEFAULT_WEBSOCKET_PORT, remaining);
}

/**
 * Wait for the interlinearizer extension to finish activating by polling `rpc.discover` until
 * `interlinearizer.openForWebView` is listed.
 *
 * @param timeoutMs Maximum time in milliseconds to poll before throwing.
 * @returns Resolves when `interlinearizer.openForWebView` is listed in `rpc.discover`.
 * @throws {Error} If the extension does not register within `timeoutMs` milliseconds.
 */
export async function waitForInterlinearizerReady(timeoutMs = 90_000): Promise<void> {
  await waitForPapiMethodRegistered(
    'command:interlinearizer.openForWebView',
    DEFAULT_WEBSOCKET_PORT,
    timeoutMs,
  );
}

/**
 * Open the Interlinearizer WebView from the Scripture Editor's top (≡) menu. Prerequisite stage
 * shared by all e2e tests that require the Interlinearizer to be open.
 *
 * The startup dock layout varies, so the editor is located resiliently rather than assumed:
 *
 * - A truly-fresh core profile opens the default multi-tab layout, which already includes a
 *   "Scripture Editor" tab (no project loaded).
 * - A profile whose layout collapsed to a single tab opens only the "Home" tab (no editor).
 * - A warm CDP instance already has the editor open on a project (tab titled e.g. "WEB (Editable)").
 *
 * Steps:
 *
 * 1. Wait for the layout to settle to a known state: either a Scripture Editor tab or the Home tab is
 *    present. (A bare `count()` races the async dock render — a fresh profile reports zero tabs for
 *    a beat before the layout mounts.)
 * 2. If no editor tab is present, open `projectName` from Home (Home tab → project row → "Open"),
 *    mirroring paranext-core's own `openFromEditorHamburger` helper.
 * 3. Focus the Scripture Editor tab. Its title (and its iframe's title) is the project short name with
 *    an editability suffix once a project is loaded (e.g. "WEB (Editable)"), and "Scripture Editor"
 *    only when no project is loaded — both are accepted.
 * 4. Enter the Scripture Editor iframe and click the ≡ ("Project") menu button.
 * 5. Click "Open Interlinearizer for this Project".
 * 6. If the "Open Interlinearizer" project-picker dialog appears (it only does when the editor has no
 *    project loaded), click the named project. When the editor already has a project, the command
 *    opens the Interlinearizer for it directly with no dialog.
 * 7. Wait for the "Interlinearizer" dock tab and click it to focus it.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param projectName Name of the project to open and select in the project-picker (default:
 *   `"WEB"`).
 * @returns Resolves when the Interlinearizer tab is focused and visible.
 * @throws If any step does not complete within its timeout.
 */
export async function openInterlinearizerFromScriptureEditor(
  page: Page,
  projectName = 'WEB',
): Promise<void> {
  // A Scripture Editor tab is titled by the project short name once a project is loaded (e.g.
  // "WEB (Editable)"), and "Scripture Editor" only when no project is loaded. Escape projectName so
  // a short name with regex metacharacters can't corrupt the pattern.
  const escapedProjectName = escapeStringRegexp(projectName);
  const editorTab = page
    .locator('.dock-tab', { hasText: new RegExp(`^(Scripture Editor|${escapedProjectName})\\b`) })
    .first();
  const homeTab = page.locator('.dock-tab', { hasText: 'Home' }).first();

  // Wait for the dock layout to actually mount before deciding which path to take — a fresh profile
  // briefly reports zero tabs, and a non-waiting `count()` would misread that as "no editor".
  // `.first()` on the whole `.or()`: when both the editor and Home tabs are present the union
  // resolves to two elements, which would trip strict mode on this visibility assertion.
  await expect(editorTab.or(homeTab).first()).toBeVisible({ timeout: 30_000 });

  // If the layout came up without a Scripture Editor (single-tab Home layout), open the project
  // from Home so the editor (and its ≡ menu) exists before we try to focus it.
  if ((await editorTab.count()) === 0) {
    await homeTab.click();
    const homeFrame = page.frameLocator('iframe[title="Home"]');
    await homeFrame.locator(`tr:has-text("${projectName}") button:has-text("Open")`).click();
  }

  await expect(editorTab).toBeVisible({ timeout: 15_000 });
  await editorTab.click();

  // The Scripture Editor renders its own toolbar inside its iframe. Click the ≡ ("Project") button.
  const editorFrame = page
    .locator(`iframe[title*="Scripture Editor" i], iframe[title^="${projectName}"]`)
    .first()
    .contentFrame();
  await editorFrame.locator("button[aria-label='Project']").first().click();

  // Click the "Open Interlinearizer for this Project" item contributed by this extension.
  await editorFrame
    .getByRole('menuitem', { name: /Open Interlinearizer for this Project/i })
    .first()
    .click();

  // When the editor has no project selected, the command calls papi.dialogs.selectProject, which
  // opens a floating "Open Interlinearizer" dock tab with the project list. When the editor
  // already has a project (a warm instance), the Interlinearizer tab opens directly instead.
  const selectProjectDialog = page.locator('.select-project-dialog');
  const interlinearizerTab = interlinearizerTabLocator(page);
  // `.first()` on the whole `.or()`: if the dialog and the tab are ever both present the union
  // resolves to two elements, which would trip strict mode on this visibility assertion.
  await expect(selectProjectDialog.or(interlinearizerTab).first()).toBeVisible({ timeout: 15_000 });
  if (await selectProjectDialog.isVisible()) {
    const projectNameRegex = new RegExp(`^${escapedProjectName}$`, 'i');
    await selectProjectDialog.getByRole('button', { name: projectNameRegex }).click();
  }

  // Wait for the Interlinearizer tab to appear and focus it.
  await expect(interlinearizerTab).toBeVisible({ timeout: 15_000 });
  await interlinearizerTab.click();
}

/**
 * Frame locator for the Interlinearizer WebView's iframe, where all of the extension's own UI
 * (toolbar, token strips, modals) renders.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns A `FrameLocator` scoped to the Interlinearizer WebView iframe.
 */
export function getInterlinearizerFrame(page: Page): FrameLocator {
  // Anchor on titles that START with "Interlinearizer" so this never matches the project-picker
  // dialog ("Open Interlinearizer"), whose title also contains the word. The real WebView title is
  // "Interlinearizer" (optionally suffixed with the unsaved-changes marker), so a prefix match keeps
  // the dirty-state title while excluding the "Open …" picker.
  return page.frameLocator('iframe[title^="Interlinearizer" i]');
}

/**
 * Locator for the Interlinearizer WebView's dock tab. Matches the tab whose title contains
 * "Interlinearizer" while excluding the project-picker dialog's own dock tab ("Open
 * Interlinearizer"), whose title also contains the word. Centralizes the exclusion so callers can't
 * forget it (the `getInterlinearizerFrame` iframe uses a prefix match for the same purpose).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns A `Locator` for the Interlinearizer WebView dock tab.
 */
function interlinearizerTabLocator(page: Page): Locator {
  return page
    .locator('.dock-tab', { hasText: 'Interlinearizer', hasNotText: 'Open Interlinearizer' })
    .first();
}

/**
 * Wait for Platform.Bible and the interlinearizer extension to finish starting up. Combines
 * {@link waitForAppReady} and {@link waitForInterlinearizerReady}.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when `interlinearizer.openForWebView` is listed in `rpc.discover`.
 * @throws If the app or extension do not finish starting up within their default timeouts.
 */
export async function waitForAppAndInterlinearizerReady(page: Page): Promise<void> {
  await waitForAppReady(page);
  await waitForInterlinearizerReady();
}

/**
 * Ensure the Interlinearizer is open and focused, reusing an existing tab when one is present.
 * Standard precondition for feature tests running against the shared CDP instance: an existing
 * Interlinearizer tab is trusted to be on the WEB project (the shared instance is only ever used
 * with WEB — see e2e-tests/README.md); otherwise the tab is opened fresh via the Scripture Editor
 * menu flow. Resolves only once the extension's toolbar has rendered inside the iframe.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the Interlinearizer tab is focused and its toolbar is interactive.
 * @throws If the Interlinearizer cannot be opened or its toolbar does not render within the
 *   timeouts.
 */
export async function ensureInterlinearizerOpenOnWeb(page: Page): Promise<void> {
  const interlinearizerTab = interlinearizerTabLocator(page);

  // Settle the dock layout before the non-retrying isVisible() branch below. The readiness helpers
  // only poll rpc.discover, not the DOM, so without this a not-yet-painted Interlinearizer tab (or
  // one just closed by a prior test) would read as "absent" and send us needlessly down the full
  // open-from-editor flow. Wait until either the Interlinearizer tab or some editor/Home anchor tab
  // is mounted, so isVisible() reflects a settled layout. When BOTH are present (the common case:
  // an Interlinearizer tab alongside the WEB/editor tab), the union resolves to two elements, so
  // `.first()` on the whole `.or()` keeps the visibility assertion out of strict-mode violation —
  // per-operand `.first()` does not collapse the union to a single match.
  const anchorTab = page.locator('.dock-tab', { hasText: /Scripture Editor|Home|WEB/ }).first();
  await expect(interlinearizerTab.or(anchorTab).first()).toBeVisible({ timeout: 30_000 });

  if (await interlinearizerTab.isVisible()) {
    await interlinearizerTab.click();
  } else {
    await openInterlinearizerFromScriptureEditor(page);
  }
  const frame = getInterlinearizerFrame(page);
  await expect(frame.locator("button[aria-label='Project']").first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Navigate the platform's book-chapter-verse control to the given scripture reference so tests can
 * assert against known text. Opens the toolbar's reference combobox, types the reference, and
 * submits it. Requires a fully-qualified reference (book, chapter, and verse — e.g. `"GEN 1:1"`);
 * partial references are ambiguous and are not auto-submitted by the control.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param reference Fully-qualified scripture reference to navigate to (e.g. `"GEN 1:1"`).
 * @returns Resolves when the reference popover has closed after submitting.
 * @throws If the reference control does not open, or the popover does not close after submitting.
 */
export async function navigateToScriptureRef(page: Page, reference: string): Promise<void> {
  const trigger = page.locator('button[aria-label="book-chapter-trigger"]').first();
  await trigger.click();
  const input = page.locator('input[cmdk-input]').first();
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(reference);
  await input.press('Enter');
  // The popover closes when the reference is accepted.
  await expect(input).not.toBeVisible({ timeout: 5_000 });
}

/**
 * Open the Interlinearizer's ≡ ("Project") top menu inside its iframe and wait for the dropdown to
 * appear.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns The frame locator for the Interlinearizer iframe, for chaining menu-item clicks.
 * @throws If the menu button or the opened menu does not become visible within the timeouts.
 */
export async function openInterlinearizerProjectMenu(page: Page): Promise<FrameLocator> {
  const frame = getInterlinearizerFrame(page);
  const projectMenuButton = frame.locator("button[aria-label='Project']").first();
  await expect(projectMenuButton).toBeVisible({ timeout: 15_000 });
  await projectMenuButton.click();
  await expect(frame.locator('[role="menu"]')).toBeVisible({ timeout: 5_000 });
  return frame;
}

/** Name of the dedicated interlinear project the mutating feature tests operate on. */
export const E2E_PROJECT_NAME = 'E2E Test Project';

/** Name prefix for projects created to rescue a developer's unsaved draft work. */
const RESCUE_PROJECT_PREFIX = 'e2e-rescued-work';

/**
 * Glyph the Interlinearizer appends to its dock tab title while the draft has unsaved changes. Only
 * the glyph must match production's UNSAVED_TAB_MARKER in src/components/InterlinearizerLoader.tsx
 * (which prefixes it with a space); this constant is used exclusively in substring checks, so the
 * surrounding whitespace is deliberately not replicated.
 */
const UNSAVED_TAB_MARKER = '●';

/**
 * Read whether the draft has unsaved changes from the Interlinearizer dock tab's title marker (the
 * only place the dirty state is observable outside the WebView).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns `true` when the tab title carries the unsaved-changes glyph.
 */
async function isDraftDirty(page: Page): Promise<boolean> {
  const tabText = await interlinearizerTabLocator(page).textContent();
  return (tabText ?? '').includes(UNSAVED_TAB_MARKER);
}

/**
 * Open the "Select Interlinear Project" modal from the Project menu and wait for its project list
 * to finish loading (the modal's buttons are disabled while the fetch is in flight).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns The frame locator for the Interlinearizer iframe, for chaining clicks in the modal.
 * @throws If the modal does not open or its list does not finish loading within the timeouts.
 */
async function openSelectProjectModal(page: Page): Promise<FrameLocator> {
  const frame = await openInterlinearizerProjectMenu(page);
  await frame
    .getByRole('menuitem', { name: /Select Interlinear Project/i })
    .first()
    .click();
  await expect(frame.locator('#select-project-modal-title')).toBeVisible({ timeout: 10_000 });
  await expect(frame.locator('dialog').getByRole('button', { name: 'Cancel' })).toBeEnabled({
    timeout: 10_000,
  });
  return frame;
}

/**
 * Preserve the current draft by saving it as a brand-new, timestamped rescue project (Project menu
 * → Save As… → "Save as New Project"). Used before the e2e project replaces a dirty draft that may
 * hold a developer's unsaved work, so nothing is silently discarded. Clears the draft's
 * unsaved-changes state as a side effect (the rescue project becomes the active Save target).
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the Save As modal has closed and the unsaved marker has cleared.
 * @throws If the Save As modal does not open, close, or clear the unsaved marker within the
 *   timeouts.
 */
async function rescueDraftToNewProject(page: Page): Promise<void> {
  const frame = await openInterlinearizerProjectMenu(page);
  await frame
    .getByRole('menuitem', { name: /^Save As/i })
    .first()
    .click();

  const saveAsTitle = frame.locator('#save-as-modal-title');
  await expect(saveAsTitle).toBeVisible({ timeout: 10_000 });
  await frame.locator('#save-as-name').fill(`${RESCUE_PROJECT_PREFIX}-${Date.now()}`);
  await frame.getByTestId('save-as-new').click();
  await expect(saveAsTitle).not.toBeVisible({ timeout: 10_000 });

  // The save clears the unsaved marker; wait for it so later dirty checks read the new state.
  await expect(interlinearizerTabLocator(page)).not.toContainText(UNSAVED_TAB_MARKER, {
    timeout: 10_000,
  });
}

/**
 * Make the dedicated e2e project ({@link E2E_PROJECT_NAME}) the active project, creating it if it
 * does not exist yet, so mutating tests never touch a developer's own projects. Opening a project
 * replaces the draft (the single per-source working buffer), so when the draft is dirty and the
 * active project is NOT the e2e project — i.e. the unsaved work may be a developer's, not leftover
 * test data — it is first rescued into a new `e2e-rescued-work-*` project instead of being
 * discarded. Dirty state left while the e2e project is active is treated as leftover test data and
 * discarded via the confirm dialog.
 *
 * Mutating tests call this at the START (with rescue on) to establish their precondition, and again
 * at the END (with rescue off) to discard their own leftovers so the next run starts clean.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @param opts Options object.
 * @param opts.rescueDirtyDraft Whether a dirty draft not owned by the e2e project is rescued before
 *   being replaced (default `true`). Pass `false` only at the end of a test, where the dirty state
 *   is known to be the test's own leftovers.
 * @returns Resolves when the e2e project is active and all modals have closed.
 * @throws If the modals do not open/close or the project cannot be selected or created within the
 *   timeouts.
 */
export async function ensureE2eProjectActive(
  page: Page,
  opts: { rescueDirtyDraft?: boolean } = {},
): Promise<void> {
  const { rescueDirtyDraft = true } = opts;

  let dirty = await isDraftDirty(page);
  let frame = await openSelectProjectModal(page);
  let dialog = frame.locator('dialog');

  // Locate the E2E entry by its project-name element with an EXACT text match, then walk up to the
  // enclosing entry button. Matching the whole button's accessible name doesn't work: the modal
  // renders the name, an optional "Active" badge, and the analysis languages as adjacent inline
  // <span>s with no separating whitespace, so the accessible name reads "E2E Test Projecten" —
  // there is no space after the name to anchor on. An exact-text match on the name element also
  // avoids matching a different project whose name merely starts with E2E_PROJECT_NAME (e.g. "E2E
  // Test Project 2"). Keep in sync with SelectInterlinearProjectModal's entry markup.
  const activeEntry = dialog.locator('button[aria-current="true"]');
  const activeIsE2e =
    (await activeEntry.count()) > 0 &&
    (await activeEntry.first().getByText(E2E_PROJECT_NAME, { exact: true }).count()) > 0;

  if (dirty && !activeIsE2e && rescueDirtyDraft) {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(frame.locator('#select-project-modal-title')).not.toBeVisible({ timeout: 5_000 });
    await rescueDraftToNewProject(page);
    dirty = false;
    frame = await openSelectProjectModal(page);
    dialog = frame.locator('dialog');
  }

  const selectTitle = frame.locator('#select-project-modal-title');
  // Rebuilt against the (possibly re-opened) dialog so it targets the current modal instance.
  const e2eEntry = dialog
    .locator('button', { has: frame.getByText(E2E_PROJECT_NAME, { exact: true }) })
    .first();
  if ((await e2eEntry.count()) > 0) {
    await e2eEntry.click();
    if (dirty) {
      // Replacing a dirty draft asks for confirmation; anything worth keeping was rescued above.
      const discardConfirm = frame.getByTestId('discard-draft-confirm');
      await expect(discardConfirm).toBeVisible({ timeout: 5_000 });
      await discardConfirm.click();
    }
  } else {
    await dialog.getByRole('button', { name: 'Create New' }).click();
    const createTitle = frame.locator('#create-project-modal-title');
    await expect(createTitle).toBeVisible({ timeout: 5_000 });
    await frame.locator('#project-name').fill(E2E_PROJECT_NAME);
    await frame.locator('dialog').getByRole('button', { name: 'Create' }).click();
    // Creating a draft over a dirty one defers behind the discard confirmation instead of closing
    // the create modal (handleCreateDraft in ProjectModals.tsx), so dismiss it when dirty.
    if (dirty) {
      const discardConfirm = frame.getByTestId('discard-draft-confirm');
      await expect(discardConfirm).toBeVisible({ timeout: 5_000 });
      await discardConfirm.click();
    }
    await expect(createTitle).not.toBeVisible({ timeout: 10_000 });
  }
  await expect(selectTitle).not.toBeVisible({ timeout: 10_000 });
}

/**
 * Wipe the entire draft's analysis via the visible UI (Project menu → Wipe… → "Entire draft" →
 * Wipe). Standard reset step for mutating feature tests on the shared CDP instance: run it at the
 * START of a test (never at the end) so a previously failed run self-heals instead of poisoning the
 * next one.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the wipe dialog has closed after confirming.
 * @throws If the wipe dialog does not open or does not close after confirming.
 */
export async function wipeDraft(page: Page): Promise<void> {
  const frame = await openInterlinearizerProjectMenu(page);
  await frame.getByRole('menuitem', { name: /Wipe/i }).first().click();

  const wipeDialogTitle = frame.locator('#wipe-modal-title');
  await expect(wipeDialogTitle).toBeVisible({ timeout: 5_000 });
  await frame.getByTestId('wipe-scope-all').check();
  await frame.getByTestId('wipe-confirm').click();
  await expect(wipeDialogTitle).not.toBeVisible({ timeout: 10_000 });
}

/**
 * Close the Interlinearizer dock tab via its close button and wait for it to disappear. Used by
 * tests that verify draft persistence across a close/reopen cycle.
 *
 * @param page The Playwright `Page` for the Platform.Bible renderer window.
 * @returns Resolves when the Interlinearizer tab is gone.
 * @throws If the tab is not visible, or the tab does not close within the timeout.
 */
export async function closeInterlinearizerTab(page: Page): Promise<void> {
  const interlinearizerTab = interlinearizerTabLocator(page);
  await expect(interlinearizerTab).toBeVisible({ timeout: 15_000 });
  // Dispatch the click rather than hover()+click(): the close button is only laid out on hover, and
  // on small CI viewports the tab can overflow the tab strip and sit outside the viewport, where a
  // real click (even with force) fails. dispatchEvent doesn't require the element to be in-viewport.
  // Mirrors paranext-core's own dock-tab close helpers.
  await interlinearizerTab.locator('.dock-tab-close-btn').dispatchEvent('click');
  await expect(interlinearizerTab).not.toBeVisible({ timeout: 10_000 });
}
