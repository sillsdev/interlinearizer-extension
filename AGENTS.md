# AGENTS.md

This file provides guidance to AI agents creating and editing code in this repository.

Agents **reviewing** code should also read [REVIEW.md](REVIEW.md), which documents existing conventions that commonly trigger false-positive findings.

## Commands

```bash
# Build
npm run build            # Build both main and web-view bundles
npm run build:main       # Build main extension only
npm run build:web-view   # Build React WebView only
npm run watch            # Continuous rebuild on changes
npm run build:c-sharp    # Publish the C# host for every platform (or name some: -- win-x64)

# Lint & Format
npm run lint             # Run ESLint + stylelint + tsc --noEmit + dependency scope
npm run lint-fix         # Auto-fix linting issues
npm run format           # Format with Prettier

# Test
npm test                 # Run full Jest suite
npm run test:coverage    # Run with coverage (100% threshold enforced)
npm test -- path/to/file.test.ts                 # Run a single test file
npm test -- --testNamePattern="pattern"          # Run tests matching name
npm run test:c-sharp                             # Check the C# host published for this machine starts

# Performance (results land in perf/results/)
npm run perf:capture     # Capture the WEB sample's USJ from a launched app into perf/.cache
npm run perf:datasets    # Generate the seeded dataset tiers (captures first if needed)
npm run perf:bench       # Time the data layer's pure functions in Node
npm run perf:app         # Production-build the extension and time it, WebView and extension host, in the app
npm run perf:summary     # Render the newest results as markdown tables
npm run perf:shape       # Compare analysis shape across tiers and stored projects
npm run perf:indexes     # Check derived indexes and lookups against the records, after random edits
```

