---
name: comment-rules
description: Rules for writing and editing comments in TypeScript. Use whenever adding or modifying doc comments or inline comments in .ts/.tsx files in this repo.
---

# Comment Rules

Accuracy first, then brevity. Delete any comment that restates what the signature and types already say.

The audience is the next reader of the code - never the reviewer of the current diff, never the coverage gate. Comments that defend a change, justify a test to a metric, or restate a repo-wide convention are noise.

Comments describe the code as it is; git owns the diff. Never narrate what code used to do, what a change replaced, or that call sites are unchanged. Tells: "now", "no longer", "previously", "replaced", "before the migration". (How current code handles legacy _data_ is present-tense behavior, and fine.)

## Doc comments

State what a thing is **for**, never **how** it works. How-test: would the sentence survive an equivalent reimplementation? If not, the sentence describes a how. A "so that…" clause does not redeem it: keep the purpose clause and drop the mechanism.

A doc comment must stand alone for someone hovering the symbol who will not read the body.

- Exported methods, classes, interfaces, types, constants: short summary.
- Private/internal symbols: only when non-obvious. Skip trivial getters, thin wrappers, self-evident helpers.

Module-level comments only when the module is a consumed API surface. No file-header banners. No section dividers that merely restate the adjacent symbol or `describe` name - a divider must carry information of its own. Keep `#region … shared with …` sync markers; they delimit template-synced code.

Unnamed inline callbacks passed to framework APIs (`describe()`, `test()`) are exempt - the test title is the documentation.

## Params, returns, and throws

Omit `@param`/`@returns` that only restate the signature and type. Keep ones carrying what the declaration cannot. Never `@param name - the name`.

**All-or-nothing (overrides the omit rule):** never document only some of a method's parameters. When one deserves a note, either:

- **Document every parameter**, when each has something real to say.
- **Fold the note into the summary prose** and drop the tag, when the other tags would be padding. Folding means rewriting the summary to carry the note, so a summary that lacks it is no reason to keep the tag.

A fold is prose about what the function does. A parameter name may appear as the thing the function acts on: "Removes the record matching `phraseId`". The name may not be the sentence's subject. "`link` overrides the joining link" is an `@param` minus the tag. If the sentence would read the same with `@param` in front, document every parameter instead.

To decide where a note belongs, ask what it describes. A note on what the call **does** with an argument folds: "used in the thrown error message", "matched against the pool". A note that qualifies the **value** stays a tag: units, the meaning of absence, ownership, or a constraint the type cannot express. The rule applies to a lone `@param` too.

**No double documentation.** A fact lives in the summary or in a tag, never both.

**No mirrored field docs.** Some parameter types document their own fields, such as a props type or an options interface. Do not restate those fields as `@param` tags; the field docs are the single source of truth. `@param props - Component props` is always wrong. Put anything a tag would add into the field doc instead.

**Start from the return type.** A self-describing type needs no `@returns`. Write one when the type under-describes the value:

- **several possible outcomes**: a union, a `T | undefined`, or a bare `boolean` whose meaning the function name does not settle. Name what produces each arm, not merely that arms exist. A type predicate (`v is Token`) and a `Promise<void>` do not count as several outcomes.
- an **inline composed shape** documented nowhere else - a returned tuple, an object literal assembled by a hook.
- a **fixed or constrained value** - always `false`, an empty array rather than `undefined`
- a **transformation** the type doesn't show - normalized, sorted, deduped, cloned
- something **synthesized** by the call - a generated id, a defaulted field
- a **test-visible contract** that a fixture guarantees - a `data-testid`, a specific element shape

For `Promise<void>` the question is **when it resolves**; only non-obvious timing earns a tag. "Resolves once `exitSignal` settles, or once `timeoutMs` elapses - whichever is first" - yes; "Resolves when cleanup is complete" is the type in different words.

Delete a `@returns` that re-says the type: `@returns The render result.` on `RenderResult`, `@returns Nothing.` on `void`, `@returns JSX element.` on a component.

When dropping a tag feels lossy, the subtlety is about what the function does - put it in the summary, not in a padded `@returns`.

