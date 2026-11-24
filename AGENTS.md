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
npm run lint             # Run ESLint + stylelint + tsc --noEmit + dependency scope + dotnet format check
npm run lint-fix         # Auto-fix linting issues, C# formatting included
npm run format           # Format with Prettier
npm run format:dotnet    # Format the C# projects with dotnet format
npm run generate:case-folding   # Regenerate the surface-form fold table, which TS and C# share, from Unicode's CaseFolding.txt

# Test
npm test                 # Run full Jest suite
npm run test:coverage    # Run with coverage (100% threshold enforced)
npm test -- path/to/file.test.ts                 # Run a single test file
npm test -- --testNamePattern="pattern"          # Run tests matching name
npm run test:c-sharp                             # Check the C# host published for this machine starts
npm run test:c-sharp:conformance                 # Run the AnalysisRepository conformance suite against the published host
npm run test:dotnet                              # Run the Harmony entity tests (TUnit; filters go after --)
cd c-sharp && dotnet ef migrations add <Name> --project InterlinearizerCrdt   # After changing an entity's columns; see Migrations below

# Performance (results land in perf/results/)
npm run perf:capture     # Capture the WEB sample's USJ from a launched app into perf/.cache
npm run perf:datasets    # Generate the seeded dataset tiers (captures first if needed)
npm run perf:bench       # Time the data layer in Node, host applies included
npm run perf:app         # Production-build the extension and time it, WebView and extension host, in the app
npm run perf:summary     # Render the newest results as markdown tables
npm run perf:shape       # Compare analysis shape across tiers and stored projects
npm run perf:indexes     # Check derived indexes and lookups against the records, after random edits
npm run perf:queries     # Time the queries a view sends a session, in Node
npm run perf:pages       # Check session pages, outlines and change events against what the selectors derive from the whole analysis
npm run perf:reports     # Measure the change reports of re-anchor passes
npm run perf:first-open  # Time a book's first open in a session, with and without a stored anchor stamp, in Node
```

A template merge refreshes the dependency baseline in the same commit with `npm run template:baseline`; [README.md](README.md#to-update-this-extension-from-the-template) has the procedure.

## Architecture

This is a **Platform.Bible extension** for interlinear Bible text alignment. Platform.Bible (PAPI) is an Electron-based application; extensions run in a sandboxed context and communicate with the host via `papi.*` APIs.

What belongs in this section:

- What each component is for, and why it exists or is shaped that way.
- How it works, only where the design is load-bearing and easy to break without knowing it: performance, data integrity, or a contract across languages or processes. Name the risk it guards against.

Everything else lives in the code's doc comments and tests. A feature rarely needs a line here.

### Extension entry point

[src/main.ts](src/main.ts) is called by Platform.Bible on activation. `activate(context)` starts the C# host and registers the WebView provider, commands, network events, project settings validators, and WebView lifecycle subscriptions. All go in `context.registrations`, so the platform disposes them on deactivation. Each command's handler and its method docs ([commandDocs.ts](src/commandDocs.ts)) are keyed by command name, so a command missing either fails to compile. It keeps one WebView per project, so reopening a project brings its tab to the front.

### C# host

[c-sharp/InterlinearizerHost](c-sharp/InterlinearizerHost) is a .NET program the extension starts on activation ([csharpHost.ts](src/services/csharpHost.ts)) and stops on deactivation. It stores analysis with Harmony, a CRDT library. Nothing in the extension stores analysis through it yet: drafts live in `papi.storage` through `DraftRepository` (see **Project storage**), and only the conformance suite exercises the host's repository. It registers its commands on the PAPI network, so TypeScript calls them with `papi.commands.sendCommand` like any other.

- **Runtime**: .NET 10, which Harmony needs, published self-contained per platform because Platform.Bible's own runtime is private to its process. Without `npm run build:c-sharp`, the extension logs that the host could not start and carries on.
- **Network client**: its own small client, because core's is not packaged for extensions. It mirrors core's methods so services can move into core later.
- **One scope per source**: `OpenSources` keeps one DI scope per source project, over that source's own SQLite database.
  - The database file is named after the source id. So the host accepts only ASCII letters, digits, `_`, and `-` (one filename on every platform), and upper-cases the id (Platform.Bible compares ids ignoring case). Loosening either would let one source open two databases.
  - Commands on one source share its scope's `InterlinearizerCrdtDbContext`, and EF Core does not allow overlapping operations on one context. So the host runs each command on a source, `closeSource` included, under that source's lock in `OpenSources.Exclusive`, and callers may overlap them.
- **Repository commands**: [RepositoryService.cs](c-sharp/InterlinearizerHost/Services/RepositoryService.cs) serves the C# `AnalysisRepository` as one `interlinearizer.repository.<method>` command per method, beside the project commands. [CSharpRepository](src/services/csharpRepository.ts) is the TypeScript side. The two share a wire format, so a change to a record type or a repository method lands on both sides.
- **Conformance**: `npm run test:c-sharp:conformance` runs the [conformance suite](src/__tests__/analysis-repository-conformance.ts) against the published host through a stand-in for the network ([fake-papi.ts](src/__tests__/c-sharp-host/fake-papi.ts)), with no Platform.Bible.

[c-sharp/InterlinearizerCrdt](c-sharp/InterlinearizerCrdt) holds the Harmony model of `TextAnalysis`: one entity per record type, each with create, replace, patch, and delete changes, registered in [InterlinearizerCrdtKernel.cs](c-sharp/InterlinearizerCrdt/InterlinearizerCrdtKernel.cs). [c-sharp/Interlinearizer.slnx](c-sharp/Interlinearizer.slnx) groups the three C# projects.

- **Projects**: a database represents one source project and holds every interlinear project made over it. Each analysis and link keeps the project it was created in.
- **Cascading deletes**: a record's project is one of its references, and a link references its analysis. So deleting a project deletes its records, deleting an analysis deletes its links, and a record created in a deleted or never-created project lands deleted.
- **Ids**: Harmony keeps every entity in one table, silently drops a second create under an id, and brings a deleted record back on a put under its id. So record ids are GUID strings distinct across record kinds and projects, and [AnalysisRepository.cs](c-sharp/InterlinearizerCrdt/AnalysisRepository.cs) and [InterlinearProjects.cs](c-sharp/InterlinearizerCrdt/InterlinearProjects.cs) refuse a write that would reuse one. Without those refusals, records are lost or move between kinds or projects.
- **Surface-form fold**: each analysis stores its normalized surface form for lookups, folded by [case-folding.json](src/utils/case-folding.json), the table the WebView folds by. A fixture both test suites run keeps the two folds alike.
- **Repository**: [AnalysisRepository.cs](c-sharp/InterlinearizerCrdt/AnalysisRepository.cs) is the C# slice of the TypeScript `AnalysisRepository` seam. It serves one project of its database and applies each `ChangeSet` as one commit, so a change set lands whole or not at all.
- **Migrations**: a database is created and upgraded through the EF migrations in [c-sharp/InterlinearizerCrdt/Migrations](c-sharp/InterlinearizerCrdt/Migrations), which `dotnet ef` scaffolds through the design-time factory. A model change without a migration fails the test that checks for pending model changes.
  - Until a release ships the database, no stored database needs upgrading, so a model change regenerates `InitialCreate` instead of adding a migration. Run `dotnet ef migrations remove --project InterlinearizerCrdt` (or delete every file in Migrations, snapshot included), then the scaffold command with `InitialCreate` as the name. Delete the `sources` folder in the host's data directory too, because opening a database the old `InitialCreate` built fails.
- **Commit file sync**: [CommitFileSync.cs](c-sharp/InterlinearizerCrdt/CommitFileSync.cs) shares a database's commits through files that every clone of the source receives. Send/Receive merges a shared file by keeping one side of it whole, so each client writes only files of its own, and never changes one. A file holds at most `DefaultMaxFileChars` characters, because one Platform.Bible network message must carry it, so a commit too long for one file is split into parts. A file's name records the exact time of its newest commit, because Harmony's own sync state counts in milliseconds and would skip a later commit in the same millisecond.
- **Serialization**: every change type's JSON discriminator is pinned by [ChangeSerializationTests.cs](c-sharp/InterlinearizerCrdt.Tests/ChangeSerializationTests.cs). A commit written today must still deserialize later, so a renamed or removed change type needs a migration path, and a new change type is appended to the model versions.

### WebView UI

[src/interlinearizer.web-view.tsx](src/interlinearizer.web-view.tsx) — entry point rendered inside Platform.Bible's WebView iframe; delegates to [InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) when a `projectId` is present. `useWebViewScrollGroupScrRef` and `useWebViewState` are **props injected by the PAPI host** (not hook imports).

[InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) — real top of the React tree: owns modal state, persists the active interlinear project, loads the open book's outline and segment pages, and routes top-menu commands to the appropriate modal.

[Interlinearizer](src/components/Interlinearizer.tsx) — renders the interlinear view from the loaded book data.

The main bundle inlines the built WebView through `?inline` imports, so the main build depends on the WebView build ([webpack.config.main.ts](webpack/webpack.config.main.ts)). Otherwise main bundles a stale or missing WebView.

The WebView root component is assigned to `globalThis.webViewComponent` (not exported) — this is the PAPI WebView contract. Tests must `require()` the module and read `globalThis.webViewComponent` to get the component.

### Project modals

[src/components/modals/ProjectModals.tsx](src/components/modals/ProjectModals.tsx) — mount point for the project dialogs, switching on its `ModalState`. The dialogs it mounts call backend commands to list, create, update, and delete projects.

### Project storage

[src/services/projectStorage.ts](src/services/projectStorage.ts) — owns all `papi.storage` reads and writes for interlinearizer projects. Serialization queues prevent interleaved read-modify-write races. Tests must call `resetQueuesForTesting()` between tests because module state is not cleared by `resetMocks`.

[AnalysisRepository](src/types/analysis-repository.ts) is the seam a storage backend implements. [DraftRepository](src/services/draftRepository.ts) implements it over a draft envelope and per-book shards in `papi.storage`, rewriting only the books that change. [Pt9ImportRepository](src/services/pt9ImportRepository.ts) serves a Paratext 9 import through it, read-only. `DraftRepository` imports nothing from PAPI, so the perf harness runs it in Node over the storage files ([perf/storage.ts](perf/storage.ts)); a PAPI import there breaks the harness.

[The conformance suite](src/__tests__/analysis-repository-conformance.ts) defines the seam: every `AnalysisRepository` implementation must pass it, and [draftRepository.conformance.test.ts](src/__tests__/services/draftRepository.conformance.test.ts) runs it against `DraftRepository` and `Pt9ImportRepository`. A behavior every implementation owes goes in the suite; one particular to an implementation, such as which shards a save rewrites, goes in that implementation's own tests.

Saved projects are listed through [ProjectSummaries](src/services/projectSummaries.ts): one record holding every project's summary, rewritten on each project write so listing reads no analysis. Like `DraftRepository`, it is PAPI-free.

Save rebuilds the project record from its stored summary rather than reading and parsing the old record (`recordFromSummary` in [projectStorage.ts](src/services/projectStorage.ts)), so a summary must account for every field of the record but its analysis and boundaries. The stored summary also notes what the record holds under `links` (`alignmentLinks`), which listing callers never see. Save reads the record instead when the summary lacks the note (one stored before it, so the first Save after an upgrade), or the record holds links. A metadata write, or an analysis write that changes the target or analysis languages, first drops the note in storage. So if the summary's refresh then fails, or the process exits before it, Save still reads the record. The rebuilt record's type requires every other field of `InterlinearProject`, so a new field fails to compile until the rebuild handles it; a field the summary cannot carry needs the summary extended, or Save drops it from the record.

### Sessions

[AnalysisSessions](src/services/analysisSessions.ts) keeps the host's sessions. A session is a handle on either one source project's draft, paired with the interlinear project it saves to, or a read-only Paratext 9 import. A source has at most one session: opening another closes it.

- **Pages, not drafts**: the draft stays on the host. The WebView holds only its envelope ([useSessionProject](src/hooks/useSessionProject.ts)) and the pages its views show ([PageClient](src/cache/pageClient.ts) over a [RecordCache](src/cache/recordCache.ts)). No WebView code reads the whole analysis or the whole text, and no draft crosses PAPI, so the view's cost follows what it shows rather than the size of the draft. The host holds the whole draft: opening a session reads `getDraftState` and `getScope`, which load every shard, parse and check it, and build the index that later lookups answer from.
  - New and Open have the host write the new draft through `DraftRepository.startOver`. `startOver` stays off `AnalysisRepository`, because what New and Open mean for another backend is undecided.
  - Save copies the draft that `DraftRepository` keeps (`keptForCopy`) rather than reading every shard again. The kept draft is shared, not copied, so the copy must not change it. The repository refuses to vouch for it after a failed apply, or when it loaded from an unreadable draft, and Save then reads storage. Either way the copy runs on the draft queue, so it waits for queued edits.
- **Text read on demand**: opening a session reads none of the source's text. The session reads the whole text only once a feature needs it (the Stale filter, "Word not in the text", or the concordance), so a session that uses none of them never pays for reading every book.
- **Edits and undo**: each session runs its commands one at a time. A command stages its changes in a [ChangeBuffer](src/services/commands/changeBuffer.ts), and the session applies them as one `ChangeSet` through its [EditHistory](src/services/editHistory.ts), making one undo step. An edit sent under a `changeId` the session has applied, while the session still keeps that reply (`KEPT_REPLIES`), gets the reply back and is not applied again; `PageClient` sends every command under a fresh one. Re-anchor passes keep the analysis on the text as the text changes. Each pass records in the draft the `textVersion` that it anchored its book to, so a later session skips a book's first pass while that text is unchanged. They go through the history too, without being undo steps, so an undo re-anchors what it restores. The whole-text read queues its passes one at a time, so an edit sent meanwhile waits for one pass at most, and a pass skips its book once newer text for it has arrived. An edit also holds the read, which fetches and tokenizes no further book until the edit settles, so that the edit's save need not share the host with the read. The open book's text is still read again at once when it changes. A boundary or discard edit returns, in `reanchorTo`, the books it changes, so the session re-anchors them in the same undo step. A book left out keeps its analysis on the old segments, and later passes skip it because its text has not changed.
- **Change reports**: each change a session applies goes out as `onAnalysisChanged` ([describeChange](src/services/analysisChanges.ts)), naming the books, segments, and cross-book queries it affects. The WebView fetches again only what a report names. So a change that alters a query's answer must name that query, or the view goes stale. For example, a switch of analysis language names the catalog and concordance queries, because both read the session's language.
- **JSON across PAPI**: arguments and replies cross PAPI as JSON, which writes `undefined` as `null`. A field where `undefined` carries meaning, such as the catalog's untagged filter choice, must be restored on arrival (`restoreUntagged`), or it silently becomes another value.

Host commands live in [src/services/commands/](src/services/commands/), one module per family; their outcome tests run through [command-runs](src/__tests__/services/commands/command-runs.ts). The WebView reaches the session through these modules:

- [sessionEditHandlers](src/services/sessionEditHandlers.ts): edits and their previews.
- [sessionCatalogHandlers](src/services/sessionCatalogHandlers.ts): the analysis catalog, read through [catalogHooks](src/cache/catalogHooks.ts).
- [sessionConcordanceHandlers](src/services/sessionConcordanceHandlers.ts): the concordance, read through [concordanceHooks](src/cache/concordanceHooks.ts).
- [sessionPageHandlers](src/services/sessionPageHandlers.ts): the draft envelope, outlines, segment pages, and stale summaries, which [sessionPages](src/services/sessionPages.ts) reads. Stale summaries are read through [staleHooks](src/cache/staleHooks.ts).

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

- `InterlinearProject` — a saved project: metadata, source and optional target project ids, and the `analysis: TextAnalysis`. A draft is stored as the same envelope with its analysis split into per-book shards. The `Book` hierarchy is never stored; it is rebuilt from USJ on each load.
- `Book → Segment → Token` — the text hierarchy. Section headings are segments too (`Segment.heading`), with no verse starts. As in Paratext, each heading is filed under the verse before it, or under verse 0 when it precedes a chapter's first verse. Headings never merge or split with verse text. A heading within a verse's text splits that verse, and the text resuming after it is a segment keyed and flagged like a split's later piece. Text ahead of the first chapter or verse is kept apart as `Book.frontMatter`, tokenized but never segmented or displayed.
- `TextAnalysis` — flat analysis layer keyed by id (does **not** mirror text hierarchy)
- `TokenAnalysis / MorphemeAnalysis` — parse and 1:1 glosses; multiple analyses per token are allowed, distinguished by `status`
- `AlignmentLink` — directional links between source and target endpoints
- `AlignmentEndpoint` — has either token-level or morpheme-level specificity

All character offsets (`charStart`, `charEnd`, `charIndex`) are zero-based UTF-16 code-unit indices — plain JavaScript string indices, not code points and not grapheme clusters — with end offsets exclusive.

Key invariants: `Segment.baselineText.slice(charStart, charEnd) === Token.surfaceText`; at most one linked analysis per token/segment may have `status: 'approved'`. Token and phrase payloads are shared by every occurrence analyzed identically, so a link is identified by its own `id`, never by its `analysisId`. Picking one of a token's or segment's links, or one of several identical payloads, goes through [pick-rules.ts](src/utils/pick-rules.ts), never list order. `MultiString` values are keyed by BCP 47 tags. `TokenSnapshot.surfaceText` detects drift when baseline text changes. Every project and draft record carries a `modelVersion`; every write stamps `CURRENT_MODEL_VERSION`, and a record stamped higher than that is refused (`assertSupportedModelVersion`) rather than read or overwritten. Save's rebuild from the summary does not read the record, so it refuses a newer one only when that build restamped the summaries, as a newer build must.

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

After adding or editing a Jest `describe` block or a TUnit test class, run the [test-audit skill](.claude/skills/test-audit/SKILL.md) on what you edited.

`resetMocks: true` is set globally — mock implementations are cleared before every test, so each test must set up its own mocks (typically in `beforeEach`). Never rely on implementation state leaking from a prior test.

Any `console.error` or `console.warn` call fails the test that is running when it lands, or the file when it lands after the last test ([jest.environment.ts](jest.environment.ts)). A log from a cleanup hook fails the test that the hook ran after. A log from loading a test file, or from its `afterAll`, fails the file. A test that expects a log silences it with `jest.spyOn(console, 'error').mockImplementation(...)`. A test that leaves async work running, such as a lookup that sets state once it resolves, waits for that work with `findBy*` or `waitFor`, or unmounts to abandon it.

`@papi/backend` and `@papi/frontend` mocks are mutually exclusive: backend tests use `papi-backend.ts`, WebView tests use `papi-frontend.ts` + `papi-frontend-react.ts`. Each mock file ends with `export {}` so TypeScript treats it as a module.

### Test data

Keep fixture names, ids, glosses and invented text neutral: no divine names, and nothing sensitive or crude. A quoted scripture snippet may keep its own wording, but the records that a test builds over it pick a neutral word from it, such as `beginning` rather than `God`. Quote a verse that is bland on its own, never one whose wording is sensitive out of context.

### Testing hooks

Test context hooks and dispatchers directly with `renderHook` + a `wrapper`, not a throwaway button-and-click component. See `sessionProviderOver` in [AnalysisStore.test.tsx](src/__tests__/components/AnalysisStore.test.tsx) for the provider-wrapping pattern: return the hooks under test from the callback, drive dispatchers inside `act(...)`, and assert on state read off `result.current`. Reserve rendered components for behavior that genuinely needs the DOM — re-render / render-count assertions and mount/unmount lifecycle.

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
- **`__mocks__/lucide-react.tsx`** — Stubs icon components.
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
