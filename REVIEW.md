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

[.github/workflows/publish.yml](.github/workflows/publish.yml) separately refuses to build a release from a tracked body that has **no** `<Studio version>` placeholder at all, which does not contradict that warning either. The body names the Studio version it goes with in a line of its own, above and beyond its install steps, so the placeholder is still there once the install steps stop naming a zip. Publishing a build that says nothing about which application version it goes with is the case that guard rules out, not publishing one that sends readers elsewhere for it.

The body these checks read is the substituted `release-body.md` **plus** the changelog that `generateReleaseNotes` appends, so in principle a merged pull request whose title quotes one of the placeholders verbatim would trip the placeholder check. That is accepted rather than overlooked: scoping the search to the text above GitHub's generated-notes heading would tie the workflow to undocumented heading text, and the release body stays editable after publishing, so reworking the offending line and letting `edited` re-run recovers it the same way a genuinely unfilled placeholder does. Do not propose anchoring the placeholder checks to part of the body. The checks that read a zip name out of the body are unaffected either way, because they take the first match and the substituted body precedes the changelog.

## The Alt-split hint names its key the way the platform's guideline does

The merge tooltip reads "Hold ⌥ and click between words to split" on a Mac and "Hold Alt …" elsewhere, with the key set in a `Kbd` and placed by a `{key}` placeholder so each translation decides where it goes ([src/components/alt-key-hint.tsx](src/components/alt-key-hint.tsx)). That is the platform's keyboard-shortcuts guideline followed straight: its "Preferred representations by OS" table maps Option/Alt to `⌥` on macOS, and `platform-scripture-editor` reads the same table the same way for Backspace and Delete. Do not propose spelling the glyph out as "Option", forking the sentence per OS, or dropping the `Kbd`.

The glyph is deliberately not localized — it is a symbol, not text, exactly as the platform treats its other Mac key symbols. The non-Mac word is a bare literal in `altKeyHint` ([src/components/alt-key-hint.tsx](src/components/alt-key-hint.tsx)) rather than a localize key, and that is equally deliberate: the platform's `getLocalizeKeyForPhysicalKey` covers only Backspace and Delete, so no localized name for this key exists to look up. That helper is not OS-aware either — the platform picks the Mac variant at the call site, exactly as this does. Do not propose routing the literal through localization until the platform names this key.

The merge control's **tooltip** runs its localized strings through `resolvedOrEmpty` ([src/utils/localized-strings.ts](src/utils/localized-strings.ts)) while its **`aria-label`** does not. That asymmetry is chosen, not overlooked: an unresolved `%…%` key is visible text in a tooltip, but an emptied `aria-label` would leave the icon button with no accessible name at all. Do not propose collapsing the two into one rule in either direction.

## A `title` in a test assertion does not mean the code renders a `title` attribute

Every tooltip in this extension goes through the platform `Tooltip`/`TooltipContent`, with one documented exception: the usage counts in [src/components/CatalogRowView.tsx](src/components/CatalogRowView.tsx) sit inside the row's own button, where a tooltip trigger would nest one interactive element in another, so they carry a native `title` and repeat their label in screen-reader-only text. Outside that exception, no component sets an HTML `title` attribute. Tests nevertheless assert `toHaveAttribute('title', …)` because the `Tooltip` stub in [\_\_mocks\_\_/platform-bible-react.tsx](__mocks__/platform-bible-react.tsx) reads its `TooltipContent` child's text and clones the trigger with that text as a `title`, which keeps the tooltip assertable without simulating hover in jsdom. The `title` **prop** some components take (the boundary button's, for one) is likewise just a prop name; it is rendered as `TooltipContent` children.

So do not conclude from either signal that a control is limited to plain text — for instance, that it cannot hold a `Kbd` or any other element. Read the component's own JSX before claiming a render path is text-only.

## Mock cleanup in tests

[jest.config.ts](jest.config.ts) sets both `resetMocks: true` and `restoreMocks: true`. This means every `jest.spyOn(...)` is automatically restored to its original implementation after each test — tests do **not** need a manual `mockRestore()` or `jest.restoreAllMocks()` in `afterEach` for spies. Do not flag spies as leaking or suggest adding cleanup for them.

Manual cleanup in `afterEach` is only required for state that `restoreMocks` cannot undo, such as plain reassignment of a global (e.g. `global.ResizeObserver = ...`). When you see an `afterEach` restoring only some things, confirm whether the rest are spies (auto-restored) before flagging an omission.

## The upstream packages are readable, so check them

`platform-bible-react` and `platform-bible-utils` both resolve through `file:../paranext-core/lib/…`, so a working checkout has the real packages installed under `node_modules/`. Before claiming a stub in [\_\_mocks\_\_/platform-bible-react.tsx](__mocks__/platform-bible-react.tsx) or [\_\_mocks\_\_/platform-bible-utils.ts](__mocks__/platform-bible-utils.ts) might diverge from what it stands in for, read the real source and say what it actually does. The bundles are minified and re-exported through short aliases, so trace the export name back through the alias chain rather than grepping for the public name alone. A finding that only observes that the two _could_ disagree is not a finding.

`isMacOs` in particular has been checked: the real helper is `/Macintosh/i.test(navigator.userAgent)`, which is what the stub does, so a test that needs the macOS answer stubs `navigator.userAgent`. Do not re-raise it.

So has `formatReplacementStringToArray`, and it settles the standard a mock is held to: fidelity to the real function, not what a reader would design fresh. It resolves replacer keys with `key in replacers`, so an inherited name like `{toString}` really does substitute `Object.prototype.toString` — verified by running the installed package. The mock matches that deliberately. Do not propose an own-property check (`hasOwnProperty`), which would make the mock disagree with the code it stands in for and hide that behavior from tests.
