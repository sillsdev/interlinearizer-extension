---
name: comment-rules
description: Rules for writing and editing comments in TypeScript. Use whenever adding or modifying doc comments or inline comments in .ts/.tsx files in this repo.
---

# Comment Rules

Priorities when writing comments: accuracy first, then brevity. A comment must earn its place - if it restates what the signature and types already say, delete it.

A comment's audience is the next reader of the code - never the reviewer of the current diff and never the coverage gate. A comment that defends a change, justifies a test's existence to a metric, or restates a convention already documented repo-wide is noise.

Comments describe the code as it is; git owns the diff. Never narrate what the code used to do, what a change replaced, or that call sites are unchanged - in any comment form. "Now", "no longer", "previously", "replaced", and "before the migration" are the usual tells. (Describing how current code handles legacy _data_ is fine - that is present-tense behavior.)

## Doc comments

State **what a thing is for and why it exists**. Never explain **how** it works - the code shows that.

The test for a **how**: would the sentence still be true after an equivalent reimplementation? If not, it is a how - and appending a "so that…" purpose clause does not turn it into a why. Keep the purpose clause, drop the mechanism it was defending.

A doc comment must stand alone: someone hovering over the symbol, who will not read the body, should understand its purpose from the comment.

Required vs optional:

- Exported methods, classes, interfaces, types, and constants: give a short summary.
- Private/internal symbols: comment only when the purpose is non-obvious. Skip trivial getters, thin wrappers, and self-evident helpers.

Module-level comments are worthwhile only when the module is a consumed API surface. Do not add file-header banners, and do not add section dividers that merely restate the name of the adjacent symbol or `describe` block - a divider must carry information of its own. Leave `#region … shared with …` sync markers intact; they delimit template-synced code, not decoration.

These rules do not apply to unnamed inline callbacks passed directly to framework APIs (e.g. `describe()`, `test()`) - the test-title string serves as the documentation.

## Params, returns, and throws

Omit `@param` and `@returns` when they only restate the signature and type. Keep them when they carry something the declaration cannot - units, nullability meaning, ownership, side effects, constraints, and anything else in that spirit. That list is illustrative, not a checklist to match against. Never write `@param name - the name`.

**All-or-nothing, and this overrides the omit rule above:** never document only some of a method's parameters. A block with one `@param` on a three-parameter method reads as an oversight - the reader cannot tell whether the other two were judged self-evident or simply forgotten. So when one parameter deserves a note, pick one of:

- **Document every parameter**, including ones you would otherwise omit. Use this when each has something real to say. Write what each contributes to the call - never pad with `@param name - the name`.
- **Fold the note into the summary prose** and drop the `@param` entirely. Use this when the other parameters would only restate the signature, so documenting them all would mean writing exactly the padding the rule above forbids.

A fold has to be prose about what the function does. A parameter name may appear in it, as the natural way to say what the function acts on - "Removes the record matching `phraseId`" is a fold. What the prose may not do is make a parameter its subject: "`link` overrides the joining link" is an `@param` with the tag stripped off, and dodges the rule rather than satisfying it. If a sentence would read the same with `@param` in front of it, document every parameter instead.

**Folding is an edit to the summary, not a test of it.** Whether the summary already happens to carry the note is not the question - the question is whether the note belongs in prose. When it does, rewrite the summary to take it and drop the tag. Keeping a `@param` because "the summary doesn't say this" reads the rule backwards: the summary is the half you are free to change.

Which half a note belongs in: one that says what the call **does** with an argument - "used in the thrown error message", "matched against the pool" - is a sentence about the function, so it folds. One that qualifies the **value** - units, what an absent one means, ownership, a constraint the type cannot express - is about the argument itself and stays a tag. This test governs a one-parameter function too, where all-or-nothing is satisfied either way and the omit rule is doing all the work: a lone `@param` whose only content is what the argument is for is a fold waiting to happen, not a documented parameter.

Prefer whichever leaves the block honest. Do not resolve the tension by leaving the lone `@param` in place.

**No double documentation.** A fact belongs in the summary or in a tag, never both: a `@param` or `@returns` that repeats a sentence already in the summary is redundant, not borderline - keep one of the two.

**No mirrored field docs.** When a parameter's type declares its own documented fields (a props type, an options interface), do not restate those field docs as `@param` tags - the field docs are the single source of truth, and a second copy only drifts. `@param props - Component props` is the padding form of this and is always wrong; if a tag would carry something the field doc lacks, move it into the field doc instead.