Only a template merge moves the dependency baseline that `npm run lint:dependencies` checks against. Refresh it in that same commit with `npm run template:baseline`, which writes both the baseline (a copy of the template's `package.json`) and the `MERGED_TEMPLATE_COMMIT` id in [scripts/check-dependency-scope.cjs](scripts/check-dependency-scope.cjs). [README.md](README.md) has the full procedure.

## Architecture

This is a **Platform.Bible extension** for interlinear Bible text alignment. Platform.Bible (PAPI) is an Electron-based application; extensions run in a sandboxed context and communicate with the host via `papi.*` APIs.

### Extension entry point

[src/main.ts](src/main.ts) — called by Platform.Bible on activation. Exports two lifecycle functions:

- `activate(context)` — stores the `ExecutionToken`, registers the `interlinearizer.mainWebView` WebView provider, command handlers, network event emitters, project settings validators, and the `onDidOpenWebView` / `onDidUpdateWebView` / `onDidCloseWebView` subscriptions. All registrations are added to `context.registrations` so the platform disposes them on deactivation.
- `deactivate()` — clears `openWebViewsByProject`, closes every session, lets go of every book `bookService` keeps, and returns `true`.

`openWebViewsByProject` (`Map<string, string>`) tracks one open WebView ID per project to prevent duplicates; reopening an already-open project brings that tab to front via the `existingId` option.

### C# host

[c-sharp/InterlinearizerHost](c-sharp/InterlinearizerHost) is a .NET program the extension starts on activation ([csharpHost.ts](src/services/csharpHost.ts)) and stops on deactivation. It registers its commands on the PAPI network, so TypeScript calls them with `papi.commands.sendCommand` like any other. It exits once its connection to Platform.Bible closes. It targets .NET 10, which Harmony needs, and is published self-contained for each platform Platform.Bible ships for, since Platform.Bible's own runtime is private to its process. It talks to the network through its own small client, since core's is not packaged for extensions to use; that client offers the methods core's does, so services can move into core later. The build copies whatever `npm run build:c-sharp` has published; without it the extension logs that the host could not start and carries on.

### WebView UI

[src/interlinearizer.web-view.tsx](src/interlinearizer.web-view.tsx) — entry point rendered inside Platform.Bible's WebView iframe; delegates to [InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) when a `projectId` is present. `useWebViewScrollGroupScrRef` and `useWebViewState` are **props injected by the PAPI host** (not hook imports).

[InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) — real top of the React tree: owns modal state, persists the active interlinear project, fetches the tokenized book and its segment pages, and routes top-menu commands to the appropriate modal.

[Interlinearizer](src/components/Interlinearizer.tsx) — renders the interlinear view from the loaded book data.

The WebView is injected into the main bundle via Webpack's `?inline` query:

```ts
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
```

[src/webpack-env.d.ts](src/webpack-env.d.ts) declares the `*?inline`, `*?raw`, and `*.scss` module types that make these imports type-safe.

Two separate Webpack configs handle this: `webpack.config.web-view.ts` builds the React component into `temp-build/`, then `webpack.config.main.ts` copies it into `dist/` alongside contributions, public assets, and type declarations.

The WebView root component is assigned to `globalThis.webViewComponent` (not exported) — this is the PAPI WebView contract. Tests must `require()` the module and read `globalThis.webViewComponent` to get the component.

### Project modals

[src/components/modals/ProjectModals.tsx](src/components/modals/ProjectModals.tsx) — mount point for the project dialogs, switching on its `ModalState`. The dialogs it mounts call backend commands to list, create, update, and delete projects.

### Project storage

[src/services/projectStorage.ts](src/services/projectStorage.ts) — owns all `papi.storage` reads and writes for interlinearizer projects. Serialization queues prevent interleaved read-modify-write races. Tests must call `resetQueuesForTesting()` between tests because module state is not cleared by `resetMocks`.

Drafts are loaded and saved through [AnalysisRepository](src/types/analysis-repository.ts), the seam a later storage backend implements. [DraftRepository](src/services/draftRepository.ts) implements it over the draft envelope and its per-book shards, and rewrites only the books that changed. It imports nothing from PAPI and reaches storage only through a `KeyValueStorage`. That lets the perf harness run it in Node, straight over the storage files ([perf/storage.ts](perf/storage.ts)). [Pt9ImportRepository](src/services/pt9ImportRepository.ts) serves a Paratext 9 import through the same seam, read-only. Both answer the seam's lookups from an [AnalysisIndex](src/services/analysisIndex.ts) built from the records on first use. `DraftRepository` keeps it current through `apply`, which also finds from it the books a change set reaches, so an apply compares those, plus any whose stored shard it can't vouch for. `checkIndexes` compares it with one built afresh.

[The conformance suite](src/__tests__/analysis-repository-conformance.ts) defines the seam: every `AnalysisRepository` implementation must pass it, and [draftRepository.conformance.test.ts](src/__tests__/services/draftRepository.conformance.test.ts) runs it against `DraftRepository` and `Pt9ImportRepository`. A behavior every implementation owes goes in the suite; one particular to an implementation, such as which shards a save rewrites, goes in that implementation's own tests. A later backend runs the suite by passing `describeAnalysisRepositoryConformance` a factory that returns a fresh `ConformanceStore` for each test.

Saved projects are listed through [ProjectSummaries](src/services/projectSummaries.ts): one record holding every project's summary, rewritten on each project write so listing reads no analysis. Like `DraftRepository`, it is PAPI-free.

### Sessions

[AnalysisSessions](src/services/analysisSessions.ts) keeps the host's sessions, behind the `openSession`, `closeSession` and `setAnalysisLanguage` commands. A session is a handle on either one source project's draft, paired with the interlinear project it saves to, or a read-only Paratext 9 import. A source has at most one session: opening another closes it. Opening a session also starts a fresh whole-text read of its source, which lasts until the session closes. Each session runs its commands one at a time through `run`. A command that changes stored analysis goes through `runEdit` instead, which a read-only session refuses. An edit reaches the repository as a `ChangeSet` of whole-record puts and deletes, applied through the session's [EditHistory](src/services/editHistory.ts) so that undo can revert it; boundary changes ride in the change set's scope record. Re-anchor passes are the exception. As the read delivers each book, `reanchorBook` re-anchors the draft to it through `run`; `reanchorMissingBooks` does the same for each linked book the text lacks. Both skip a read-only session. A pass is no undo step and leaves the unsaved mark as it was; the history records it, so that an undo or redo re-anchors what it restores. The WebView doesn't use sessions yet.

Host commands live in [src/services/commands/](src/services/commands/), one module per family. A command stages its changes in a [ChangeBuffer](src/services/commands/changeBuffer.ts), whose reads answer as the repository will once those changes apply, and `AnalysisSessions.edit` applies what it staged as one undo step after the approval rule passes. Each command copies the reducer it replaces, step for step, and its parity tests run one input through both with [runParity](src/__tests__/services/commands/parity.ts). A boundary command replaces no reducer; it copies the WebView's boundary dispatch, phrase breaks included, and `runBoundaryParity` runs one edit through both. The session then re-anchors the book's analysis to the new segments in the same undo step, as the WebView's pass does after a boundary edit. A reducer or dispatch change in Phase 3 updates its command and parity tests in the same PR.

### Components

Prefer Platform.Bible's `platform-bible-react` components (`Button`, `Input`, `Textarea`, `Label`, `Switch`, `RadioGroup`, `Popover`, `Tooltip`, etc.) over hand-rolled raw HTML (`<button>`, `<input>`, `<textarea>`, `<label>`, custom dropdowns) wherever an equivalent exists — this keeps the UI visually and behaviorally consistent with the host app and gives us theming and accessibility for free. Reserve raw elements for cases where the platform component can't preserve behavior the extension depends on (e.g. `field-sizing: content` gloss inputs); when you do, add a comment explaining why. When a raw element is replaced by a platform component in tests, extend `__mocks__/platform-bible-react.tsx` to stub the newly-used component.

Size icons inside a `Button` with `size-*` (e.g. `tw:size-3`), never `h-*`/`w-*` — `buttonVariants` forces any child SVG lacking a `size-` class to `size-4`, silently overriding `h-*`/`w-*`.

Modals go through [ModalShell](src/components/modals/ModalShell.tsx) rather than building their own overlay — it supplies the platform `Dialog`, which brings a focus trap, scroll lock, focus restore, and Escape-to-dismiss. Whether a modal passes `onClose` is the single switch governing every dismissal route. Supplying it enables both Escape and outside-click. A modal that is mid-submission passes none, so neither route can abandon in-flight work. Withhold it only while dismissing would abandon real work; a read-only load has nothing to abandon, so its modal stays dismissable. Modals tag their title with a `data-testid` because end-to-end tests locate them that way; never give the title an `id` instead, since that displaces the one the platform `Dialog` generates and the dialog then logs that its title is missing. The platform `Dialog` and `Popover` both render `role="dialog"` — select a modal by `[data-slot="dialog-content"]` when the two must be told apart.

### Styling

All UI uses Tailwind CSS (via `src/tailwind.css`). Every Tailwind class is prefixed `tw:` to avoid collisions with Platform.Bible's own styles (configured in `tailwind.config.ts`). For modifier variants the prefix comes first: `tw:hover:px-3`, not `hover:tw-px-3`.

### Parser pipeline

Data flows from Platform.Bible's USJ (Unified Scripture JSON) format through two stages:

1. [src/parsers/papi/usjBookExtractor.ts](src/parsers/papi/usjBookExtractor.ts) — converts USJ to the internal `RawBook` type
2. [src/parsers/papi/bookTokenizer.ts](src/parsers/papi/bookTokenizer.ts) — segments and tokenizes the book into `Segment`/`Token` structures with character offsets

[src/converters/pt9/convertPt9Project.ts](src/converters/pt9/convertPt9Project.ts) — separately converts the parsed Paratext 9 interlinear payload, served by the platform's `platformScripture.Pt9Interlinear` projectInterface, into the alignment model. [src/parsers/pt9/lexemeKey.ts](src/parsers/pt9/lexemeKey.ts) parses PT9's composed lexeme id grammar; the underlying XML schema (which the platform reads) is documented in [pt9-xml.md](src/parsers/pt9/pt9-xml.md).

### Data model ([src/types/interlinearizer.d.ts](src/types/interlinearizer.d.ts))

The core types are:

- `InterlinearProject` — persisted envelope: project metadata, source and optional target project ids, and the `analysis: TextAnalysis`. Only this is serialized to storage; the `Book` hierarchy is rebuilt from USJ on each load.
- `ActiveProject` — runtime pairing of `project: InterlinearProject` with reconstructed `source` and optional `target` books.
- `Book → Segment → Token` — the text hierarchy. Section headings are segments too (`Segment.heading`), with no verse starts. As in Paratext, each heading is filed under the verse before it, or under verse 0 when it precedes a chapter's first verse. Headings never merge or split with verse text. A heading within a verse's text splits that verse, and the text resuming after it is a segment keyed and flagged like a split's later piece. Text ahead of the first chapter or verse is kept apart as `Book.frontMatter`, tokenized but never segmented or displayed.
- `TextAnalysis` — flat analysis layer keyed by id (does **not** mirror text hierarchy)
- `TokenAnalysis / MorphemeAnalysis` — parse and 1:1 glosses; multiple analyses per token are allowed, distinguished by `status`
- `AlignmentLink` — directional links between source and target endpoints
- `AlignmentEndpoint` — has either token-level or morpheme-level specificity

All character offsets (`charStart`, `charEnd`, `charIndex`) are zero-based UTF-16 code-unit indices — plain JavaScript string indices, not code points and not grapheme clusters — with end offsets exclusive.

Key invariants: `Segment.baselineText.slice(charStart, charEnd) === Token.surfaceText`; at most one linked analysis per token/segment may have `status: 'approved'`. Token and phrase payloads are shared by every occurrence analyzed identically, so a link is identified by its own `id`, never by its `analysisId`. Picking one of a token's or segment's links, or one of several identical payloads, goes through [pick-rules.ts](src/utils/pick-rules.ts), never list order. `MultiString` values are keyed by BCP 47 tags. `TokenSnapshot.surfaceText` detects drift when baseline text changes. Every project and draft record carries a `modelVersion`; every write stamps `CURRENT_MODEL_VERSION`, and a record stamped higher than that is refused (`assertSupportedModelVersion`) rather than read or overwritten.

### TypeScript path aliases

- `@main` → `src/main`
- `parsers/*` → `src/parsers/*`

## Edge cases

Weigh an edge case's cost before handling it. Each one handled is paid for across code, tests, and documentation, in maintenance and in the context every agent loads to work here. Handle it fully only when that cost buys something:

- **Danger**: what actually goes wrong if it's unhandled? Lost or corrupted data and silently wrong output justify the cost; an awkward result in a state no real workflow reaches does not.
- **Use**: does a real user or caller produce it, or only a contrived input?
- **Blocking**: does the task at hand need it handled to work, or can it wait for a follow-up issue?

When it isn't worth handling, throw a clear error naming the unsupported case. A throw costs a line, marks the boundary, and turns a silently wrong result into a visible one that can be addressed once it matters.

## Testing

Jest with ts-jest, jsdom environment. PAPI is fully mocked in `__mocks__/`. Coverage is enforced at 100% on all `src/**` files (branches, functions, lines, statements), aside for select explicit exclusions.

`resetMocks: true` is set globally — mock implementations are cleared before every test, so each test must set up its own mocks (typically in `beforeEach`). Never rely on implementation state leaking from a prior test.

`@papi/backend` and `@papi/frontend` mocks are mutually exclusive: backend tests use `papi-backend.ts`, WebView tests use `papi-frontend.ts` + `papi-frontend-react.ts`. Each mock file ends with `export {}` so TypeScript treats it as a module.

### Testing hooks

Test context hooks and dispatchers directly with `renderHook` + a `wrapper`, not a throwaway button-and-click component. See `renderStoreHook` in [AnalysisStore.test.tsx](src/__tests__/components/AnalysisStore.test.tsx) for the provider-wrapping pattern: return the hooks under test from the callback, drive dispatchers inside `act(...)`, and assert on state read off `result.current`. Reserve rendered components for behavior that genuinely needs the DOM — re-render / render-count assertions and mount/unmount lifecycle.

### Branches not worth testing

100% coverage is enforced, but coverage is a floor, not a goal — chasing it produces low-value tests that bloat the suite and slow it down. Do **not** write a dedicated test for a branch whose only purpose is to satisfy the coverage gate when the branch carries no real behavior. Such branches should instead be excluded from coverage (via `/* v8 ignore next */` with a one-line reason, or the explicit exclusions in the Jest config) rather than tested. Branches not worth a dedicated test:

- **Defensive/unreachable guards** — null/undefined checks for values that the type system or call sites already guarantee, `default` cases on exhaustive switches, and "this should never happen" throws.
- **Trivial pass-throughs** — branches that only forward arguments, return a constant, or pick between two equivalent literals with no logic.
- **Framework/wiring glue** — branches that exist only to satisfy a library's API shape (e.g., optional-prop fallbacks that mirror the library default).
- **Logging-only branches** — code paths that differ only in what they log.

This is purely about which branches may be explicitly ignored from coverage. It is **not** license to consolidate tests: where a branch does carry real behavior, still prefer a separate, dedicated test for each side of the condition.

### Mock internals

Mock files:

- **`__mocks__/fileMock.ts`** — Stub static asset imports.
- **`__mocks__/lucide-react.tsx`** — Stubs icon components used in modals.
- **`__mocks__/papi-backend.ts`** — Mocks with jest fns. Re-exports internal jest fns on the default export as `__mock*` properties (e.g., `papi.__mockRegisterCommand`) so tests can assert on them without re-importing. See file for full list.
- **`__mocks__/papi-core.ts`** — Empty module; exists only for module resolution since `@papi/core` is types-only at runtime.
- **`__mocks__/papi-frontend.ts`** — Stubs `logger` and the `papi` services WebView code calls. See file for full list.
- **`__mocks__/papi-frontend-react.ts`** — Stubs PAPI React hooks.
- **`__mocks__/platform-bible-react.tsx`** — Stubs components with appropriate `data-testid` attributes. See file for test IDs.
- **`__mocks__/platform-bible-utils.ts`** — Stubs util functions.
- **`__mocks__/platform-bible-react-experimental.ts`** and **`__mocks__/platform-bible-utils-experimental.ts`** — Stub the `/experimental` entry points of those packages.
- **`__mocks__/styleInlineMock.ts`** and **`__mocks__/styleMock.ts`** — Stub `.scss?inline` and `.scss`.
- **`__mocks__/web-view-inline.ts`** — Stubs `*.web-view?inline` imports as a null-returning React component.
- **`src/__tests__/test-helpers.ts`** and **`src/__tests__/components/test-helpers.tsx`** — Shared fixture builders and component-test scaffolding. Read these before hand-rolling a token, segment, book, or project literal.

### No type assertions

The ESLint rule `no-type-assertion/no-type-assertion` is enforced. **Never use `as` casts in tests.** Workarounds:

- Inject typed WebView state via function overloads in `useWebViewState` stubs (see `makeProps` in `interlinearizer.web-view.test.tsx`).
- Narrow mock call args with `typeof x === 'string'` instead of `as string`.

## Documentation

All comment and JSDoc rules for TypeScript live in [.claude/skills/comment-rules/SKILL.md](.claude/skills/comment-rules/SKILL.md). All agents must follow it when writing or editing comments.

## Spelling

Use American English throughout — in code, comments, JSDoc, and documentation:

- `center` not `centre`, `color` not `colour`, `behavior` not `behaviour`
- `canceled`/`canceling` not `cancelled`/`cancelling`, `leveled`/`leveling` not `levelled`/`levelling`
- `neighboring` not `neighbouring`, `favor` not `favour`, `signaled` not `signalled`

## UX decisions

When key UX decisions are being made, discuss with a developer whether something should be added to `user-questions.md` for review with people outside the development team.
