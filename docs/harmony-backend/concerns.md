# Problems for the Harmony backend

Checked against `70c9f67` on 2026-11-02. Each entry: the problem, the likely fix, and how sure we are of each. Update the status line when something is decided or lands.

Confidence: **high** = verified in code or settled with Tim; **medium** = reasoned, not tested; **low** = a guess that needs a check.

## Must solve before sync goes live

### 1. Commands hard-delete shared payloads
`mergeIntoIdenticalPayload` ([tokenCommands.ts:186](../../src/services/commands/tokenCommands.ts)) repoints every link of a payload to a content-identical survivor and deletes the loser; `reclaimIfUnlinked` and catalog deletes also delete payloads. A teammate's concurrent link to a deleted payload is orphaned, or deleted if Harmony cascades the reference.
- **Fix:** retire payloads (a field edit, hidden on read) instead of deleting them; a later edit can un-retire. Tim's v8 plan, decision 5 / T4b.
- **Confidence:** problem high. Fix medium: it changes command behavior, which parity tests freeze until 4c (#455).

### 2. Re-anchor passes write on every session open
`reanchorStoredBook` ([reanchorPasses.ts:67](../../src/services/reanchorPasses.ts)) applies a change set per book as the text loads. Devices whose Scripture text differs until Send/Receive catches up rewrite each other's links on every open.
- **Fix:** with `drafts: false`, re-anchor for display only; the next edit to a link writes its moved ref. Tim's v8 plan, decision 8.
- **Confidence:** problem high. Fix medium: unchecked how much of the session-page and undo code assumes passes are stored.

### 3. New, Open and Discard would wipe a shared draft
**Decided (Tim, 2026-11-02):** the shared repository stays scoped to one source's draft and reports a new `drafts: false` capability: every change commits, no dirty mark (`wasDirty`, `keepDirty`, `markClean`, `exportForCopy` drop out), `EditHistory` and the UI skip clean tracking, and the conformance suite runs its dirty tests only for draft-capable repositories. No project scope or repository provider is needed.
The catch: New, Open and Discard rewrite the draft to match a saved project or empty (`discardCommands.stageKind` deletes every record not in the target). On a shared draft that deletes teammates' work in one commit.
- **Fix:** disable New, Open and Discard when `drafts: false`; Save As stays, as an export to a local project. Harmony history can later offer "revert to time X" in place of Discard.
- **Confidence:** high.

### 4. Merges produce rule breaches the code treats as errors
The approval rule is enforced above `apply`, and loading reports breaches as errors. Two devices approving different analyses for one token merge into two approved links.
- **Fix:** work rules out on read (the tie rule picks the winner) and settle the data on the next edit, never by an automatic write. Tim's v8 plan, decision 6. Commands must tolerate several approved links.
- **Confidence:** problem high. Fix medium: not yet checked how each command behaves when it meets two approved links.

### 5. Teammates' changes have no way in
The seam has no `pullRemoteChanges`. The store builds field-level edits by diffing each put against its stored row, which is only correct if no import lands between a command's reads and its commit.
- **Fix:** add `pullRemoteChanges`, run as a command in the session queue; clear undo history on import so undo never restores an old record over a teammate's change.
- **Confidence:** high on the queue. Medium on clearing undo: users may dislike losing undo after Send/Receive.

### 6. Some records are lists a CRDT will overwrite
The scope record holds `segmentation` and `analysisLanguages` whole, so concurrent boundary edits or language additions overwrite each other. `MultiString` glosses need per-language merge.
- **Fix:** the store splits these into their own entities (one per boundary, one per language) and keys map fields per language; the adapter rebuilds today's shapes. Morpheme breakdowns and a phrase's token list stay one value (later write wins). Tim's v8 plan, decision 4.
- **Confidence:** medium-high.

### 7. Surface-form normalization differs between JS and .NET
`normalizeSurfaceForm` ([analysis-identity.ts:35](../../src/utils/analysis-identity.ts)) uses JS `toLowerCase`, which applies the final-sigma rule (`'ΟΔΟΣ'` gives `'οδος'`); .NET's invariant lowercasing doesn't. Form lookups on Greek text would miss.
- **Fix:** don't reimplement it in C#. The adapter sends the normalized form with each payload put, and the store indexes that.
- **Confidence:** problem high (checked in Node). Fix medium: it adds a field beside the records.

## Needed, small

### 8. Ids aren't guaranteed GUIDs
Harmony ids are `Guid`; conformance fixtures use ids like `ta-and` and `m-1`.
- **Fix:** require UUIDs in the contract and change the fixtures. Mapping strings to GUIDs would break id-ordered tie rules.
- **Confidence:** high.

### 9. `apply` isn't idempotent across the process boundary
Retry safety lives in the session (`changeId`, replies cached in host memory). If a call to the store times out after it committed, the host's undo history and cache drift from the store.
- **Fix:** an id on `ChangeSet`; the store applies an id once.
- **Confidence:** medium (depends on how the transport fails).

### 10. Errors lose their type over JSON-RPC
The host relies on `ReadOnlyAnalysisError`, `UnreadableBooksError` and plain errors.
- **Fix:** error codes from the store, mapped back to those classes in the adapter, plus `unavailable` for a store that isn't running.
- **Confidence:** high.

### 11. The tie rule moves with `updatedAt`
[pick-rules.ts:7](../../src/utils/pick-rules.ts): later `updatedAt`, then smaller id. A device whose clock runs ahead wins ties, and an unrelated edit can move the winner. Every device still gets the same answer. `countApprovals` needs the rule in SQL.
- **Fix:** live with it (one window function), or switch to smallest id as Tim's plan assumed.
- **Confidence:** medium that it's worth changing at all.

## Watch

### 12. Commands are chatty
About 5 to 10 sequential repository reads per command, one round trip each, and a payload merge can put thousands of links in one commit.
- **Fix:** measure first; an open-book cache in the adapter if needed.
- **Confidence:** low that it's a real problem.

### 13. How commits reach teammates is unconfirmed
The handoff is silent. Tim's plan (decisions 12, 13) writes per-device commit files into the Paratext project for Send/Receive, which needs the core team's agreement (T31).
- **Confidence:** low on core's answer.

## Deferred

- **Whole-draft reads** (`exportAll` at session open and in discards, `getWholeDraft`) exceed the 100 MiB PAPI cap at the large tier. Tim, 2026-11-02: a problem for later export support, not for the backend in general use.
