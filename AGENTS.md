# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Commands

```bash
# Build
npm run build            # Build both main and web-view bundles
npm run build:main       # Build main extension only
npm run build:web-view   # Build React WebView only
npm run watch            # Continuous rebuild on changes

# Lint & Format
npm run lint             # Run ESLint + stylelint + tsc --noEmit
npm run lint-fix         # Auto-fix linting issues
npm run format           # Format with Prettier

# Test
npm test                 # Run full Jest suite
npm run test:coverage    # Run with coverage (100% threshold enforced)
npm test -- path/to/file.test.ts                 # Run a single test file
npm test -- --testNamePattern="pattern"          # Run tests matching name
```

## Architecture

This is a **Platform.Bible extension** for interlinear Bible text alignment. Platform.Bible (PAPI) is an Electron-based application; extensions run in a sandboxed context and communicate with the host via `papi.*` APIs.

### Extension entry point

[src/main.ts](src/main.ts) — called by Platform.Bible on activation. Exports two lifecycle functions:

- `activate(context)` — stores the `ExecutionToken`, registers the `interlinearizer.mainWebView` WebView provider, the command handlers below, the `interlinearizer.continuousScroll` project settings validator, and the `onDidOpenWebView` / `onDidCloseWebView` subscriptions. All registrations are added to `context.registrations` so the platform disposes them on deactivation.
- `deactivate()` — clears `openWebViewsByProject` and returns `true`.

`openWebViewsByProject` (`Map<string, string>`) tracks one open WebView ID per project to prevent duplicates; reopening an already-open project brings that tab to front via the `existingId` option.

Registered commands:

- `interlinearizer.openForWebView` — opens the Interlinearizer for the WebView's project (or a picker if no ID is given).
- `interlinearizer.createProject` — backend handler that delegates to [projectStorage.createProject](src/services/projectStorage.ts); returns a JSON-serialized `InterlinearProject` or `undefined` on failure.
- `interlinearizer.getProjectsForSource` — returns a JSON-stringified `InterlinearProject[]` filtered by source project.
- `interlinearizer.updateProjectMetadata` — updates name/description/analysisLanguages/targetProjectId for a project.
- `interlinearizer.deleteProject` — deletes a project; no-ops silently when the ID is unknown.
- `interlinearizer.openSelectProjectModal`, `interlinearizer.openNewProjectModal`, `interlinearizer.openProjectInfoModal` — registered server-side as no-op handlers so the platform menu system knows about them; the actual behavior lives in the WebView, which listens for the matching menu-item activation.

### WebView UI

[src/interlinearizer.web-view.tsx](src/interlinearizer.web-view.tsx) is the entry point that the PAPI host renders inside its WebView iframe. It just delegates to [InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) when a `projectId` is present. `useWebViewScrollGroupScrRef` and `useWebViewState` are **props injected by the PAPI host** (not hook imports).

[InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) is the real top of the React tree: it owns modal state, persists the active interlinear project via `useWebViewState`, fetches and tokenizes book data, renders the `TabToolbar` + `ScriptureNavControls` + `ContinuousScrollToggle`, and routes top-menu commands (`openSelectProjectModal` / `openNewProjectModal` / `openProjectInfoModal`) to the appropriate modal. The "View Project Info" item is filtered out of the menu when no project is active.

[Interlinearizer](src/components/Interlinearizer.tsx) renders the actual interlinear view: an optional `ContinuousView` strip above a list of `SegmentView`s for the current chapter.

The WebView is injected into the main bundle via Webpack's `?inline` query:

```ts
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
```

[src/webpack-env.d.ts](src/webpack-env.d.ts) declares the `*?inline`, `*?raw`, and `*.scss` module types that make these imports type-safe.

Two separate Webpack configs handle this: `webpack.config.web-view.ts` builds the React component into `temp-build/`, then `webpack.config.main.ts` copies it into `dist/` alongside contributions, public assets, and type declarations.

The WebView root component is assigned to `globalThis.webViewComponent` (not exported) — this is the PAPI WebView contract. Tests must `require()` the module and read `globalThis.webViewComponent` to get the component.

### Project modals

[src/components/ProjectModals.tsx](src/components/ProjectModals.tsx) is the single mount point for all project-related dialogs; it switches between `'select' | 'create' | 'metadata' | 'none'` based on a `modal` prop owned by `InterlinearizerLoader`:

- [SelectInterlinearProjectModal](src/components/SelectInterlinearProjectModal.tsx) — lists existing projects for the source via `interlinearizer.getProjectsForSource`, with an info icon that opens the metadata modal.
- [CreateProjectModal](src/components/CreateProjectModal.tsx) — collects name, description, and analysis-language tags, then calls `interlinearizer.createProject`.
- [ProjectMetadataModal](src/components/ProjectMetadataModal.tsx) — edits / deletes an existing project via `interlinearizer.updateProjectMetadata` and `interlinearizer.deleteProject`.

The active project is persisted in WebView state under the `activeProject` key so it survives tab restores. The `isInterlinearProjectSummary` type guard in `SelectInterlinearProjectModal.tsx` validates JSON parsed from backend commands without `as` casts.