Match the neighbors: one surface folds or tags its outcomes, never both.

`@throws` for every error condition the caller must handle.

## Type declarations

Interfaces, type aliases, and enums follow the same rules. Document each field or member whose name and type leave its purpose unclear. Put that doc on the field or member itself, not in the type-level summary.

## References to other code

Any mention of named code is a reference, whatever the markup - backticks or a reworded pointer alike. A phrase that sends the reader to find one specific symbol ("the loader's dispatch") is a reference however it is worded: link it or cut it. Prose that stays true whatever the neighbor is named ("the arc-measurement pass") is description, and fine. Reference other code only when the reader needs it to understand **this** symbol - never for completeness or navigation.

Write a necessary reference as TSDoc `{@link}`: `{@link SomeType}`, `{@link someFunction}` - types, exported functions, components, hooks, and constants may all be linked. In `//` comments, where tooling does not process `{@link}`, write the bare name; the necessity test still applies. Never reference another function's locals, another module's private internals, or a test file - describe the behavior instead.

**Link the contract, not the collaborator (overrides the necessity test).** Naming the helper that a symbol delegates to documents _how_ the symbol works: "resolves through `resolveApprovedAnalysis`", "forks via `forkSharedAnalysis`". No reference form makes that acceptable, even within the same file. State what the delegation guarantees and leave the callee unnamed. Rewrite rather than delete, because the guarantee is the useful half.

**Never document consumers.** "Shared by X and Y", "the only caller is…", "exported so X can…" document the callers and go stale silently. State what the symbol guarantees; callers stay anonymous. Same for provenance - "extracted from X" says where code came from, not what it is for.

## Values, counts, and enumerations

Never restate in prose a value, count, or member list that code declares: "the four fade wrappers (curtain, toggle, list, strip)", "the timeout (500ms)", "all three storage properties". Nothing keeps the copy in sync. Name the constant and use quantity-free phrasing: "the fade wrappers", "longer than {@link TIMEOUT_MS}", "the `*Ref` fields".

A parameter's default is the one exception, because a call site's hover shows `timeoutMs?: number`, not the literal. State the default when absence carries meaning. Never state it as a bare magic number: hoist the value to a named constant and link the constant.

## Inline comments

Write inline comments sparingly: only when the code does not make the reasoning clear, or when a bugfix is non-obvious. Keep each one short and about the code beside it. Reasoning that outgrows a few sentences belongs on the nearest doc comment, not interleaved with statements.

In tests, two extra tells of noise: restating the test title or narrating steps the code shows, and justifying the test to the coverage gate ("covers the false branch of…"). Why a module is mocked, or why fixture geometry is shaped as it is, stays fine - that is reasoning the code cannot show.

## Sentences

Every comment sentence parses on the first read. Check each one by reading it once at normal speed: if you backtracked or had to choose between two readings, rewrite it.

- **One claim per sentence.** Two independent claims spliced with a comma, or chained with "and", "so", or "which", make a run-on. Split them, or join with a semicolon when the second explains the first.
- **Short sentences, short paragraphs.** Keep sentences under about 25 words. A sentence that needs nested clauses or a parenthetical to hold together is two sentences. A paragraph carries one idea; a doc comment with several ideas gives each its own paragraph, summary first.
- **One reading per word.** When "it", "this", or "that" has more than one candidate antecedent, name the noun. Write "because" for cause and "whereas" for contrast; "since" and "while" also read as time. Place "only" directly before what it limits. Domain words (token, phrase, segment, link, analysis) carry only their domain meaning; reach for a synonym in the everyday sense.
- **Commit the reader to the right parse.** A garden-path sentence opens with a parse its ending overturns. Keep the optional "that" after verbs like verifies, ensures, and assumes: "Verifies that the segment boundaries match the source", not "Verifies the segment boundaries match the source". Put a comma after an introductory clause: "Because the store updates, links are re-resolved". Place each modifier beside what it modifies; in "Clears the cache the loader fills when the project changes", the reader cannot tell which action happens on project change.
