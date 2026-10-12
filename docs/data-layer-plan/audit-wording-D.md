# Audit: Merged data layer plan (#403)

Oct 12, 2026 · @Danny

Audits [Merged data layer plan (#403)](https://claude.ai/artifact/6Jr1vSYDEDJk5h3CXys2YJ), as of rev 10.

The plan is mostly sound. These findings change its meaning, not just its wording, and each comes with its fix:


**Baseline:** interlinearizer-extension `origin/main` at 36fa9f8 (code, README, AGENTS.md, INSTALL.md, docs/). Issue text is excluded, and platform terms (WebView, extension host, data provider, PAPI, USJ) count as known.

Each section below is a table: where the text is, what's wrong, and a suggested fix. Locations use the plan's section names and issue ids.

## Jargon not on main

About 30 terms are new to main or new in this sense. The biggest problem is order: many are first used in the Decisions table and defined sections later (or never). "Uses" counts each term in the plan's text, not its diagrams.

| Term | First use | Uses | On main | Suggestion |
| --- | --- | --- | --- | --- |
| seam | Lead; "The seam" heading | 7 | Three unrelated senses in code comments (`SegmentationStore.tsx`, PT9 converter) | Define at first use (lead): "the repository interface plus its conformance suite" |
| `ChangeSet` | Decisions: Change delivery | 4 | Absent | Defined in Contract rules, three sections after first use. Add "a list of whole-record puts and deletes" at first use |
| page, segment page, page client | Lead ("serves the WebView pages") | 15 | Absent | Say "segment page" every time; define it at first use (lead) as the text and analysis for a segment range |
| derived indexes | Decisions: Storage-model changes | 6 | Absent | Define at first use: lookups by token ref, segment id, analysis id, normalized form, and book plus status. |
| conformance suite | Decisions: Storage-model changes | 4 | Absent | Defined in Phase 1; move up |
| pool bucket | Decisions: Suggestions | 5 | Once, as a verb, in an `AnalysisCatalogPanel.tsx` comment | Define at first use (Decisions: Suggestions): "the approved payloads sharing one normalized form" |
| normalized cache | Phase 3, 3l | 2 | Absent; clashes with "normalized form" | Rename to "record cache" in Phase 3, 3l and the seam diagram ("Record cache and page client") |
| envelope, per-book shards | Decisions: Storage layout | 7 | Only in `projectStorage.ts` comments and AGENTS.md; "shard" isn't in any doc | Gloss at first use (Decisions: Storage layout): the project record (envelope) plus one stored analysis per book (shard) |
| temporary bridge | API sketch | 2 | Absent | No definition needed (clear from context), but give each bridge's removal step where it's introduced |
| heading flags, verse labels, stale flags | API sketch | 6 | `Segment.heading`; `'stale'` status | The outline carries each segment's `heading` field from `Segment`; "heading flag" means that field is present |
| harmony | Decisions; Considered and rejected | 1 | Absent | Capitalize: Harmony |
| approval register, field-level change sets, caller-made ids, read-back-after-write, change log, chapter chunks, payload buckets | Decisions; Considered and rejected | 11 | Absent; from the source plans | Drop the "Not adopted" list from Decisions; Considered and rejected covers it |

## Term consistency

The fix throughout is one word per meaning. "Analysis" and "project" matter most: each shifts sense within a single row of the API sketch.

| Term | Uses in the plan | On main | Suggestion |
| --- | --- | --- | --- |
| analysis | The whole `TextAnalysis` ("sends the whole analysis"); one payload record; its id as "payload ids" (`onAnalysisChanged`) and "analysis id" (`previewDeletion`) | Both senses; the link field is `analysisId` | "The analysis" for the whole `TextAnalysis` only; "payload" for one record; "analysis id" (`analysisId`) for its id everywhere, including `onAnalysisChanged` |
| project | Paratext source project (`openSession` request); saved interlinear project; "attached project" (Decisions), "its project" (3a), "optional project" (`openSession`) | `sourceProjectId` vs `InterlinearProject` | Always "source project" or "interlinear project"; `openSession` takes "source project, optional interlinear project" |
| session | Host handle per open draft (`sessionId`); undo scope ("one linear stack per session") | App run (`lexicon-port.d.ts`); "long-lived WebView session" (`analysis-identity.ts`) | Define at first use (Decisions: Addressing) as "a host-side handle for one open draft and its interlinear project", and keep only that sense |
| page, paged | Segment-range pages (`getSegments`); offset and count paging (`getCatalogRows`, `getConcordance`) | n/a | "Segment page" vs "paged by offset" |
| index | Derived indexes; "host concordance index"; "host text index" | `BookIndexes` (token positions); `selectPoolIndex`; `useConcordanceIndex` | The plan has two, the derived indexes and the concordance index; say which at each use. `BookIndexes` goes away in 2b, when the outline replaces it |
| concordance index | "host concordance index" (Phase 5, 5d); "Host text index per book" (Cross-book answers) | `useConcordanceIndex`, `indexBook`, `BookConcordance` | "Concordance index". Phase 5 should say it lives in `BookService`, is built from text only and sits outside the repository seam, and how it reads books that aren't open (`BookService` caches only open books) |
| `ChangeSet` | `ChangeSet` (type); "change sets", "inverse change sets" (prose) | Absent | `ChangeSet` for the plan's type everywhere, inverses included ("inverse `ChangeSet`s"); plain "change sets" only for the rejected field-level idea |
| baseline | Performance baseline (#407) | `Segment.baselineText`; the dependency baseline in README | "Performance baseline" at least once per section |
| `apply` | Repository commit with inverse capture | Local `apply(next, location)` helper in `InterlinearizerLoader.tsx` | Qualify: "the repository's `apply`" |
| identity | Phase 1 "Seam and identity" means link ids | `analysis-identity.ts` means content identity of payloads | "Seam and link ids" |
| stale | Link status `'stale'`; "Save copies a stale draft" (Risks) means not yet flushed | `'stale'` status | "Unflushed draft" |
| summary | Project summaries; `getStaleSummary` | `toProjectSummary`, `summarizeAnalysis` | Say project summaries are the existing summary type, now stored |
| commit | "A round trip on every commit" (Risks) means a committed edit | n/a | "Every committed edit" |
