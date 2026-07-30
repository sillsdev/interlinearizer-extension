---
name: comment-rules
description: Rules for writing and editing comments in TypeScript. Use whenever adding or modifying doc comments or inline comments in .ts/.tsx files in this repo.
---

# Comment Rules

Accuracy first, then brevity. Delete any comment that restates what the signature and types already say.

The audience is the next reader of the code - never the reviewer of the current diff, never the coverage gate. Comments that defend a change, justify a test to a metric, or restate a repo-wide convention are noise.

Comments describe the code as it is; git owns the diff. Never narrate what code used to do, what a change replaced, or that call sites are unchanged - in any comment form. Tells: "now", "no longer", "previously", "replaced", "before the migration". (How current code handles legacy _data_ is present-tense behavior, and fine.)

## Doc comments

State what a thing is **for**, never **how** it works. How-test: would the sentence survive an equivalent reimplementation? If not it is a how, and a "so that…" clause does not redeem it - keep the purpose clause, drop the mechanism.

A doc comment must stand alone for someone hovering the symbol who will not read the body.

- Exported methods, classes, interfaces, types, constants: short summary.
- Private/internal symbols: only when non-obvious. Skip trivial getters, thin wrappers, self-evident helpers.

Module-level comments only when the module is a consumed API surface. No file-header banners. No section dividers that merely restate the adjacent symbol or `describe` name - a divider must carry information of its own. Keep `#region … shared with …` sync markers; they delimit template-synced code.

Unnamed inline callbacks passed to framework APIs (`describe()`, `test()`) are exempt - the test title is the documentation.

## Params, returns, and throws

Omit `@param`/`@returns` that only restate the signature and type. Keep ones carrying what the declaration cannot: units, nullability meaning, ownership, side effects, constraints, and the like (illustrative, not a checklist). Never `@param name - the name`.

**All-or-nothing (overrides the omit rule):** never document only some of a method's parameters. When one deserves a note, either:

- **Document every parameter**, including ones you would otherwise omit - when each has something real to say; never pad.
- **Fold the note into the summary prose** and drop the tag - when the rest would be padding. Folding edits the summary: rewrite it to take the note; "the summary doesn't already say this" is no reason to keep the tag.

A fold is prose about what the function does. A parameter name may appear as what the function acts on - "Removes the record matching `phraseId`" - but not as the sentence's subject: "`link` overrides the joining link" is an `@param` minus the tag. If the sentence would read the same with `@param` in front, document every parameter instead.

Where a note belongs: what the call **does** with an argument ("used in the thrown error message", "matched against the pool") folds; what qualifies the **value** - units, meaning of absence, ownership, a constraint the type cannot express - stays a tag. This governs one-parameter functions too: a lone `@param` whose only content is what the argument is for is a fold waiting to happen - do not leave it in place.

**No double documentation.** A fact lives in the summary or in a tag, never both.

**No mirrored field docs.** When a parameter's type documents its own fields (a props type, an options interface), do not restate them as `@param` - the field docs are the single source of truth. `@param props - Component props` is always wrong; anything a tag would add goes into the field doc instead.

**Start from the return type.** A self-describing type needs no `@returns`. Write one when the type under-describes the value:

- **several possible outcomes** - a union, a `T | undefined`, or a bare `boolean` the name does not settle. The most common earner: name what produces each arm, not merely that arms exist. A type predicate (`v is Token`) and a `Promise<void>` are self-describing - no tag.
- an **inline composed shape** documented nowhere else - a returned tuple, an object literal assembled by a hook. A named return type documents its own fields; restating them is the mirrored-field-docs mistake.
- a **fixed or constrained value** - always `false`, an empty array rather than `undefined`
- a **transformation** the type doesn't show - normalized, sorted, deduped, cloned
- something **synthesized** by the call - a generated id, a defaulted field
- a **test-visible contract** a fixture guarantees - a `data-testid`, a specific element shape

For `Promise<void>` the question is **when it resolves**; only non-obvious timing earns a tag. "Resolves once `exitSignal` settles, or once `timeoutMs` elapses - whichever is first" - yes; "Resolves when cleanup is complete" is the type in different words.

Delete a `@returns` that re-says the type: `@returns The render result.` on `RenderResult`, `@returns Nothing.` on `void`, `@returns JSX element.` on a component.

The bullets are the test. When dropping a tag feels lossy, the subtlety is about what the function does - put it in the summary, not in a padded `@returns`.

`@throws` for every error condition the caller must handle; omit it when the function never throws.

## Type declarations

Interfaces, type aliases, and enums follow the same rules. Document each field or member whose purpose is not self-evident from its name and type, individually rather than in the type-level summary.

## References to other code

Any mention of named code is a reference, whatever the markup - backticks or a reworded pointer alike. If the reader is expected to go find one specific symbol ("the loader's dispatch"), it is a reference however worded: link it or cut it. Prose that stays true whatever the neighbor is named ("the arc-measurement pass") is description, and fine. Reference other code only when the reader needs it to understand **this** symbol - never for completeness or navigation.

Write a necessary reference as TSDoc `{@link}`: `{@link SomeType}`, `{@link someFunction}` - types, exported functions, components, hooks, and constants may all be linked. In `//` comments, where tooling does not process `{@link}`, write the bare name; the necessity test still applies. Never reference another function's locals, another module's private internals, or a test file - describe the behavior instead.

**Link the contract, not the collaborator (overrides the necessity test):** naming the helper a symbol delegates to - "resolves through `resolveApprovedAnalysis`", "forks via `forkSharedAnalysis`" - documents _how_ it works, and no reference form makes that acceptable, even same-file. State what the delegation guarantees and leave the callee unnamed. Rewrite rather than delete; the guarantee is the useful half.

Linking a **constant** stays encouraged - it is how the values rule below avoids restating a literal.

**Never document consumers.** "Shared by X and Y", "the only caller is…", "exported so X can…" document the callers and go stale silently. State what the symbol guarantees; callers stay anonymous. Same for provenance - "extracted from X" says where code came from, not what it is for.

## Values, counts, and enumerations

Never restate in prose a value, count, or member list that code declares: "the four fade wrappers (curtain, toggle, list, strip)", "the timeout (500ms)", "all three storage properties". Nothing keeps the copy in sync. Name the constant and use quantity-free phrasing: "the fade wrappers", "longer than {@link TIMEOUT_MS}", "the `*Ref` fields".

## Inline comments

Sparingly: only when the reasoning is not clear from the code, or a bugfix is non-obvious. Keep them short - reasoning that outgrows a few sentences belongs on the nearest doc comment, not interleaved with statements - and about the code they sit next to.

In tests, two extra tells of noise: restating the test title or narrating steps the code shows, and justifying the test to the coverage gate ("covers the false branch of…"). Why a module is mocked, or why fixture geometry is shaped as it is, stays fine - that is reasoning the code cannot show.
