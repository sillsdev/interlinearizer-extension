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

## Term consistency

The fix throughout is one word per meaning. "Analysis" and "project" matter most: each shifts sense within a single row of the API sketch.

| Term | Uses in the plan | On main | Suggestion |
| --- | --- | --- | --- |
| analysis | The whole `TextAnalysis` ("sends the whole analysis"); one payload record; its id as "payload ids" (`onAnalysisChanged`) and "analysis id" (`previewDeletion`) | Both senses; the link field is `analysisId` | "The analysis" for the whole `TextAnalysis` only; "payload" for one record; "analysis id" (`analysisId`) for its id everywhere, including `onAnalysisChanged` |
| project | Paratext source project (`openSession` request); saved interlinear project; "attached project" (Decisions), "its project" (3a), "optional project" (`openSession`) | `sourceProjectId` vs `InterlinearProject` | Always "source project" or "interlinear project"; `openSession` takes "source project, optional interlinear project" |
| session | Host handle per open draft (`sessionId`); undo scope ("one linear stack per session") | App run (`lexicon-port.d.ts`); "long-lived WebView session" (`analysis-identity.ts`) | Define at first use (Decisions: Addressing) as "a host-side handle for one open draft and its interlinear project", and keep only that sense |
| baseline | Performance baseline (#407) | `Segment.baselineText`; the dependency baseline in README | "Performance baseline" at least once per section |
| stale | Link status `'stale'`; "Save copies a stale draft" (Risks) means not yet flushed | `'stale'` status | "Unflushed draft" |
| summary | Project summaries; `getStaleSummary` | `toProjectSummary`, `summarizeAnalysis` | Say project summaries are the existing summary type, now stored |
| commit | "A round trip on every commit" (Risks) means a committed edit | n/a | "Every committed edit" |
