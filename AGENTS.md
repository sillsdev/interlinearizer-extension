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

- `activate(context)` — registers the `interlinearizer.mainWebView` WebView provider, the `interlinearizer.openForWebView` command, and `onDidOpenWebView` / `onDidCloseWebView` subscriptions. All registrations are added to `context.registrations` so the platform disposes them on deactivation.
- `deactivate()` — clears `openWebViewsByProject` and returns `true`.

`openWebViewsByProject` (`Map<string, string>`) tracks one open WebView ID per project to prevent duplicates; reopening an already-open project brings that tab to front via the `existingId` option.

### WebView UI

`src/interlinearizer.web-view.tsx` — React component rendered inside Platform.Bible's WebView iframe. `useWebViewScrollGroupScrRef` is a **prop injected by the PAPI host** (not a hook import). Uses PAPI frontend hooks (`useProjectData`, `useProjectSetting`, `useLocalizedStrings`, `useRecentScriptureRefs`) to fetch live data. Renders verse segments as token chips with Tailwind utility classes (all prefixed `tw-`).

The WebView is injected into the main bundle via Webpack's `?inline` query:

```ts
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
```

`src/webpack-env.d.ts` declares the `*?inline`, `*?raw`, and `*.scss` module types that make these imports type-safe.

Two separate Webpack configs handle this: `webpack.config.web-view.ts` builds the React component into `temp-build/`, then `webpack.config.main.ts` copies it into `dist/` alongside contributions, public assets, and type declarations.

The WebView root component is assigned to `globalThis.webViewComponent` (not exported) — this is the PAPI WebView contract. Tests must `require()` the module and read `globalThis.webViewComponent` to get the component.

### Styling

All UI uses Tailwind CSS (via `src/tailwind.css`). Every Tailwind class is prefixed `tw-` to avoid collisions with Platform.Bible's own styles (configured in `tailwind.config.ts`).

### Parser pipeline

Data flows from Platform.Bible's USJ (Unified Scripture JSON) format through two stages:

1. `src/parsers/papi/usjBookExtractor.ts` — converts USJ to the internal `Book` type
2. `src/parsers/papi/bookTokenizer.ts` — segments and tokenizes the book into `Segment`/`Token` structures with character offsets

`src/parsers/pt9/interlinearXmlParser.ts` — separately parses Paratext 9 interlinear XML into the alignment model. The XML schema is documented in `src/parsers/pt9/pt9-xml.md`.

### Data model (`src/types/interlinearizer.d.ts`)

The core types are:

- `InterlinearAlignment` — top-level bilingual container (source + target `InterlinearText`)
- `Book → Segment → Token` — the text hierarchy
- `TextAnalysis` — flat analysis layer keyed by id (does **not** mirror text hierarchy)
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

**`__mocks__/papi-backend.ts`** — exposes `papi.commands`, `papi.dialogs`, `papi.webViewProviders`, and `papi.webViews` as jest fns. Internal mock references are re-exported on the default export as `__mock*` properties so tests can assert on them without re-importing:

| Property                              | Jest fn                                    |
| ------------------------------------- | ------------------------------------------ |
| `papi.__mockRegisterWebViewProvider`  | `webViewProviders.registerWebViewProvider` |
| `papi.__mockRegisterCommand`          | `commands.registerCommand`                 |
| `papi.__mockOpenWebView`              | `webViews.openWebView`                     |
| `papi.__mockSelectProject`            | `dialogs.selectProject`                    |
| `papi.__mockGetOpenWebViewDefinition` | `webViews.getOpenWebViewDefinition`        |
| `papi.__mockOnDidOpenWebView`         | `webViews.onDidOpenWebView`                |
| `papi.__mockOnDidCloseWebView`        | `webViews.onDidCloseWebView`               |
| `papi.__mockLogger`                   | `logger` (debug/error/info/warn)           |

**`__mocks__/papi-frontend.ts`** — stubs `logger` only (debug/error/info/warn as jest fns). Used by WebView tests that import from `@papi/frontend`.

**`__mocks__/papi-frontend-react.ts`** — stubs `useProjectData` (returns a `Proxy` whose properties return `[undefined, jest.fn(), false]`), `useProjectSetting` (returns `[defaultState, jest.fn(), jest.fn(), false]`), `useLocalizedStrings` (maps each key to itself), and `useRecentScriptureRefs` (returns empty array + no-op setter).

**`__mocks__/papi-core.ts`** — empty module (`{}`). `@papi/core` is types-only at runtime; this mock exists only for module resolution.

**`__mocks__/platform-bible-react.tsx`** — stubs `TabToolbar`, `BookChapterControl`, and `ScrollGroupSelector`. `TabToolbar` renders `data-testid="tab-toolbar"`, `data-testid="tab-toolbar-start"`, and `data-testid="tab-toolbar-end"` divs containing its start/end children — use these test IDs to find child controls in tests. `ScrollGroupSelector` renders a `<select data-testid="scroll-group-selector">`. `BookChapterControl` renders `data-testid="book-chapter-control"` with a Submit button.

**`__mocks__/platform-bible-utils.ts`** — stubs `UnsubscriberAsyncList` (used by `test-helpers.ts`) and `isPlatformError` (used by the WebView).

**`__mocks__/web-view-inline.ts`** — stubs the `*.web-view?inline` import as a null-returning React component so `main.ts` tests can import without pulling in React.

**`__mocks__/styleInlineMock.ts`** / **`styleMock.ts`** / **`fileMock.ts`** — stub `.scss?inline`, `.scss`, and static asset imports respectively.

**`src/__tests__/test-helpers.ts`** — `createTestActivationContext()` builds a minimal `ExecutionActivationContext` for testing `activate()` without type assertions.

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
