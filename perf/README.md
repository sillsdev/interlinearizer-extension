# Performance harness

Measures the extension rather than tests it: the data layer in Node, and the extension running in the app.

## Commands

- `npm run perf:capture` captures the WEB sample's USJ into `perf/.cache`.
- `npm run perf:datasets` generates the seeded dataset tiers defined in `perf/dataset/tiers.ts`, capturing first when the cache holds no complete capture.
- `npm run perf:bench` times the data layer in Node: its pure functions, and an apply through the host's draft repository.
- `npm run perf:app` times the extension in the app.
- `npm run perf:summary` renders the newest results of each kind as markdown tables.
- `npm run perf:shape -- <dataset>...` compares the shape of analyses; see [Dataset shape](#dataset-shape).
- `npm run perf:indexes -- [tier]...` applies random edits and undoes to each tier in Node, then checks that the derived indexes match ones built afresh, that each stored shard matches the draft, and that lookups match a scan of the stored records. It exits nonzero on any difference.
- `npm run perf:pages -- [tier]...` seeds each tier with free translations of verses its books lack, then checks in Node that every session page and outline holds what the WebView's store holds for it. It runs random commands, undos and redos in a session, checking that each change's `onAnalysisChanged` names what its `ChangeSet` reached. A page client also follows those changes. Some of its refetches are sent before a change and absorbed after it. After each change, the client must hold what the session serves. It also times the first page a freshly opened draft serves, which builds the derived indexes. It exits nonzero on any difference.

`PERF_TIERS` (comma-separated tier names) and `PERF_RUNS` (10 by default) narrow a run. `PERF_SKIP_SESSION_READS=true` opens host-path sessions without their whole-text read, to isolate that read's cost; the result file records it. The `large` tier's draft exceeds one websocket message, so only the Node benchmarks can measure it.

Results land in `perf/results/` as JSON, each recording the machine, its load average, and both commits. Before committing one, suffix its name with the issue it was measured for and why, such as `-407-baseline`; `perf:summary` reads the time from the file, not its name.

## Dataset shape

`perf:shape` prints text-independent measures of an analysis's shape (payload sharing, senses per form, status mix, phrases), so a generated tier can be compared with a real project.

A dataset is a tier name, or a `draft:<sourceProjectId>` or `project:<id>` key in the development host's extension storage. `PERF_STORAGE_DIR` names another storage directory.

## Timing in the app

`perf:app` launches the app as the [CDP end-to-end tier](../e2e-tests/README.md) does, with two differences:

- Global setup builds the extension for production (`E2E_BUILD_SCRIPT=build:production`).
- The run gets empty extension storage, so listing projects reads only what the run seeds. Your own storage waits in `user-data.perf-backup` beside it and comes back on teardown.

The run writes each tier's draft and saved projects straight into the app's extension storage from Node. It goes through the extension's draft repository, so seeding needs no command that carries a whole draft. A dev core keeps running meanwhile, so the run seeds only once the view has closed and its last autosave has landed.

Quit Platform.Bible first. A perf run refuses to start while any instance holds its ports, since that app may own the storage a run sets aside.

The timings are `ilz:`-prefixed performance entries. The WebView records them only while the `interlinearizer.perfMarks` localStorage key is `true`, and the extension host only after the `interlinearizer.setPerfMarks` command turns them on; the spec does both. `interlinearizer.readPerf` takes the host's entries, with its process id.

Each scenario that calls the host reports how long the WebView waited for that call, the host's share of that wait, and transport as the rest. The host's share is split into its steps, such as storage read and write, parse, USJ fetch, tokenize and reply serialize.

Both heaps are read after a forced garbage collection over the DevTools protocol:

- The WebView's through the app's remote debugging port.
- The host's through the Node inspector the run opens in the host process. It listens on port 9229 until the app quits, so that port must be free. A run that cannot open it records no host heap, and the summary says why.

## Baseline numbers

A dev core serves the WebView development React, so baseline numbers need a packaged core: `npm run package` in paranext-core, or on Linux `npx electron-builder build --publish never --linux dir` after its build steps, which skips the snap.

Set `PERF_APP_PATH` to the packaged executable (`release/build/linux-unpacked/platform-bible` on Linux) and every perf command launches that app instead:

- Setup builds the extension for production.
- The app runs with its home folder (`HOME`, and `USERPROFILE` on Windows) set to `perf/.cache/app-home`, so it installs WEB into its own profile and never touches yours.
- Teardown asks it to quit.
- Each tier is seeded while the app is stopped, inside the restart before its first open.
- `perf:app` also times the first open after each app start, restarting the app before each run. A dev core gets the warm scenarios only.

On Linux the app runs on X11 unless `PERF_OZONE_PLATFORM` names another backend, such as `wayland` when Xwayland is unavailable; results record it.

Run on an idle machine, and keep comparing on that same machine.
