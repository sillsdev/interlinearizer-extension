---
name: comment-rules
description: Rules for writing and editing comments in TypeScript. Use whenever adding or modifying doc comments or inline comments in .ts/.tsx files in this repo.
---

# Comment Rules

Priorities when writing comments: accuracy first, then brevity. A comment must earn its place - if it restates what the signature and types already say, delete it.

## Doc comments

State **what a thing is for and why it exists**. Never explain **how** it works - the code shows that.

A doc comment must stand alone: someone hovering over the symbol, who will not read the body, should understand its purpose from the comment.

Required vs optional:

- Exported methods, classes, interfaces, types, and constants: give a short summary.
- Private/internal symbols: comment only when the purpose is non-obvious. Skip trivial getters, thin wrappers, and self-evident helpers.

Module-level comments are worthwhile only when the module is a consumed API surface. Do not add file-header banners.

These rules do not apply to unnamed inline callbacks passed directly to framework APIs (e.g. `describe()`, `test()`) - the test-title string serves as the documentation.

## Params, returns, and throws

Omit `@param` and `@returns` when they only restate the signature and type. Keep them when they carry something the declaration cannot - units, nullability meaning, ownership, side effects, constraints, and anything else in that spirit. That list is illustrative, not a checklist to match against. Never write `@param name - the name`.

**All-or-nothing, and this overrides the omit rule above:** never document only some of a method's parameters. A block with one `@param` on a three-parameter method reads as an oversight - the reader cannot tell whether the other two were judged self-evident or simply forgotten. So when one parameter deserves a note, pick one of:

- **Document every parameter**, including ones you would otherwise omit. Use this when each has something real to say. Write what each contributes to the call - never pad with `@param name - the name`.
- **Fold the note into the summary prose** and drop the `@param` entirely. Use this when the other parameters would only restate the signature, so documenting them all would mean writing exactly the padding the rule above forbids.

Prefer whichever leaves the block honest. Do not resolve the tension by leaving the lone `@param` in place.

A `@returns` earns its place whenever the returned value is more than its type. Keep it when it names:

- a **fixed or constrained value** - always `false`, an empty array rather than `undefined`
- a **transformation** the type doesn't show - normalized, sorted, deduped, cloned
- something **synthesized** by the call - a generated id, a defaulted field
- a **test-visible contract** a fixture guarantees - a `data-testid`, a specific element shape
- **which** of several same-typed results comes back, or what an ambiguous boolean means

Delete a `@returns` that only re-says the type: `@returns The render result.` on a function returning `RenderResult`, `@returns Nothing.` on `void`, `@returns JSX element.` on a component.

When a `@returns` is genuinely borderline, keep it. A redundant line costs a reader a second; a deleted one can cost them a trip into the body.

Include `@throws` for every error condition the caller must handle; omit it when the function never throws.

## Type declarations

Interfaces, type aliases, and enums follow the same doc-comment rules. Document each field or member whose purpose is not self-evident from its name and type, individually rather than in the type-level summary.

## References to other code

Do not mention other code by name in prose. Reference other code only when necessary for the reader to understand the symbol - not for completeness. The only permitted reference is a **type**, and only when naming it genuinely aids understanding. Write it with TSDoc `{@link}` so generated docs render a link:

`{@link SomeType}`

## Inline comments

Use sparingly. Warranted only when the reasoning is not clear from the code, or when a bugfix introduces a non-obvious change. Keep them short, and always about the code they sit next to.
