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

Omit `@param` and `@returns` unless they add information the signature and type do not already convey - units, nullability meaning, ownership, side effects, or constraints. Never write `@param name - the name`. If any parameter deserves a comment, document all of them.

Include `@throws` for every error condition the caller must handle; omit it when the function never throws.

## Type declarations

Interfaces, type aliases, and enums follow the same doc-comment rules. Document each field or member whose purpose is not self-evident from its name and type, individually rather than in the type-level summary.

## References to other code

Do not mention other code by name in prose. Reference other code only when necessary for the reader to understand the symbol - not for completeness. The only permitted reference is a **type**, and only when naming it genuinely aids understanding. Write it with TSDoc `{@link}` so generated docs render a link:

`{@link SomeType}`

## Inline comments

Use sparingly. Warranted only when the reasoning is not clear from the code, or when a bugfix introduces a non-obvious change. Keep them short, and always about the code they sit next to.
