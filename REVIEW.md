# REVIEW.md

This file provides guidance to AI agents **reviewing** code in this repository. It documents existing conventions that commonly trigger false-positive findings, so reviewers don't flag intentional, already-handled patterns as issues.

Agents creating or editing code should follow [AGENTS.md](AGENTS.md); this file is supplementary and review-specific.

## Tailwind v4 at-rules

Tailwind v4 at-rules (`@utility`, `@apply`, `@theme`, `@config`, `@custom-variant`, `@layer`, `@source`, `@plugin`, etc.) are **already whitelisted** in [.stylelintrc.js](.stylelintrc.js)'s `scss/at-rule-no-unknown` `ignoreAtRules` list. Do **not** flag these as Stylelint violations, and do not suggest adding them to the config or adding `stylelint-disable` comments — they already pass. If you believe a lint rule is firing, run `npm run lint` and cite the actual output rather than inferring it from the rule name.

## Documentation completeness

Type declarations document each field individually rather than describing the fields in the type-level summary. When each field already carries its own JSDoc comment, the documentation is **complete** — do not flag it as inadequate, and do not ask for per-field details to be repeated or summarized in the type-level doc. The type-level summary describes the type as a whole; the per-field comments describe the fields. Only flag a field that is genuinely missing its own comment.

Before reporting any documentation as missing, open the file and confirm the JSDoc is actually absent. Do not infer missing docs from a symbol name, a type signature, or an excerpt — read the declaration.

## Keyboard navigation

Keyboard accessibility is planned but not yet implemented. Do not flag missing `tabIndex` attributes, absent `aria-*` roles, or gaps in focus management as issues — these will be addressed in a dedicated pass once the core interaction model is stable.

## Mock cleanup in tests

[jest.config.ts](jest.config.ts) sets both `resetMocks: true` and `restoreMocks: true`. This means every `jest.spyOn(...)` is automatically restored to its original implementation after each test — tests do **not** need a manual `mockRestore()` or `jest.restoreAllMocks()` in `afterEach` for spies. Do not flag spies as leaking or suggest adding cleanup for them.

Manual cleanup in `afterEach` is only required for state that `restoreMocks` cannot undo, such as plain reassignment of a global (e.g. `global.ResizeObserver = ...`). When you see an `afterEach` restoring only some things, confirm whether the rest are spies (auto-restored) before flagging an omission.
