# REVIEW.md

This file provides guidance to AI agents **reviewing** code in this repository. It documents existing conventions that commonly trigger false-positive findings, so reviewers don't flag intentional, already-handled patterns as issues.

Agents creating or editing code should follow [AGENTS.md](AGENTS.md); this file is supplementary and review-specific.

## Tailwind v4 at-rules

Tailwind v4 at-rules (`@utility`, `@apply`, `@theme`, `@config`, `@custom-variant`, `@layer`, `@source`, `@plugin`, etc.) are **already whitelisted** in [.stylelintrc.js](.stylelintrc.js)'s `scss/at-rule-no-unknown` `ignoreAtRules` list. Do **not** flag these as Stylelint violations, and do not suggest adding them to the config or adding `stylelint-disable` comments — they already pass. If you believe a lint rule is firing, run `npm run lint` and cite the actual output rather than inferring it from the rule name.

## Documentation completeness

Type declarations document each field individually rather than describing the fields in the type-level summary. When each field already carries its own JSDoc comment, the documentation is **complete** — do not flag it as inadequate, and do not ask for per-field details to be repeated or summarized in the type-level doc. The type-level summary describes the type as a whole; the per-field comments describe the fields. Only flag a field that is genuinely missing its own comment.

Before reporting any documentation as missing, open the file and confirm the JSDoc is actually absent. Do not infer missing docs from a symbol name, a type signature, or an excerpt — read the declaration.

## Absent `@param` and `@returns` tags

Most functions here carry no `@param` or `@returns` tags. That is intentional, not an oversight: the [comment-rules skill](.claude/skills/comment-rules/SKILL.md) — the authority, worth opening before any tag-related finding — requires omitting a tag that would only restate the signature and type. A doc comment with a prose summary and no tags is therefore **complete**. Do not flag it as under-documented, and do not ask for tags so a block matches its neighbors. A summary that names a parameter while describing what the function does is the sanctioned alternative to an `@param`, not a tag someone forgot.

Two shapes are still worth reporting: a **partial** block, where some but not all parameters are documented, which is the one arrangement the rule rejects outright; and a function that throws without an `@throws`, which is required for every error condition a caller must handle.

## `{@link}` targets

`{@link}` references to functions, components, hooks, and constants are sanctioned, not just references to types — the comment-rules skill permits linking any named declaration. Do not flag a non-type `{@link}` target as a violation; what the skill bans is documenting consumers/callers and referencing another function's locals or private internals.

## Keyboard navigation

Keyboard accessibility is planned but not yet implemented. Do not flag missing `tabIndex` attributes, absent `aria-*` roles, or gaps in focus management as issues — these will be addressed in a dedicated pass once the core interaction model is stable.

## Buttons inside the TokenChip label

The `<label>` in [src/components/TokenChip.tsx](src/components/TokenChip.tsx) contains a `<button>` (the morpheme trigger) when morphology is shown, which technically violates the HTML content model for `<label>` (no labelable descendants other than the labeled control). This is **intentional and already handled**: the explicit `htmlFor` binding to the gloss input takes precedence over implicit control resolution in all browsers, and the label's mouse-down handler explicitly routes focus around inputs and buttons. The comment above the label in that file documents the reasoning. Do not flag this as a spec violation or suggest restructuring the markup — moving the morpheme row outside the label would break click-to-focus on the chip body.

## Release body placeholders

[.github/workflows/verify-release.yml](.github/workflows/verify-release.yml) fails a published release whose body still carries an unfilled `<Studio version>` or `interlinearizer_<version>.zip` placeholder. Going red when a release is published without the `studioVersion` input is **intentional**: the install steps would name a zip that cannot exist, leaving readers stuck. The release checklist in [README.md](README.md) tells the maintainer to fill the placeholder in on the draft, and the `edited` trigger re-runs the check so a correction turns the release green. Do not propose softening either placeholder check to a warning.

The neighboring Studio-zip check _is_ a warning, which is not an inconsistency. A body naming a Studio zip that is not attached is an error; a body naming **no** Studio zip is only a warning, because attaching the application build is temporary and a body that sends readers to Paratext 10 Studio's own releases instead is right not to name one.

## Mock cleanup in tests

[jest.config.ts](jest.config.ts) sets both `resetMocks: true` and `restoreMocks: true`. This means every `jest.spyOn(...)` is automatically restored to its original implementation after each test — tests do **not** need a manual `mockRestore()` or `jest.restoreAllMocks()` in `afterEach` for spies. Do not flag spies as leaking or suggest adding cleanup for them.

Manual cleanup in `afterEach` is only required for state that `restoreMocks` cannot undo, such as plain reassignment of a global (e.g. `global.ResizeObserver = ...`). When you see an `afterEach` restoring only some things, confirm whether the rest are spies (auto-restored) before flagging an omission.