### Project storage

[src/services/projectStorage.ts](src/services/projectStorage.ts) owns all `papi.storage` reads and writes for interlinearizer projects:

- Projects are persisted under the `project:{uuid}` key; the ordered list of all UUIDs lives at `projectIds`.
- Two serialization queues prevent interleaved read-modify-write races: `indexQueue` guards the `projectIds` index and a per-project `projectQueues` map guards each project's record. `createProject` rolls the project write back when the index update fails.
- ENOENT (`isNotFound`) is treated as "key has never been written" rather than an error — used for both project reads and the initial-empty-index case.
- Tests must call `resetQueuesForTesting()` between tests because module state is not cleared by `resetMocks`.

### Styling

All UI uses Tailwind CSS (via `src/tailwind.css`). Every Tailwind class is prefixed `tw:` to avoid collisions with Platform.Bible's own styles (configured in `tailwind.config.ts`). For modifier variants the prefix comes first: `tw:hover:px-3`, not `hover:tw-px-3`.

### Hooks

[src/hooks/useInterlinearizerBookData.ts](src/hooks/useInterlinearizerBookData.ts) — orchestrates the per-project book pipeline. Reads USJ via `useProjectData('platformScripture.USJ_Book', projectId)` and the writing system via `useProjectSetting('platform.languageTag', ...)`, runs them through `extractBookFromUsj` and `tokenizeBook`, and returns `{ book, chapterSegments, isLoading, bookError, tokenizeError }`. The hook only depends on `scrRef.book` (not chapter/verse) for loading; chapter scoping happens during filtering.

[src/hooks/useOptimisticBooleanSetting.ts](src/hooks/useOptimisticBooleanSetting.ts) — wraps `useProjectSetting` with optimistic UI: a toggle update is shown immediately, the platform's confirmation is ignored for `TIMEOUT_MS` (15s) so the toggle does not visibly bounce, and if the platform never confirms the optimistic value persists rather than reverting.

### Parser pipeline

Data flows from Platform.Bible's USJ (Unified Scripture JSON) format through two stages:

1. [src/parsers/papi/usjBookExtractor.ts](src/parsers/papi/usjBookExtractor.ts) — walks USJ nodes (book / chapter / verse / para / note) into a `RawBook` (`bookCode`, `writingSystem`, `contentHash`, `verses`). Heading-class `para` markers are dropped so their text never bleeds into the verse baseline; `note` content is also skipped. The `contentHash` is an FNV-1a 32-bit hash of a stably-stringified `usj.content`, used as `Book.textVersion` to detect baseline drift.
2. [src/parsers/papi/bookTokenizer.ts](src/parsers/papi/bookTokenizer.ts) — segments and tokenizes the book into `Segment`/`Token` structures. The tokenizer regex uses Unicode property classes (`\p{L}\p{N}\p{M}\p{Join_Control}`), absorbs apostrophes/right-single-quotes at word edges (for languages where they mark phonemic glottal stops), and treats `'`, `-`, Unicode dashes, and `’` as word-internal joiners only when surrounded by word characters. Whitespace is not tokenized; the invariant `Segment.baselineText.slice(charStart, charEnd) === Token.surfaceText` is preserved.

[src/parsers/pt9/interlinearXmlParser.ts](src/parsers/pt9/interlinearXmlParser.ts) — separately parses Paratext 9 interlinear XML via `fast-xml-parser`. Strict mode for clusters (required `Range` with non-negative integer `Index`/`Length`; lexemes require `Id`), lenient for punctuation (entries with missing/invalid `Range` are silently filtered). The XML schema is documented in [pt9-xml.md](src/parsers/pt9/pt9-xml.md). The exported `InterlinearXmlParser` class holds one configured `XMLParser` — reuse a single instance across `parse()` calls.

### Data model ([src/types/interlinearizer.d.ts](src/types/interlinearizer.d.ts))

The file declares two ambient modules:

- `papi-shared-types` — augments `ProjectSettingTypes` (`interlinearizer.continuousScroll: boolean`) and `CommandHandlers` (the seven interlinearizer commands described above) so Platform.Bible's typed APIs know about them.
- `interlinearizer` — the project's domain types.

The core domain types are:

- `InterlinearProject` — persisted envelope: id, createdAt, optional name/description, `sourceProjectId`, optional `targetProjectId`, `analysisLanguages`, `analysis: TextAnalysis`, and `links?: AlignmentLink[]`. Only this is serialized to storage; the `Book` hierarchy is rebuilt from USJ on each load.
- `ActiveProject` — runtime pairing of `project: InterlinearProject` with reconstructed `source: Book[]` and optional `target: Book[]`.
- `Book → Segment → Token` — the text hierarchy.
- `TextAnalysis` — flat analysis layer keyed by id (does **not** mirror the text hierarchy). Holds `segmentAnalyses`, `tokenAnalyses`, `phraseAnalyses`, plus a `*Links` array for each that attaches an analysis record to one or more text-layer targets.
- `TokenAnalysis / MorphemeAnalysis` — parse and 1:1 glosses; multiple analyses per token are allowed, distinguished by `status`.
- `AlignmentLink` — directional links between source and target endpoints.
- `AlignmentEndpoint` — has either token-level or morpheme-level specificity via the optional `morphemeLink` field (when present, both `tokenAnalysisId` and `morphemeId` are required).
- `EntryRef` / `SenseRef` / `AllomorphRef` / `GrammarRef` — references to the Lexicon extension. The file documents current gaps in `IEntryService` that the Lexicon extension is expected to close.

