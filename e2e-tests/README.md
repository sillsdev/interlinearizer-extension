# e2e-tests

End-to-end tests for the interlinearizer extension using Playwright + Electron. The suite launches a real Platform.Bible instance with the extension loaded via `--extensions` and verifies the extension starts up correctly. Currently contains one smoke test confirming the extension activates and registers its PAPI command.

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