**Start from the return type.** A single, self-describing type needs no `@returns` - the signature already says it. Write one when the type under-describes the value:

- **several possible outcomes** - a union, a `T | undefined`, or a bare `boolean` whose two sides the name does not settle. This is the most common earner: name what produces each arm, not merely that arms exist. Two shapes are already self-describing and take no tag - a type predicate (`v is Token`) states its own condition, and a `Promise<void>` has no arms at all.
- an **inline composed shape** whose parts are documented nowhere else - a returned tuple, or an object literal assembled by a hook. A named return type documents its own fields; restating them here is the mirrored-field-docs mistake above.
- a **fixed or constrained value** - always `false`, an empty array rather than `undefined`
- a **transformation** the type doesn't show - normalized, sorted, deduped, cloned
- something **synthesized** by the call - a generated id, a defaulted field
- a **test-visible contract** a fixture guarantees - a `data-testid`, a specific element shape

For `Promise<void>` the question is not what comes back but **when it resolves**, and only non-obvious timing is worth a tag. "Resolves once `exitSignal` settles, or once `timeoutMs` elapses - whichever is first" earns its place; "Resolves when cleanup is complete" on a cleanup function is the type in different words.

Delete a `@returns` that only re-says the type: `@returns The render result.` on a function returning `RenderResult`, `@returns Nothing.` on `void`, `@returns JSX element.` on a component.

The bullets are the test. When a function is subtle enough that dropping its tag feels lossy, the subtlety is about what the function does, not what it hands back - put it in the summary rather than padding `@returns` to hold it.

Include `@throws` for every error condition the caller must handle; omit it when the function never throws.

## Type declarations

Interfaces, type aliases, and enums follow the same doc-comment rules. Document each field or member whose purpose is not self-evident from its name and type, individually rather than in the type-level summary.

## References to other code

A reference is any mention of other named code, whatever the markup - a name in backticks is as much a reference as a bare one, and rewording it ("the loader's dispatch") only hides the coupling. Reference other code only when the reader needs it to understand **this** symbol - never for completeness or navigation.

Write a necessary reference as TSDoc `{@link}` so tooling can resolve it: `{@link SomeType}`, `{@link someFunction}`. A type, exported function, component, hook, or constant may all be linked. In `//` inline comments, where tooling does not process `{@link}`, write the bare name instead - the necessity test still applies. Never reference another function's locals, another module's private internals, or a test file; if the reference reaches into something the reader cannot see from the linked name, describe the behavior instead.

The line between describing and referencing: a phrase that points at one specific symbol the reader is expected to go find ("the loader's dispatch") is a reference however it is worded - link it or cut it. Prose that stays true regardless of what the neighboring code is named ("the arc-measurement pass") is description, and fine.

**Link the contract, not the collaborator. This is an exception to the necessity test above, and it overrides it:** naming the helper a symbol delegates to - "resolves through `resolveApprovedAnalysis`", "forks via `forkSharedAnalysis`" - documents _how_ the symbol works, and no reference form makes that acceptable. It holds even when the helper sits in the same file, where the link is cheapest and therefore most tempting. When the only reason to name something is that this code calls it, state what the delegation guarantees and leave the callee unnamed. Rewrite rather than delete: the guarantee is usually the useful half of the sentence, and cutting it loses information the link was carrying.

Linking a **constant** is the opposite case and stays encouraged - naming one is how the values rule below avoids restating a literal.

**Never document consumers.** "Shared by X and Y", "the only caller is…", "exported so X can…" document the callers, not the symbol; they go stale silently and add nothing to the contract. State what the symbol guarantees and let callers stay anonymous. The same goes for provenance - "extracted from X" says where code came from, not what it is for.

## Values, counts, and enumerations

Never restate in prose a value, count, or member list that code declares: "the four fade wrappers (curtain, toggle, list, strip)", "the timeout (500ms)", "all three storage properties". Nothing keeps the copy in sync. Name the constant and use quantity-free phrasing: "the fade wrappers", "longer than {@link TIMEOUT_MS}", "the `*Ref` fields".

## Inline comments

Use sparingly. Warranted only when the reasoning is not clear from the code, or when a bugfix introduces a non-obvious change. Keep them short - reasoning that outgrows a few sentences belongs on the nearest doc comment, not interleaved with statements - and always about the code they sit next to.

In tests, two extra tells of noise: comments that restate the test title or narrate steps the code shows, and comments that justify the test to the coverage gate ("covers the false branch of…"). Explaining why a module is mocked or why fixture geometry is shaped the way it is stays fine - that is reasoning the code cannot show.
