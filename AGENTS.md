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
npm run perf:pages       # Check session pages, outlines and change events against what the selectors derive from the whole analysis
```

Only a template merge moves the dependency baseline that `npm run lint:dependencies` checks against. Refresh it in that same commit with `npm run template:baseline`, which writes both the baseline (a copy of the template's `package.json`) and the `MERGED_TEMPLATE_COMMIT` id in [scripts/check-dependency-scope.cjs](scripts/check-dependency-scope.cjs). [README.md](README.md) has the full procedure.

## Architecture

This is a **Platform.Bible extension** for interlinear Bible text alignment. Platform.Bible (PAPI) is an Electron-based application; extensions run in a sandboxed context and communicate with the host via `papi.*` APIs.

### Extension entry point

[src/main.ts](src/main.ts) — called by Platform.Bible on activation. Exports two lifecycle functions:

- `activate(context)` — stores the `ExecutionToken`, registers the `interlinearizer.mainWebView` WebView provider, command handlers, network event emitters, project settings validators, and the `onDidOpenWebView` / `onDidUpdateWebView` / `onDidCloseWebView` subscriptions. It builds the sessions and their `onAnalysisChanged` emitter before registering any command. One of its registrations closes every session, then lets go of every book `bookService` keeps, then disposes that emitter. All registrations are added to `context.registrations` so the platform disposes them on deactivation.
- `deactivate()` — clears `openWebViewsByProject` and `duplicateWebViewsByProject`, and returns `true`.

`openWebViewsByProject` (`Map<string, string>`) tracks one open WebView ID per project to prevent duplicates; reopening an already-open project brings that tab to front via the `existingId` option. The same open and update subscriptions remember which interlinear project each source's WebView has active. An open that creates a tab seeds that project into the new WebView's state, as it does the Paratext 9 import offer.

### C# host

[c-sharp/InterlinearizerHost](c-sharp/InterlinearizerHost) is a .NET program the extension starts on activation ([csharpHost.ts](src/services/csharpHost.ts)) and stops on deactivation. It registers its commands on the PAPI network, so TypeScript calls them with `papi.commands.sendCommand` like any other. It exits once its connection to Platform.Bible closes.

- **Runtime**: it targets .NET 10, which Harmony needs, and is published self-contained for each platform Platform.Bible ships for, since Platform.Bible's own runtime is private to its process.
- **Network client**: it talks to the network through its own small client, since core's is not packaged for extensions to use. That client offers the methods core's does, so services can move into core later.
- **Build**: the build copies whatever `npm run build:c-sharp` has published; without it the extension logs that the host could not start and carries on.
- **Services**: they come from one DI container built in `Program`. There is no scope per request, because the JSON-RPC layer offers none.
  - `OpenSources` opens one DI scope per source project and keeps it until the source is closed, as FieldWorks Lite does. The first command on a source opens it.
  - Each scope sits over the source's own SQLite database, named after the source in the container's `SourcesDirectory`. Nothing else names the file, so a source always opens the same database.
  - A source's id may hold only ASCII letters, digits, `_`, and `-`, so it names the same file on every platform, and the host refuses any other id. The host upper-cases the id, since Platform.Bible compares project ids ignoring case.
  - A handler takes the source and interlinear project ids and resolves the project's `AnalysisRepository` from the source's scope. A project the database does not store has no repository.
  - Commands on one source share its scope's `InterlinearizerCrdtDbContext`, and EF Core does not allow overlapping operations on one context. So the host runs each command on a source, `closeSource` included, under that source's lock in `OpenSources.Exclusive`, and callers may overlap them.
- **Client id**: the host keeps a per-installation client id, which Harmony tells devices apart by, in its data directory: `--data-dir` names it, defaulting to a per-user folder.
- **Port**: `--papi-port` names the network's port, defaulting to Platform.Bible's.
- **Repository commands**: [RepositoryService.cs](c-sharp/InterlinearizerHost/Services/RepositoryService.cs) serves the C# `AnalysisRepository` as `interlinearizer.repository.<method>`, one command per method.
  - Each command takes one object naming the source project, the interlinear project, and the method's arguments.
  - Beside them sit `closeSource`, which takes the source alone, and project commands mirroring [InterlinearProjects.cs](c-sharp/InterlinearizerCrdt/InterlinearProjects.cs). An update names the fields to set or clear, as `ProjectPatch` does.
  - The host leaves `projectId` off the wire, because the TypeScript records never carry it.
  - [CSharpRepository](src/services/csharpRepository.ts) is the TypeScript side: an `AnalysisRepository` over one project that sends each call as a command. It refuses a change set carrying a `ScopeRecord`, which the host stores nowhere.
  - Record ids must be GUID strings that are distinct across record kinds, for the reason under **Repository** below.
- **Conformance**: `npm run test:c-sharp:conformance` runs the required tests of the [conformance suite](src/__tests__/analysis-repository-conformance.ts) against the published host.
  - [fake-papi.ts](src/__tests__/c-sharp-host/fake-papi.ts) stands in for the Platform.Bible network: it starts the host on a free port, accepts its registrations, and sends it the suite's commands. The run needs no Platform.Bible.
  - Each test's store prefixes its source ids with its own number, so every test gets fresh databases on the one host.
  - [projects.test.ts](src/__tests__/c-sharp-host/projects.test.ts) covers the source and project commands.

[c-sharp/InterlinearizerCrdt](c-sharp/InterlinearizerCrdt) holds the Harmony (CRDT) model of `TextAnalysis`: one entity per record type the analysis layer lists, with a create, replace, patch, and delete change for each, registered in [InterlinearizerCrdtKernel.cs](c-sharp/InterlinearizerCrdt/InterlinearizerCrdtKernel.cs). [c-sharp/Interlinearizer.slnx](c-sharp/Interlinearizer.slnx) groups the three C# projects.

- **Projects**: a database represents one source project and holds every interlinear project made over it.
  - Each interlinear project is an `InterlinearProject` entity with a create, patch, and delete change. The patch replaces the analysis language list whole, so the later of two devices' edits stands.
  - Every analysis and link carries the `ProjectId` it was created in, and no later change moves it. A record's create change refuses an empty `ProjectId`.
  - The project is one of the record's references, so deleting the project deletes its records. A record created in a deleted or never-created project lands deleted.
  - [InterlinearProjects.cs](c-sharp/InterlinearizerCrdt/InterlinearProjects.cs) manages a database's projects, one commit per call. A create refuses an id any record has ever been stored under, because Harmony would drop a second create without error.
- **Owned values**: values an entity owns, such as a token analysis's morphemes or a link's token snapshots, are stored inside it as JSON, not as entities.
- **Lookup columns**: each link keeps the book it points into, and each analysis its normalized surface form, as plain columns derived in their setters, so lookups need not read the JSON. The form is folded by the Unicode table the WebView folds by, [case-folding.json](src/utils/case-folding.json), and a fixture both test suites run keeps the two folds alike.
- **Patch changes**:
  - A patch change carries each field as a `PatchField<T>`: a field left unset leaves the stored value alone and one set to null clears it.
  - A multistring or feature map is a plain nullable `MultiStringPatch` instead, because a null patch already means unset. Each key it names is set to its value, or removed when that value is null.
  - A JSON type-info modifier leaves unset fields out of the change's JSON, which is what keeps them unset when the change is read back.
- **Empty maps**: an analysis's multistring or feature map field with no keys is stored as null, so every change that writes one whole passes it through `MultiString.NullIfEmpty`, as the per-key merge does. Maps nested in owned values, such as a morpheme's gloss, are stored as given.
- **Deletes**: a link references its analysis, so deleting the analysis deletes the link.
- **Migrations**: a database is created and upgraded through the EF migrations in [c-sharp/InterlinearizerCrdt/Migrations](c-sharp/InterlinearizerCrdt/Migrations), which `dotnet ef` scaffolds through the design-time factory. A model change without a migration fails the test that checks for pending model changes.
  - Until a release ships the database, no stored database needs upgrading, so a model change regenerates `InitialCreate` instead of adding a migration. Run `dotnet ef migrations remove --project InterlinearizerCrdt` (or delete every file in Migrations, snapshot included), then the scaffold command with `InitialCreate` as the name. Delete the `sources` folder in the host's data directory too, because opening a database the old `InitialCreate` built fails.
- **Repository**: [AnalysisRepository.cs](c-sharp/InterlinearizerCrdt/AnalysisRepository.cs) is the C# slice of the TypeScript `AnalysisRepository` seam, serving one project of its database.
  - It applies a `ChangeSet` of whole-record puts and deletes as one commit. A put of a record not stored creates it in that project. Otherwise the caller's `PutMode` says whether to replace the record whole or patch only the fields that differ.
  - It answers the seam's lookups from the projected tables, filtered to its project.
  - Harmony keeps every entity in one table. To avoid losing or moving a record, an apply refuses a change set that names one id under more than one record kind. It also refuses a put whose id is stored as another kind or in another project, or whose record names another project. Harmony brings a deleted record back on a put under its id, so a put whose id was deleted as another kind or in another project is refused too.
  - An apply also refuses a link that names an analysis stored in another project, or one that the change set neither puts nor leaves stored.
  - A delete of another project's record is skipped.
- **Serialization**: every change type's JSON discriminator is pinned by [ChangeSerializationTests.cs](c-sharp/InterlinearizerCrdt.Tests/ChangeSerializationTests.cs). A commit written today must still deserialize later, so a renamed or removed change type needs a migration path, and a new change type is appended to the model versions.

### WebView UI

[src/interlinearizer.web-view.tsx](src/interlinearizer.web-view.tsx) — entry point rendered inside Platform.Bible's WebView iframe; delegates to [InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) when a `projectId` is present. `useWebViewScrollGroupScrRef` and `useWebViewState` are **props injected by the PAPI host** (not hook imports).

[InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) — real top of the React tree: owns modal state, persists the active interlinear project, loads the open book's outline and segment pages, and routes top-menu commands to the appropriate modal.

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

Drafts are loaded and saved through [AnalysisRepository](src/types/analysis-repository.ts), the seam a later storage backend implements. [DraftRepository](src/services/draftRepository.ts) implements it over the draft envelope and its per-book shards, and rewrites only the books that changed. It imports nothing from PAPI and reaches storage only through a `KeyValueStorage`. That lets the perf harness run it in Node, straight over the storage files ([perf/storage.ts](perf/storage.ts)). [Pt9ImportRepository](src/services/pt9ImportRepository.ts) serves a Paratext 9 import through the same seam, read-only. Both answer the seam's lookups from an [AnalysisIndex](src/services/analysisIndex.ts) built from the records on first use. `DraftRepository.apply` keeps the index current and uses it to find the books a change set reaches. An apply compares those, plus the books an earlier failed save left `unsettled` in the shard journal and any book the repository holds no saved content for. A journal that won't parse or is malformed makes the next apply compare every book. `checkIndexes` compares the index with one built afresh. It also compares each stored shard with the draft. That finds a book that a failed apply left out of step, even after the journal is lost.

[The conformance suite](src/__tests__/analysis-repository-conformance.ts) defines the seam: every `AnalysisRepository` implementation must pass it, and [draftRepository.conformance.test.ts](src/__tests__/services/draftRepository.conformance.test.ts) runs it against `DraftRepository` and `Pt9ImportRepository`. A behavior every implementation owes goes in the suite; one particular to an implementation, such as which shards a save rewrites, goes in that implementation's own tests. A later backend runs the suite by passing `describeAnalysisRepositoryConformance` a factory that returns a fresh `ConformanceStore` for each test.

Saved projects are listed through [ProjectSummaries](src/services/projectSummaries.ts): one record holding every project's summary, rewritten on each project write so listing reads no analysis. Like `DraftRepository`, it is PAPI-free.

### Sessions

[AnalysisSessions](src/services/analysisSessions.ts) keeps the host's sessions, behind the `openSession`, `closeSession`, and `setAnalysisLanguage` commands. A session is a handle on either one source project's draft, paired with the interlinear project it saves to, or a read-only Paratext 9 import. A source has at most one session: opening another closes it.

Opening a session starts building its repository's indexes ahead of the session's first command. It reads none of the source's text. The session starts a fresh whole-text read the first time a feature needs the whole text: the view's `getTextReadStatus` asks for it once the Stale filter, "Word not in the text" or the concordance wants the text. The read lasts until the session closes. Each time the read files a book, the session reports a change that names `getTextReadStatus`, and `getCatalogRows` as well once the read can answer which forms the text holds; the report says that it leaves the draft as saved as it was. `setSaveTarget` changes the project that a draft's session saves to, and `detachFromProject` leaves it none once that project is deleted. New and Open send `startDraftOver` the configuration or the id of the project to copy. It closes the source's session and writes the draft on the host through `DraftRepository.startOver`, so no draft crosses PAPI. `startOver` is not part of `AnalysisRepository`, because what New and Open mean for another backend is undecided. The WebView then opens a fresh session.

#### Running commands

Each session runs its commands one at a time through `run`. A command that changes stored analysis goes through `runEdit` instead, which a read-only session refuses. An edit reaches the repository as a `ChangeSet` of whole-record puts and deletes, applied through the session's [EditHistory](src/services/editHistory.ts) so that undo can revert it. Boundary changes ride in the change set's scope record.

Re-anchor passes are the exception. When the view outlines a book, `reanchorOpenedBook` re-anchors the draft to that book through `run`, before the outline. As the read delivers each book, `reanchorBook` does the same. Both skip a book that the session last re-anchored to the same text. `reanchorMissingBooks` re-anchors each linked book the text lacks. All three skip a read-only session. A pass is no undo step and leaves the unsaved mark as it was. The history still applies and records it, so that an undo or redo re-anchors what it restores. A pass to a book's edited text reports nothing itself; `reportScriptureEdit` reports the edit, with what its passes changed, as one change that names the book whole.

#### Replies and change reports

An edit, undo, or redo replies with a `CommandReply`, which carries:

- the `ChangeSet` it applied;
- the books whose boundaries it moved;
- the books where it put or removed a stale free translation that the view places;
- the books where it put or removed a stale token link;
- for an undo or redo, whether it left the draft unsaved;
- the pool buckets of the forms it touched, which [sessionPages](src/services/sessionPages.ts) reads.

A command sent again under a `changeId` the session has applied gets its first reply and applies nothing. Each undo step carries the place it was made at, or a summary of a step made at no one place, as [editSteps](src/services/editSteps.ts) derives them; an undo or redo hands its step back.

Each change a session applies, re-anchor passes included, is described by [describeChange](src/services/analysisChanges.ts) and goes out as the session form of `onAnalysisChanged`. That event carries the change's segment ranges by book, a flag on each book where the change put or removed a stale free translation and another where it put or removed a stale token link, analysis ids, touched forms, and cross-book queries. A report of re-anchor passes, or of the whole-text read's progress, says that it leaves the draft as saved as it was. Any other report that the view hears makes it read the draft's envelope again through `getDraftEnvelope`. The envelope is the draft without its analysis or boundaries. A book the host keeps no tokenized copy of is named whole.

#### The WebView's sessions

[useSessionProject](src/hooks/useSessionProject.ts) keeps the draft in a session, holding only its envelope. The analysis hooks read pages through a `PageClient` and send each edit as a session command. No WebView code reads the whole analysis or the whole text.

`getBookOutline`, `getSegments`, and `getTextReadStatus` take a `{ sessionId }` address. They segment the text by the draft's boundaries, and the pages add the analysis that `sessionPages` reads. The outline counts each segment's orphaned free-translation cards and flags the segments that show a stale gloss or free translation. When a reply or a reported change flags the book for either, the client reads those counts and flags again rather than the whole outline. Each page also spans each phrase it touches with every member token, wherever it sits. The outline also says what the boundary controls need to know of the draft's boundaries in the book, and which verse markers the book repeats.

[RecordCache](src/cache/recordCache.ts) holds one book's pages and their records, and a [PageClient](src/cache/pageClient.ts) fills it from a session. The client:

- loads each view's range;
- sends each command under a change id it mints, and applies the reply;
- fetches again what a reply or a reported change leaves out of date;
- skips the change that a session reports for a command it sent, whether that change arrives before the reply or after it, unless the command throws.

A page fetched before a reply never overwrites what the reply wrote. A page that fails every retry waits for a view to ask for it again, for `retryFailed`, or for a later outline read. An outline read that fails waits for either of the last two. Nothing calls `retryFailed` yet.

[page-indexes](src/utils/page-indexes.ts) builds the token-level lookups and the boundary guard from the pages held and their spans, and finds the segment of a target whose page hasn't loaded. The view renders the open book from the outline and the pages held, through those lookups. A focus request or a reseed whose segment hasn't loaded waits for its page.

#### Host commands

Host commands live in [src/services/commands/](src/services/commands/), one module per family. Session commands take one object of named fields, such as `sessionId` and an edit's optional `changeId`. The exceptions are `getBookOutline`, `getSegments`, and `getTextReadStatus`, which take a `{ sessionId }` address among positional arguments.

A command stages its changes in a [ChangeBuffer](src/services/commands/changeBuffer.ts), whose reads answer as the repository will once those changes apply. `AnalysisSessions.edit` applies what it staged as one undo step. It first refuses changes that break the approval rule or that leave a kept link naming an analysis that won't be stored.

Each command family's outcome tests run inputs through the command and check what its changes leave, through [command-runs](src/__tests__/services/commands/command-runs.ts):

- `runCommand` runs a command over a stored draft.
- `runBoundaryCommand` runs a boundary command, which breaks the phrases a new boundary would cut. The session then re-anchors the book's analysis to the new segments in the same undo step.
- `runDiscardCommand` runs an unsaved-change discard, which re-anchors each book it rewrites in the same undo step.

The handlers that turn each command's arguments into a call on its family live in [sessionEditHandlers](src/services/sessionEditHandlers.ts). A catalog edit's reply also says where the edit left the record it was aimed at. Two previews sit beside the edits and apply nothing. `previewRemovals` names the token analyses an edit would remove. `previewBreakdownEdit` says what a breakdown edit at a token would do to the payload the token approves, and the morpheme editor asks it each time it opens. `main.ts` registers them, and the test host in [fake-host](src/__tests__/cache/fake-host.ts) serves the WebView's edits through them.

The analysis catalog is served by [sessionCatalogHandlers](src/services/sessionCatalogHandlers.ts): `getCatalogRows` (a page by offset, the ids of every row it keeps, and the filter facets), `getSelectionSummary`, `countUsages`, `getCatalogRowsByIds`, `getHomographRows` and `previewDeletion`. Each reads the session's whole draft, and [catalogPages](src/services/catalogPages.ts) derives the answers. `previewDeletion` also reads the text of each book where a token approves the analysis, so its outcome is `uncertain` only where it depends on a token whose book's text cannot be read, or where the tokens would fall back to different analyses. "Word not in the text" comes from the whole-text read's form index. The panel reads these queries through [catalogHooks](src/cache/catalogHooks.ts), which fetch again whenever a reported change names the query. A switch to a new analysis language reports a change that names `getCatalogRows`, because every catalog query reads the session's language. JSON writes the untagged filter choice, `undefined`, as `null`, so both ends pass filters and facets through `restoreUntagged`. The fake host serves the catalog queries too, along with a whole-text read that each test configures.

The concordance is served by [sessionConcordanceHandlers](src/services/sessionConcordanceHandlers.ts): `getConcordance` pages either the forms of the whole text, most frequent first, or one form's occurrences with the analyses they are approved to. The whole-text read in `BookService` keeps each book's occurrences, and the handler joins them with the draft's approved links. It answers `null` until every book has been read. While any book's latest read has failed, the panel offers to send `retryTextRead`, which reads those books again. The panel reads it through `useConcordanceView` and `useConcordanceOccurrences` in [concordanceHooks](src/cache/concordanceHooks.ts), which fetch again whenever a reported change names `getConcordance` or `getTextReadStatus`. A switch to a new analysis language reports a change that names `getConcordance` too, because a form's occurrences are glossed in the session's language.

`getStaleSummary` lists the stale gloss places and stale free translations of one book, segmented by the draft's boundaries. [sessionPages](src/services/sessionPages.ts) derives it beside the outline. The stale notice reads it through `useStaleSummary` in catalogHooks, which fetches again whenever a reported change names the query. A change names it when it puts or removes a stale link, changes a payload a stale link names, or moves boundaries, since moving them can move where a stale translation shows.

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