Key invariants:

- `Segment.baselineText.slice(charStart, charEnd) === Token.surfaceText`.
- At most one linked `TokenAnalysisLink` per token may have `status: 'approved'`; same for `SegmentAnalysisLink` per segment and for `PhraseAnalysisLink` per token covered.
- `MultiString` values are keyed by BCP 47 tags.
- `TokenSnapshot.surfaceText` is the drift-detection mechanism: when it no longer matches the current `Token.surfaceText`, consumers flip the link's `status` to `'stale'`.

### TypeScript path aliases

- `@main` → `src/main`
- `parsers/*` → `src/parsers/*`

## Testing

Jest with ts-jest, jsdom environment. PAPI is fully mocked in `__mocks__/`. Coverage is enforced at 100% on all `src/**` files (branches, functions, lines, statements).

`resetMocks: true` is set globally — mock implementations are cleared before every test, so each test must set up its own mocks (typically in `beforeEach`). Never rely on implementation state leaking from a prior test.

`@papi/backend` and `@papi/frontend` mocks are mutually exclusive: backend tests use `papi-backend.ts`, WebView tests use `papi-frontend.ts` + `papi-frontend-react.ts`. Each mock file ends with `export {}` so TypeScript treats it as a module.

### Mock internals

Key semantic properties of the mock setup:

- **`resetMocks: true`** — Mock implementations are cleared before every test. Each test must set up its own mocks (typically in `beforeEach`); never rely on state leaking from a prior test.
- **Backend vs. frontend exclusivity** — Backend tests use `papi-backend.ts`, WebView tests use `papi-frontend.ts` + `papi-frontend-react.ts`. Each mock file ends with `export {}` to be treated as a module.
- **`globalThis.webViewComponent` contract** — The WebView root component is assigned to the global (not exported). Tests must `require()` the module and read `globalThis.webViewComponent` to get the component.

Mock files:

- **`__mocks__/fileMock.ts`** — Stub static asset imports.
- **`__mocks__/lucide-react.tsx`** — Stubs the icon components used in modals (`Info`, `Trash2`).
- **`__mocks__/papi-backend.ts`** — Mocks with jest fns including `commands`, `dialogs`, `notifications`, `storage`, `webViewProviders`, and `webViews`. Re-exports internal jest fns on the default export as `__mock*` properties (e.g., `papi.__mockRegisterCommand`, `papi.__mockReadUserData`) so tests can assert on them without re-importing. See file for the full list.
- **`__mocks__/papi-core.ts`** — Empty module; exists only for module resolution since `@papi/core` is types-only at runtime.
- **`__mocks__/papi-frontend.ts`** — Stubs `logger` (debug/error/info/warn as jest fns) and `papi.commands.sendCommand` / `papi.notifications.send`.
- **`__mocks__/papi-frontend-react.ts`** — Stubs PAPI React hooks (`useData`, `useProjectData`, `useProjectSetting`, `useLocalizedStrings`, `useRecentScriptureRefs`).
- **`__mocks__/platform-bible-react.tsx`** — Stubs components (`TabToolbar`, `BookChapterControl`, `ScrollGroupSelector`, `Button`, `Switch`, `Label`) with appropriate `data-testid` attributes. See file for test IDs.
- **`__mocks__/platform-bible-utils.ts`** — Stubs util functions including `isPlatformError`.
- **`__mocks__/styleInlineMock.ts`** and **`__mocks__/styleMock.ts`** — Stub `.scss?inline` and `.scss`.
- **`__mocks__/web-view-inline.ts`** — Stubs `*.web-view?inline` imports as a null-returning React component.
- **`src/__tests__/test-helpers.ts`** — Exports `createTestActivationContext()` for testing `activate()` without type assertions.

### No type assertions

The ESLint rule `no-type-assertion/no-type-assertion` is enforced. **Never use `as` casts in tests.** Workarounds:

- Inject typed WebView state via function overloads in `useWebViewState` stubs (see `makeProps` in `interlinearizer.web-view.test.tsx`).
- Narrow mock call args with `typeof x === 'string'` instead of `as string`.

## Documentation

Every function and method — exported or internal — must have a JSDoc block with:

- A summary sentence describing what the function does and why it exists (non-obvious behavior only; don't restate the name).
- `@param` for every parameter.
- `@returns` describing the return value (omit only for `void`/`Promise<void>`).
- `@throws` for every error condition the caller must handle; omit if the function never throws.

Type declarations (interfaces, type aliases, enums) must have a JSDoc summary on the type itself and on each field or member whose purpose is not self-evident from its name and type.
