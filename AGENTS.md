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

- `activate(context)` — stores the `ExecutionToken`, registers the `interlinearizer.mainWebView` WebView provider, command handlers, the `interlinearizer.continuousScroll` project settings validator, and the `onDidOpenWebView` / `onDidCloseWebView` subscriptions. All registrations are added to `context.registrations` so the platform disposes them on deactivation.
- `deactivate()` — clears `openWebViewsByProject` and returns `true`.

`openWebViewsByProject` (`Map<string, string>`) tracks one open WebView ID per project to prevent duplicates; reopening an already-open project brings that tab to front via the `existingId` option.

### WebView UI

[src/interlinearizer.web-view.tsx](src/interlinearizer.web-view.tsx) — entry point rendered inside Platform.Bible's WebView iframe; delegates to [InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) when a `projectId` is present. `useWebViewScrollGroupScrRef` and `useWebViewState` are **props injected by the PAPI host** (not hook imports).

[InterlinearizerLoader](src/components/InterlinearizerLoader.tsx) — real top of the React tree: owns modal state, persists the active interlinear project, fetches and tokenizes book data, and routes top-menu commands to the appropriate modal.

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

[src/components/ProjectModals.tsx](src/components/ProjectModals.tsx) — single mount point for all project-related dialogs, switching between `'select' | 'create' | 'metadata' | 'none'` states. The three modal components ([SelectInterlinearProjectModal](src/components/SelectInterlinearProjectModal.tsx), [CreateProjectModal](src/components/CreateProjectModal.tsx), [ProjectMetadataModal](src/components/ProjectMetadataModal.tsx)) call backend commands to list, create, update, and delete projects.

### Project storage

[src/services/projectStorage.ts](src/services/projectStorage.ts) — owns all `papi.storage` reads and writes for interlinearizer projects. Two serialization queues prevent interleaved read-modify-write races. Tests must call `resetQueuesForTesting()` between tests because module state is not cleared by `resetMocks`.

### Styling

All UI uses Tailwind CSS (via `src/tailwind.css`). Every Tailwind class is prefixed `tw:` to avoid collisions with Platform.Bible's own styles (configured in `tailwind.config.ts`). For modifier variants the prefix comes first: `tw:hover:px-3`, not `hover:tw-px-3`.

### Parser pipeline

Data flows from Platform.Bible's USJ (Unified Scripture JSON) format through two stages:

1. [src/parsers/papi/usjBookExtractor.ts](src/parsers/papi/usjBookExtractor.ts) — converts USJ to the internal `RawBook` type
2. [src/parsers/papi/bookTokenizer.ts](src/parsers/papi/bookTokenizer.ts) — segments and tokenizes the book into `Segment`/`Token` structures with character offsets

[src/parsers/pt9/interlinearXmlParser.ts](src/parsers/pt9/interlinearXmlParser.ts) — separately parses Paratext 9 interlinear XML into the alignment model. The XML schema is documented in [pt9-xml.md](src/parsers/pt9/pt9-xml.md).

### Data model ([src/types/interlinearizer.d.ts](src/types/interlinearizer.d.ts))

The core types are:

- `InterlinearProject` — persisted envelope: id, createdAt, optional name/description, `sourceProjectId`, optional `targetProjectId`, `analysisLanguages`, `analysis: TextAnalysis`, and optional `links`. Only this is serialized to storage; the `Book` hierarchy is rebuilt from USJ on each load.
- `ActiveProject` — runtime pairing of `project: InterlinearProject` with reconstructed `source` and optional `target` books.
- `Book → Segment → Token` — the text hierarchy
- `TextAnalysis` — flat analysis layer keyed by id (does **not** mirror text hierarchy)
- `TokenAnalysis / MorphemeAnalysis` — parse and 1:1 glosses; multiple analyses per token are allowed, distinguished by `status`
- `AlignmentLink` — directional links between source and target endpoints
- `AlignmentEndpoint` — has either token-level or morpheme-level specificity

Key invariants: `Segment.baselineText.slice(charStart, charEnd) === Token.surfaceText`; at most one linked analysis per token/segment may have `status: 'approved'`. `MultiString` values are keyed by BCP 47 tags. `TokenSnapshot.surfaceText` detects drift when baseline text changes.

### TypeScript path aliases

- `@main` → `src/main`
- `parsers/*` → `src/parsers/*`

## Testing

Jest with ts-jest, jsdom environment. PAPI is fully mocked in `__mocks__/`. Coverage is enforced at 100% on all `src/**` files (branches, functions, lines, statements), aside for select explicit exclusions.

`resetMocks: true` is set globally — mock implementations are cleared before every test, so each test must set up its own mocks (typically in `beforeEach`). Never rely on implementation state leaking from a prior test.

`@papi/backend` and `@papi/frontend` mocks are mutually exclusive: backend tests use `papi-backend.ts`, WebView tests use `papi-frontend.ts` + `papi-frontend-react.ts`. Each mock file ends with `export {}` so TypeScript treats it as a module.

### Mock internals

Key semantic properties of the mock setup:

- **`resetMocks: true`** — Mock implementations are cleared before every test. Each test must set up its own mocks (typically in `beforeEach`); never rely on state leaking from a prior test.
- **Backend vs. frontend exclusivity** — Backend tests use `papi-backend.ts`, WebView tests use `papi-frontend.ts` + `papi-frontend-react.ts`. Each mock file ends with `export {}` to be treated as a module.
- **`globalThis.webViewComponent` contract** — The WebView root component is assigned to the global (not exported). Tests must `require()` the module and read `globalThis.webViewComponent` to get the component.

Mock files:

- **`__mocks__/fileMock.ts`** — Stub static asset imports.
- **`__mocks__/lucide-react.tsx`** — Stubs icon components used in modals.
- **`__mocks__/papi-backend.ts`** — Mocks with jest fns. Re-exports internal jest fns on the default export as `__mock*` properties (e.g., `papi.__mockRegisterCommand`) so tests can assert on them without re-importing. See file for full list.
- **`__mocks__/papi-core.ts`** — Empty module; exists only for module resolution since `@papi/core` is types-only at runtime.
- **`__mocks__/papi-frontend.ts`** — Stubs `logger` (debug/error/info/warn as jest fns) and `papi.commands.sendCommand` / `papi.notifications.send`.
- **`__mocks__/papi-frontend-react.ts`** — Stubs PAPI React hooks.
- **`__mocks__/platform-bible-react.tsx`** — Stubs components with appropriate `data-testid` attributes. See file for test IDs.
- **`__mocks__/platform-bible-utils.ts`** — Stubs util functions.
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

Type declarations (interfaces, type aliases, enums) must have a JSDoc summary on the type itself and on each field or member whose purpose is not self-evident from its name and type. We document each field individually rather than describing the fields in the type-level summary.

## Spelling

Use American English throughout — in code, comments, JSDoc, and documentation:

- `center` not `centre`, `color` not `colour`, `behavior` not `behaviour`
- `canceled`/`canceling` not `cancelled`/`cancelling`, `leveled`/`leveling` not `levelled`/`levelling`
- `neighboring` not `neighbouring`, `favor` not `favour`, `signaled` not `signalled`

## UX decisions

When key UX decisions are being made, discuss with a developer whether something should be added to `user-questions.md` for review with people outside the development team.
