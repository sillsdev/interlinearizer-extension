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

`src/main.ts` — called by Platform.Bible on activation. Exports two lifecycle functions:

- `activate(context)` — registers the `interlinearizer.mainWebView` WebView provider, eight commands (`interlinearizer.openForWebView`, `interlinearizer.createProject`, `interlinearizer.getProjectsForSource`, `interlinearizer.updateProjectMetadata`, `interlinearizer.deleteProject`, `interlinearizer.openSelectProjectModal`, `interlinearizer.openNewProjectModal`, `interlinearizer.openProjectInfoModal`), and `onDidOpenWebView` / `onDidCloseWebView` subscriptions. All registrations are added to `context.registrations` so the platform disposes them on deactivation.
- `deactivate()` — clears `openWebViewsByProject` and returns `true`.

`openWebViewsByProject` (`Map<string, string>`) tracks one open WebView ID per project to prevent duplicates; reopening an already-open project brings that tab to front via the `existingId` option.

### WebView UI

`src/interlinearizer.web-view.tsx` — React component rendered inside Platform.Bible's WebView iframe. `useWebViewScrollGroupScrRef` is a **prop injected by the PAPI host** (not a hook import). Uses PAPI frontend hooks (`useProjectData`, `useProjectSetting`, `useLocalizedStrings`, `useRecentScriptureRefs`) to fetch live data. Renders verse segments as token chips with Tailwind utility classes (all prefixed `tw:`).

The WebView is injected into the main bundle via Webpack's `?inline` query:

```ts
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
```

`src/webpack-env.d.ts` declares the `*?inline`, `*?raw`, and `*.scss` module types that make these imports type-safe.

Two separate Webpack configs handle this: `webpack.config.web-view.ts` builds the React component into `temp-build/`, then `webpack.config.main.ts` copies it into `dist/` alongside contributions, public assets, and type declarations.

The WebView root component is assigned to `globalThis.webViewComponent` (not exported) — this is the PAPI WebView contract. Tests must `require()` the module and read `globalThis.webViewComponent` to get the component.

### Styling

All UI uses Tailwind CSS (via `src/tailwind.css`). Every Tailwind class is prefixed `tw:` to avoid collisions with Platform.Bible's own styles (configured in `tailwind.config.ts`). For modifier variants the prefix comes first: `tw:hover:px-3`, not `hover:tw-px-3`.

### Parser pipeline

Data flows from Platform.Bible's USJ (Unified Scripture JSON) format through two stages:

1. `src/parsers/papi/usjBookExtractor.ts` — converts USJ to the internal `Book` type
2. `src/parsers/papi/bookTokenizer.ts` — segments and tokenizes the book into `Segment`/`Token` structures with character offsets

`src/parsers/pt9/interlinearXmlParser.ts` — separately parses Paratext 9 interlinear XML into the alignment model. The XML schema is documented in `src/parsers/pt9/pt9-xml.md`.

### Data model (`src/types/interlinearizer.d.ts`)

The core types are:

- `InterlinearProject` — persisted envelope: metadata, `sourceProjectId`, optional `targetProjectId` (bilateral alignment projects only), `analysis: TextAnalysis`, and `links: AlignmentLink[]`. The text hierarchy is **not** stored here — it is rebuilt from USJ at runtime.
- `ActiveProject` — runtime pairing of `project: InterlinearProject` with reconstructed `source: Book[]` and optional `target?: Book[]` text layers. Never serialized.
- `Book → Segment → Token` — the text hierarchy (rebuilt from USJ on load; not persisted in `InterlinearProject`)
- `TextAnalysis` — flat analysis layer on `InterlinearProject.analysis`, keyed by id (does **not** mirror text hierarchy)
- `TokenAnalysis / Morpheme` — parse and 1:1 glosses; multiple analyses per token are allowed, distinguished by `status`
- `AlignmentLink` — links between source and target tokens/morphemes
- `AlignmentEndpoint` — has either token-level or morpheme-level specificity, never both

Key invariants: `Segment.baselineText.slice(charStart, charEnd) === Token.surfaceText`; at most one `TokenAnalysis` per token may have `status: 'approved'`. Multi-string content is tagged by BCP47 writing-system codes. `tokenSnapshot` fields detect drift when baseline text changes.

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
- **`__mocks__/papi-backend.ts`** — Mocks with jest fns. Re-exports internal jest fns on the default export as `__mock*` properties (e.g., `papi.__mockRegisterCommand`) so tests can assert on them without re-importing. See file for full list.
- **`__mocks__/papi-core.ts`** — Empty module; exists only for module resolution since `@papi/core` is types-only at runtime.
- **`__mocks__/papi-frontend.ts`** — Stubs `logger` (debug/error/info/warn as jest fns).
- **`__mocks__/papi-frontend-react.ts`** — Stubs PAPI React hooks.
- **`__mocks__/platform-bible-react.tsx`** — Stubs components with appropriate `data-testid` attributes. See file for test IDs.
- **`__mocks__/platform-bible-utils.ts`** — Stubs util functions.
- **`__mocks__/lucide-react.tsx`** — Stubs icon components (`Trash2` → `data-testid="trash-icon"`, `Info` → `data-testid="info-icon"`).
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
