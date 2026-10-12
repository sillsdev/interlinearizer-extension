# Audit: Merged data layer plan (#403)

Oct 12, 2026 · @Danny

Audits [Merged data layer plan (#403)](https://claude.ai/artifact/6Jr1vSYDEDJk5h3CXys2YJ), as of rev 10.

The plan is mostly sound. These findings change its meaning, not just its wording, and each comes with its fix:

1. **Phase 0 is #407.** #407 covers both 0a and 0b (host metrics), and all of it must be done before Phases 1 and 2 start. The issue table's "1a, 2a and 0b can start at once" is wrong. Page-fetch latency moves to 2b. The checkpoint numbers are provisional until #407's rerun, which reports median and p90.
2. **The large tier can't load until 5d, not 4b.** `getFullAnalysis` still sends the whole analysis after the switch. Fix the Risks row and the phases diagram's 4c box.
4. **1d uses `apply` before 3b builds it.** Make 1d depend on 3b: nothing reads the derived indexes before Phase 3.
5. **Phase 3 commands copy today's behavior, nothing more.**
   - Drop reject, clear and the "keep" for stale analyses: none has a reducer today.
   - Parity-test boundary moves and wipes against today's functions.
   - Put `replaceAnalysis` in 3h and `setAnalysisLanguage` in 3a.
6. **The 4b latency check needs a threshold:** the host path's dispatch-to-render p90 must not exceed the #407 baseline's p90 at any tier.
7. **Clearing links without ids is worded three ways.** Saved interlinear projects are cleared too, by design (pre-release, so no migration), but the Risks row and its release note say only "local drafts."
8. **Whether a Scripture edit clears undo history depends on the edit's size.** The plan gives no line; 3i should set it.

**Baseline:** interlinearizer-extension `origin/main` at 36fa9f8 (code, README, AGENTS.md, INSTALL.md, docs/). Issue text is excluded, and platform terms (WebView, extension host, data provider, PAPI, USJ) count as known.

Each section below is a table: where the text is, what's wrong, and a suggested fix. Locations use the plan's section names and issue ids.

## Jargon not on main

About 30 terms are new to main or new in this sense. The biggest problem is order: many are first used in the Decisions table and defined sections later (or never). "Uses" counts each term in the plan's text, not its diagrams.

| Term | First use | Uses | On main | Suggestion |
| --- | --- | --- | --- | --- |
| seam | Lead; "The seam" heading | 7 | Three unrelated senses in code comments (`SegmentationStore.tsx`, PT9 converter) | Define at first use (lead): "the repository interface plus its conformance suite" |
| `ChangeSet` | Decisions: Change delivery | 4 | Absent | Defined in Contract rules, three sections after first use. Add "a list of whole-record puts and deletes" at first use |
| aggregate (noun) | Decisions: Change delivery | 9 | Only as a verb | Define at first use: "an answer that spans books (catalog, pool, concordance, ...)" |
| page, segment page, page client | Lead ("serves the WebView pages") | 15 | Absent | Say "segment page" every time; define it at first use (lead) as the text and analysis for a segment range |
| derived indexes | Decisions: Storage-model changes | 6 | Absent | Define at first use: lookups by token ref, segment id, analysis id, normalized form, and book plus status. |
| conformance suite | Decisions: Storage-model changes | 4 | Absent | Defined in Phase 1; move up |
| parity tests | Phase 3 | 12 | Absent | Define at first use (Phase 3): "tests that run one input through today's reducer or function and the new command, and compare results" |
| pool bucket | Decisions: Suggestions | 5 | Once, as a verb, in an `AnalysisCatalogPanel.tsx` comment | Define at first use (Decisions: Suggestions): "the approved payloads sharing one normalized form" |
| normalized cache | Phase 3, 3k | 2 | Absent; clashes with "normalized form" | Rename to "record cache" in Phase 3, 3k and the seam diagram ("Record cache and page client") |
| envelope, per-book shards | Decisions: Storage layout | 7 | Only in `projectStorage.ts` comments and AGENTS.md; "shard" isn't in any doc | Gloss at first use (Decisions: Storage layout): the project record (envelope) plus one stored analysis per book (shard) |
| temporary bridge | API sketch | 2 | Absent | No definition needed (clear from context), but give each bridge's removal step where it's introduced |
| large tier, large-loadable, #411 datasets | Phase 6; Performance checkpoints | 8 | Not on main; defined in #407 and PR #411 | Link #407 |
| `ilz:` marks, host marks, page-fetch latency, open to interactive, dispatch to render | Phase 0; Performance checkpoints | 6 | Not on main; from #407 and PR #411 | Link #407 |
| whole-scope change | Decisions: Undo | 2 | `WipeScope` (book or whole draft) | Whole-scope changes are New, Open and opening a session, as on main today. Wipes stay undoable; 3i sets the line for Scripture edits |
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
| concordance index | "host concordance index" (Phase 5, 5d); "Host text index per book" (Aggregates) | `useConcordanceIndex`, `indexBook`, `BookConcordance` | "Concordance index". Phase 5 should say it lives in `BookService`, is built from text only and sits outside the repository seam, and how it reads books that aren't open (`BookService` caches only open books) |
| `ChangeSet` | `ChangeSet` (type); "change sets", "inverse change sets" (prose) | Absent | `ChangeSet` for the plan's type everywhere, inverses included ("inverse `ChangeSet`s"); plain "change sets" only for the rejected field-level idea |
| baseline | Performance baseline (#407) | `Segment.baselineText`; the dependency baseline in README | "Performance baseline" at least once per section |
| `apply` | Repository commit with inverse capture | Local `apply(next, location)` helper in `InterlinearizerLoader.tsx` | Qualify: "the repository's `apply`" |
| location | "One approved link per location" | `apply(next, location: string)`; the invariant in `interlinearizer.d.ts` says per token and per segment | "Per token or segment" |
| identity | Phase 1 "Seam and identity" means link ids | `analysis-identity.ts` means content identity of payloads | "Seam and link ids" |
| stale | Link status `'stale'`; "Save copies a stale draft" (Risks) means not yet flushed | `'stale'` status | "Unflushed draft" |
| summary | Project summaries; `getStaleSummary` | `toProjectSummary`, `summarizeAnalysis` | Say project summaries are the existing summary type, now stored |
| commit | "A round trip on every commit" (Risks) means a committed edit | n/a | "Every committed edit" |
| reanchor, resegment | "reanchor pass"; "resegmenting" (Phase 2); "re-segment" (seam diagram) | "re-anchoring pass" (docs/reanchoring.md); `reanchorAnalysisToBook`, `reanchorSegmentation` | Unhyphenated, to match the code |
| domain | "domain layer", "domain logic", "domain reducers" (4c, Phase 4) | n/a | "WebView reducers" in 4c; they aren't in the domain layer |

## Ambiguous words and phrases

Most of these are absolute claims that hold only for the target state, and time words that don't say which phase they mean.

| Location | Text | Problem | Suggestion |
| --- | --- | --- | --- |
| Contract rules | "No read returns a whole document, apart from the two temporary bridges" | `getDraft` returns a whole draft until 4c | Open Contract rules with "These rules describe the target state after Phase 5." |
| The seam | "A CRDT backend later replaces the highlighted layer" | Depends on the diagram, and doesn't say whether a later backend brings its own indexes | "the in-memory implementation". Index lookups belong to the repository interface, and the conformance suite tests them; the in-memory implementation backs them with maps, and a later backend answers them its own way |
| Decisions: Existing data; Phase 1; 1a | "records without link ids are cleared" / "A draft or project holding a link without an id is cleared" / "links without ids clear the record" | Three wordings; it's unclear whether the link, the book or the whole draft is cleared | One wording everywhere, including the Risks row and its release note: "A draft or saved interlinear project with any link that has no id loads as empty, with a log entry" |
| Decisions: Storage layout | "Only books an edit touched are rewritten" | Touched since when? | "since the last autosave" |
| Aggregates, lead | "after the plan" | After which phase? | "after Phase 5" |
| Aggregates: `hasFreeTranslations` | "A field on the session, kept by `apply`"; freshness "Live"; issue 3j | On main it is read once from the seed analysis, so clearing the last free translation can't take its input away mid-edit | `openSession` returns it, computed once and recomputed on New and Open, as on main; freshness "At session open"; issue 3a |
| Throughout | "today", "today's format", "existing" | The plan spans months | Add to the plan's lead: "'Today' means main at 36fa9f8 (2026-10-08)." |
| Decisions, lead | "Rows marked carried ... follow from the decisions above them" | "the decisions" reads as all of them | "follow from decisions above them" |

## Claims about today's code

Every identifier the plan says exists today does exist on main. The gaps are in what the command families cover; the fix is that commands copy today's behavior and nothing more.

| Claim | Location | On main | Verdict |
| --- | --- | --- | --- |
| "about 24 reducers" | Risks | 24 in `analysisSlice.ts` | Boundary moves (`moveBoundary`) and wipes (`wipeBook`, `wipeAll`) aren't reducers; their commands get parity tests against these functions |
| Token commands include "reject, clear" | Phase 3; 3c | No reject or clear reducer | Drop them from 3c |
| Stale commands "discard, reapply, keep" | 3g | `discardStaleAnalysis`, `reapplyStaleAnalysis`, `keepStaleFreeTranslation`, `discardStaleFreeTranslation` | No "keep" for token analyses; 3g covers these four |
| "every reducer has a command" | Phase 3 done-when | `replaceAnalysis` and `setAnalysisLanguage` fit no listed family | Put `replaceAnalysis` in 3h and `setAnalysisLanguage` in 3a |
| "The #411 harness and the first baseline exist"; 0a "(existing)" | Phase 0; issue table | Not on main; PR #411 is a draft | Say "#407"; it covers 0a and 0b |
| "its 133 MB draft" | Phase 6 | #407: 118.9 MB of draft JSON, 133.4 MB on the wire | "133 MB on the wire" |
| Approval rule "enforced in the domain layer" | Decisions | `interlinearizer.d.ts`: "nothing enforces it at runtime, and a breach is reported at the storage boundary" (`reportAnalysisViolations`) | Consistent. Keep the breach report on loads and PT9 import saves; drop it from project Save in 1e |
| "core's 100 MB message cap" | Phase 6 | `MAX_WEBSOCKET_PAYLOAD_BYTES = 100 * 1024 * 1024` in paranext-core `rpc.model.ts` | Name the constant (100 MiB) |
| Project summaries are read in full today | Phase 1; Aggregates | `main.ts` builds `toProjectSummary` and `summarizeAnalysis` per request | Say the stored summary is this existing type |

## Cross-references

The API sketch and Aggregates issue columns match the issue table. The issue table, the risks, the checkpoints and both diagrams don't always agree.

| Where | Says | Conflicts with | Fix |
| --- | --- | --- | --- |
| Issue breakdown lead; 1a and 2a dependencies | "1a, 2a and 0b can start at once"; 1a and 2a list no dependencies | Phase table and diagram: Phases 1 and 2 need Phase 0. #407 must be done before the migration starts | 1a and 2a depend on #407; drop the sentence |
| Issue breakdown | "31 issues"; 0a and 0b | #407 covers 0a and 0b | "29 new issues, plus #407" |
| Phases diagram, Phase 0 box | "Baseline · issues 0a–0b"; "#411 numbers in hand; harness extended to the host" | Phase 0 is #407 | "Baseline · #407" |
| 1d | Indexes "kept current by `apply`"; depends on 1b | `apply` is built in 3b | 1d depends on 3b and moves to Phase 3. Drop derived indexes from Phase 1's text |
| Phases diagram, Phase 1 box | "Link ids, repository, conformance suite, indexes" | Derived indexes move to Phase 3 (1d after 3b) | Drop "indexes" here; add it to Phase 3's box |
| Phase 0 | "page-fetch latency" | #407 leaves it out: nothing reads pages until `getSegments` | Move it to 2b |
| Performance checkpoints: Baseline column | Numbers from the first #411 run (dev renderer, no cold runs, 5 runs) | #407 reruns the baseline before Phase 1: packaged app, cold and warm, 10 runs, median and p90 | Mark the column provisional; replace it with the rerun's numbers |
| Risks: Bus size | "Expected until 4b" | Phase 4 done-when: the WebView still holds "what `getFullAnalysis` still feeds"; removed in 5d | "until 5d" |
| Phases diagram, 4c box | "Reducers, snapshot undo, temporary bridges" | 4c removes only `getTokenizedBook`; the same diagram's Phase 5 removes `getFullAnalysis` | "`getTokenizedBook`" |
| Phases at a glance: Phase 5 | "One query per PR" | Issue breakdown: "each one or two PRs" | 5d is two (index, then removal); say so |
| API sketch: `save` / `saveAs` | Request "session or draft"; issue 1e | Sessions come in 3a | "draft (1e); session (from 4a)" |
| Seam diagram, repository interface box | "Records by id, derived indexes, apply with inverse capture" | Index lookups belong to the interface; the maps behind them belong to the in-memory implementation | "Records by id, index lookups, apply with inverse capture"; add "index maps" to the in-memory box |
| Seam diagram, BookService box | "re-segment" | Phase 2: "resegmenting" | "resegment" |
| The seam text under the diagram | "the domain layer, the API and the WebView stay put" | The diagram's box is "API layer" | "the API layer" |

## Done-when criteria

13 of the 29 new issues have no "done when," four that have one can't be checked as written, and Phase 3's has gaps. Each gets a suggested criterion.

| Issue | Done when | Problem | Suggestion |
| --- | --- | --- | --- |
| 1b | "the app behaves as before" | Not checkable | "The existing unit and e2e suites pass unchanged" |
| 2a | "the views render unchanged from host-tokenized books" | Unchanged against what? | "Tokens match the WebView tokenizer's output on the #407 datasets" |
| 2c | "it flattens only the window" | "window" undefined | Name `useSegmentWindow`'s range |
| 3a | None | Missing | "Sessions open on a draft, a draft with its interlinear project, and a PT9 import; commands on an import's session are refused; `openSession` returns `hasFreeTranslations` as main computes it" |
| 3c–3h | None | Parity tests are implied but not stated | "Every command in the family passes parity tests against the reducer or function it replaces" |
| 3j | None | Missing | "On the #407 datasets, `getSegments` returns the same links, payloads and pool buckets the WebView store holds for each range, and each command's `onAnalysisChanged` names exactly what its `ChangeSet` touched" |
| 3k | None | Missing | "Applying a command's `ChangeSet` to the cache gives the same pages as refetching them, in tests over the #407 datasets" |
| 4b | "edit latency checked against #411" | No pass or fail threshold, though Decisions makes the optimistic layer depend on it | "The host path's dispatch-to-render p90 doesn't exceed the #407 baseline's p90 at any tier" |
| 4c | None | Missing | "Nothing references the deleted reducers, whole-draft `getDraft`/`saveDraft`, snapshot undo, the WebView reanchor pass or `getTokenizedBook`, and e2e tests pass" |
| 5a | None | Missing | "The catalog panel shows the same rows, sorts and filters as before, from `getCatalogRows`" |
| 5b | None | Missing | "The delete confirmation shows the same outcome as `selectAnalysisDeletionOutcome`, with no `uncertain` for unloaded books" |
| 5c | None | Missing | "The stale notice shows the same counts as today's stale selectors, from `getStaleSummary` and the outline's stale flags" |
| Phase 3 | "every reducer has a command that passes its parity tests" | Misses boundary moves and wipes, which aren't reducers | "Every reducer, boundary edit and wipe has a command that passes its parity tests" |
