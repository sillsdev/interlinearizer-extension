# e2e-tests

End-to-end tests for the interlinearizer extension using Playwright + Electron. The suite has two tiers:

- **Smoke tests** (`tests/smoke/`, `app.fixture`) launch a fresh Platform.Bible instance with the extension loaded via `--extensions` and verify the extension starts up correctly.
- **Feature tests** (`tests/features/`, `cdp.fixture`) connect over CDP to a running Platform.Bible instance and exercise interlinearizer UI flows (glossing, draft persistence, project modals).

Run everything with `npm run test:e2e` (smoke tier then CDP tier). Each tier can be run alone with `npm run test:e2e:smoke` and `npm run test:e2e:cdp`.

Both tiers are self-launching: the CDP tier's `globalSetup` launches its own Platform.Bible instance (with `--remote-debugging-port=9223`) in an isolated user-data dir and tears it down afterward, so `npm run test:e2e:cdp` needs no manual `npm run start:cdp` first. To iterate against a warm instance instead, run `npm run start:cdp` in one terminal, then run the CDP config directly with `npx playwright test --config e2e-tests/playwright-cdp.config.ts`: the setup detects the in-use CDP port, reuses that instance, and leaves it running.

In CI (`.github/workflows/test.yml`, `e2e` job) the full suite runs on both Linux and Windows. Each tier writes its Playwright HTML report to its own subfolder (`playwright-report/smoke`, `playwright-report/cdp`) so a combined run keeps both.

**Contents:**

- `*.json` — lint configs identical to those in `paranext-core/e2e-tests/`
- `global-*.ts` — start/stop the paranext-core renderer dev server around the test run
- `fixtures/` — test fixtures and helpers
- `playwright*.config.ts` — fixture configs
- `tests/` — tests, including a smoke test and a test template

## Key differences from `paranext-core/e2e-tests/`

These tests are adapted from `paranext-core`'s e2e suite with changes to support testing a side-loaded extension rather than the core platform itself:

- **Extension launch helper** — `fixtures/helpers.ts` uses `launchElectronWithExtension()` instead of `launchElectronApp()`. It passes `--extensions <dist>` to the Electron process, resolves the Electron binary from paranext-core's `node_modules`, and polls `rpc.discover` for the extension's PAPI method to confirm activation.
- **Window finding** — `fixtures/app.fixture.ts` manually polls `electronApp.windows()` by URL instead of calling `electronApp.firstWindow()`, because the extension injects content into an existing window rather than being the sole owner of the renderer.
- **Renderer readiness** — `global-setup.ts` adds an HTTP GET probe after the TCP port check to wait for webpack compilation to finish, rather than assuming the port being open means the bundle is ready.

## Writing feature tests

Feature tests run with `npm run test:e2e:cdp`. That command launches a fresh, isolated instance, but the tests are also run against a shared, long-lived `npm run start:cdp` instance during local iteration (see above), so they must assume nothing about the instance's state and must leave nothing behind that could poison the next run. The protocol:

- **Import from `cdp.fixture`, never `app.fixture`.** The CDP config already serializes execution (`workers: 1`), so tests never race each other on the shared instance.
- **The instance is only ever used with the WEB project.** This is an operating assumption, not something tests verify: `ensureInterlinearizerOpenOnWeb()` trusts an existing Interlinearizer tab and only picks WEB when opening fresh. Don't point `start:cdp` at other projects.
- **Mutating tests operate on the dedicated "E2E Test Project", never on a developer's own projects.** `ensureE2eProjectActive()` opens it (creating it on first use) at the start of each mutating test. Because the draft is the single per-source working buffer, replacing it could destroy unsaved developer work — so when the draft is dirty and the active project is _not_ the e2e project, the helper first saves the draft into a new `e2e-rescued-work-<timestamp>` project. Rescue projects are backups, not junk: delete them manually once recovered. Dirty state left while the e2e project is active is treated as leftover test data and discarded.
- **Self-establish every precondition.** Each mutating test starts with `ensureInterlinearizerOpenOnWeb()` → `ensureE2eProjectActive()` → `navigateToScriptureRef()` (the scroll-group reference could be anywhere) → `wipeDraft()`.
- **Reset at the start, tidy at the end.** The start-of-test sequence is what guarantees correctness — it self-heals whatever a failed run left behind. Mutating tests additionally end with `ensureE2eProjectActive(page, { rescueDirtyDraft: false })` to discard their own leftovers; this is a courtesy so the next run doesn't misread test junk as rescuable developer work, not something correctness depends on.
- **Use unique per-run values** (e.g. `` `e2e-gloss-${Date.now()}` ``) for anything written into the draft, so a stale leftover can never satisfy an assertion.
- **Drive only the visible UI.** No JSON-RPC/WebSocket calls to set up or assert state (the rpc.discover readiness polls in the shared helpers are the one sanctioned exception).
- **Prefer existing accessible selectors** (roles, aria-labels like `Gloss for {word}`, ModalShell title ids) over adding new `data-testid`s to production code.
- **Mutating tests must not overwrite or delete projects, and must not create any beyond what `ensureE2eProjectActive()` creates** (the e2e project itself, plus rescue projects). The current modal coverage is a read-only cancel tour; a create/delete lifecycle test needs its own self-healing cleanup (e.g. deleting leftover `e2e-*` projects at start) before it's safe on a shared instance.
