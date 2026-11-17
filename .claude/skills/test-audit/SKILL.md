---
name: test-audit
description: Audits test quality in Jest and TUnit tests. Use after adding or editing a Jest `describe` block or a TUnit test class; it then audits only what you edited.
---

# Test Audit

Audits tests against the checks below. A Jest `describe` block and a TUnit test class are the same unit here, called a **block**.

## 1. Fix the scope and mode

- **Edit mode**: you invoked this yourself after adding or editing blocks. The scope is those blocks, plus any file-level setup they use. Leave the rest of the file alone.
- **Audit mode**: the user invoked `/test-audit`. The scope is what they named: a file, a directory, or a branch (its test files in `git diff --name-only origin/main...<branch>`, or against its PR base when that isn't `main`). Ask if they named nothing. When the scope has more files than you can read in full, dispatch one subagent per directory and give each this skill's path. Then merge their findings.

Done when you can list every block in scope.

## 2. Read the context

Read these before judging anything:

- The Jest shared builders: [test-helpers.ts](../../../src/__tests__/test-helpers.ts) and [components/test-helpers.tsx](../../../src/__tests__/components/test-helpers.tsx).
- The TUnit shared builders: [Fixtures.cs](../../../c-sharp/InterlinearizerCrdt.Tests/Fixtures.cs) and [CrdtTestBase.cs](../../../c-sharp/InterlinearizerCrdt.Tests/CrdtTestBase.cs).
- For Jest, the `## Testing` section of [AGENTS.md](../../../AGENTS.md) and the conformance-suite paragraph under `### Project storage`.
- [REVIEW.md](../../../REVIEW.md), mainly "Mock cleanup in tests" and "A `title` in a test assertion…". It lists patterns that look wrong here and are not.
- The code under test, whenever a check needs to know what it does.

## 3. Apply every check to every test in scope

The checks are a flat set. Run each one against each test; a check that finds nothing is still a check run.

Tooling already enforces three things, so leave them to it: `as` casts (ESLint `no-type-assertion`), TUnit assertions missing an `await` (TUnit's analyzer, which fails the build under `TreatWarningsAsErrors`), and `console.error`/`console.warn` calls (`jest.environment.ts` fails the test).

### Names

A test title is a **claim**; its body is the **evidence**. Flag a title that the assertions don't back, a body that asserts something the title doesn't mention, and a title vague enough that a reader can't predict the assertions ("works", "handles X"). A block's name should describe what its tests share. Two tests in one block with near-identical titles usually mean one title is wrong.

### Mock hygiene

- Each test gets its mock implementations from its own body or a `beforeEach`. `resetMocks` clears them before every test, the first included, so anything set at file load or in `beforeAll` is gone before any test runs.
- Every mock that is set up gets exercised. Every mock implementation a test sets either matters to its outcome or is asserted on.
- Assertions land on outcomes the user or caller sees. A `toHaveBeenCalledWith` on an internal collaborator is a finding when the outcome is assertable. It is fine when the call is the outcome, such as a PAPI command being registered.
- Manual cleanup covers only what `restoreMocks` can't undo, such as a reassigned global. Spies restore themselves.
- Module-level state the code keeps gets reset between tests (for example, `resetQueuesForTesting()`).

### Redundant tests: merge

Flag tests that share their setup and assert the same behavior, with inputs that reach the same branch. Merge them into one test, or into a `test.each` / `[Arguments]` table when the inputs are worth listing. Keep tests separate when they cover the two sides of a branch that carries real behavior; AGENTS.md requires that.

### Overloaded tests: split

Flag a test that checks independent behaviors, where the first failing assertion would hide the rest. Common tells are a title joined with "and" and an arrange-act-assert sequence that runs twice. Keep the assertions together when they describe one outcome from different angles.

### Rewritten test objects: share

- A hand-built token, segment, book, project, or change literal where a shared builder already makes one: use the builder, overriding only the fields the test cares about.
- The same literal repeated across tests in one file: hoist it to a file-level constant when no test mutates it, otherwise to a builder that returns a fresh copy.
- A new builder belongs in the shared helpers only when more than one file needs it. Otherwise keep it in the file.

### Rewritten test structure: share, but clarity wins

Repeated arrange steps can move to a `beforeEach` or a local helper. A test must still read top to bottom without a reader jumping away to learn what makes it different. Keep each test's distinguishing inputs, its act, and its assertions in the test body. When the choice is between a longer, explicit test and an abstraction, take the longer test.

The check runs in both directions. Flag the duplicated structure, and also flag an existing abstraction that hurts reading: a helper with boolean or mode parameters, a `setup(options)` that every test configures differently, or a helper that hides assertions.

### AGENTS.md rules (Jest)

Apply every rule in the `## Testing` section and the conformance-suite placement rule. Behavior every `AnalysisRepository` owes goes in the suite; behavior particular to one implementation goes in that implementation's tests. A test that exists only to cover a branch AGENTS.md lists as not worth testing is a finding; the fix is a `/* v8 ignore next */` with a reason.

### Render weight (Jest)

Flag a test that renders a component only to reach a hook or context. Tells: a throwaway harness component whose buttons drive dispatchers, or a full component tree whose DOM the assertions never read beyond values the hook returns. The fix is `renderHook` with a provider `wrapper`, following `### Testing hooks` in AGENTS.md. Keep the render when the test needs the DOM: rendered output, render counts, or mount and unmount.

### Assertion strength

- Each test is **falsifiable**: name the bug that would turn it red. Flag a test where no plausible bug would.
- Flag a test with no assertion, a weak matcher (`toBeTruthy`, `toBeDefined`, `not.toThrow` alone) where the exact value is known, and a snapshot used as the only assertion.
- Flag an expected value computed by the same logic as the code under test. A literal expected value is the evidence; a mirrored one proves nothing.
- A mock-call assertion is as precise as the test needs. `toHaveBeenCalledWith` passes when any call matched. When order or count matters, use `toHaveBeenNthCalledWith`, `toHaveBeenLastCalledWith`, or `toHaveBeenCalledTimes`.
- `toEqual` ignores `undefined` fields and class types. Use `toStrictEqual` when either is part of the behavior.
- DOM state gets a jest-dom matcher (`toBeDisabled`, `toHaveValue`, `toBeChecked`) rather than a raw property comparison, so a failure says what is wrong.

### Async and isolation

- Jest: every promise, `act`, and user-event call is awaited.
- Each test passes when it runs alone (`--testNamePattern`) and in any order. Flag reliance on state an earlier test left.
- Setup lives in hooks or the test body. Jest runs every `describe` body when it collects the file, before any test, so state built there is shared by all of them.
- Fake timers get switched back with `jest.useRealTimers()` in the test or an `afterEach`.
- TUnit: instance fields are already fresh for each test. Flag mutable `static` state that lets one test see another's writes, and shared resources such as files or databases, because TUnit runs tests in parallel by default. `readonly` protects only the reference, so a `static readonly` collection or other mutable object is still shared state. `static readonly` values of immutable types and thread-safe counters that only hand out unique values are safe.

### Queries and interactions (Jest)

- Queries go through `screen`, by role first, then by label or text. `getByTestId` is right for the stubbed `platform-bible-react` components, which expose test ids by design, and for modal titles. Flag `container.querySelector` where a `screen` query works.
- `get*` and `find*` assert presence; `query*` only asserts absence.
- Content that appears asynchronously gets `findBy*` rather than `waitFor` around a `getBy*`. A `waitFor` callback holds one assertion and no actions. An empty callback is a finding.
- Interactions go through user-event, from a `userEvent.setup()` called before the render. `fireEvent` is right only for an event user-event can't simulate.
- `act` wraps only what React Testing Library doesn't. `render`, `renderHook`, and user-event calls already run inside it. Dispatcher calls in `renderHook` tests still need it.

### Fixture noise

- A fixture carries only the fields that matter to the test, and builder defaults supply the rest. Fields that don't matter hide the ones that do. Fixtures that are fully populated on purpose, like those in `Fixtures.cs`, are exempt.
- A value the assertions depend on is named or plainly derived. Flag a magic number whose role the reader has to reverse-engineer.

## 4. Act on the findings

- **Edit mode**: fix each finding inside your edited blocks as part of the edit. If a fix would reach outside them (a new shared builder, or a merge with a test you didn't touch), name it to the user in one line instead.
- **Audit mode**: report and wait. Group findings by file. Give each one a location (`path:line`), the check, the claim and evidence, and a proposed fix, in a line or two. Below the report, list every file audited, including those with no findings. Fix nothing until the user approves, then apply what they approved.
