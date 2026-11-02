# Learnings log

Newest first. Settled design goes in [concerns.md](concerns.md); this holds context that explains it.

## 2026-11-02

- Drafts were a product choice, not a storage workaround. PR #108 added them for explicit Save/Save As/Discard with autosave "so work is never lost"; the draft was itself one JSON blob per source then. A saved project (`InterlinearProject`) is a separate whole-JSON record outside any repository, and it has no dirty mark; `dirty` lives only on `DraftProject`.
- Undo and drafts overlap but aren't redundant: undo is per session, at most 100 steps; Discard goes back to the last Save and survives restarts. On shared projects, Harmony history can stand in for Discard.
- Where Tim's v8 seam didn't land (#431 took the named reads, the typed per-kind `ChangeSet` and the JSON-only rule): project scope and a repository provider (not needed, see concerns 3), `drafts`/`remote` capabilities, a `ChangeSet` id, `pullRemoteChanges`, `close()`, error codes, and a smallest-id tie rule. Nothing in the milestone's open issues moves toward any of these.
- Commands copy the old reducers step for step under parity tests until 4c (#455), so behavior changes the backend needs (retiring payloads, settling merged approvals) wait until after that.
