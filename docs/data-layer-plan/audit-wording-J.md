# #403 merged plan: four wording changes from our terminology review

These come from our terminology review of the merged plan (rev 10). Your audit doesn't cover them, or it recommends something different. Each one lists the exact text as it stands and the replacement. None of them changes scope or design; they remove words a reader could take the wrong way.

## 1. "setting" should be "feature flag"

Settings in this extension are user-facing PAPI project settings (`interlinearizer.continuousScroll`, `showMorphology`) and WebView state. The Phase 4 switch is temporary, for developers only, and deleted in 4c. "Feature flag" is the industry term for that.

| Where                                                        | Now                                                                                   | Change to                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Phases at a glance, Phase 4 row, "Why each release is whole" | A setting, then a flip with a rollback, then deletion                                 | A feature flag, then a flip with a rollback, then deletion                                 |
| Phase 4, step 1 (bold lead)                                  | Wire it behind a setting, off by default.                                             | Wire it behind a feature flag, off by default.                                             |
| Issue table, 4a                                              | Wire the WebView to sessions, commands and the cache behind a setting, off by default | Wire the WebView to sessions, commands and the cache behind a feature flag, off by default |
| Issue table, 4a, done-when                                   | end-to-end tests pass with the setting on and off                                     | end-to-end tests pass with the flag on and off                                             |

Then add one sentence to Phase 4 step 1 saying where the flag lives and who can turn it on. That's still open. Pick it when 4a is written.

## 2. "ops" is left over from Alex's `AnalysisOp`

The merged plan didn't adopt `AnalysisOp`/`applyOps` (Alex's plan) or record-level create/set/delete ops (your plan). Everywhere else it calls a write a "command". Two places still say "ops", and each reader will hear their own plan's meaning.

| Where                      | Now                                 | Change to                                       |
| -------------------------- | ----------------------------------- | ----------------------------------------------- |
| Decisions table, row label | Concurrent ops                      | Concurrent commands                             |
| Decisions table, same row  | the host serializes ops per session | the host runs one command at a time per session |
| Considered and rejected    | Page versions on ops (A).           | Page versions on writes (A's `applyOps`).       |

The rejected-list entry correctly refers to Alex's design. The change just names the thing it rejects.

## 3. "command" means two things

The doc uses "command" for:

- the PAPI transport (every call, reads included, is a PAPI command), as in "Commands plus one event, not a data provider";
- a write, as opposed to a query, as in the API sketch's Kind column.

Keep "command" for writes, to match the Kind column. Say "PAPI command" for the transport.

| Where                                             | Now                                                        | Change to                                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Decisions table, transport row                    | Commands plus one event, not a data provider               | PAPI commands plus one network event, not a data provider                                                                        |
| The seam, paragraph under the diagram             | Only pages, commands, replies and one event cross the bus. | Only queries and their pages, commands and their `ChangeSet`s, and one event cross the bus.                                      |
| The seam, add above the API sketch (new sentence) | (none)                                                     | Every call is a PAPI command. In this plan a _command_ is a write by intent and a _query_ is a read; the Kind column says which. |

## 4. "aggregate" clashes with the domain-driven-design term

The plan already uses DDD vocabulary ("repository", "domain layer"). In DDD an aggregate is a consistency boundary, not a summary, so a reader who knows DDD will misread "aggregates" in the API and in Phase 5. Your audit keeps the word and defines it. We'd rename it, because the doc's own definition already gives the better name: "Each answer that spans books".

Change it to "cross-book queries" (heading and prose) and "cross-book" (`onAnalysisChanged` fields).

| Where                                        | Now                                                          | Change to                                                            |
| -------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Decisions table, change-delivery row         | names the touched segment ranges, payload ids and aggregates | names the touched segment ranges, payload ids and cross-book queries |
| API sketch, `onAnalysisChanged` response     | payload ids, aggregates;                                     | payload ids, affected cross-book queries;                            |
| Phases at a glance table, Phase 5 row        | Aggregates as queries                                        | Cross-book queries                                                   |
| Phase 3, "Paged analysis reads" bullet       | payload ids and aggregates.                                  | payload ids and affected cross-book queries.                         |
| Phase 5 heading                              | Phase 5: Aggregates as queries                               | Phase 5: Cross-book queries                                          |
| Phase 5 lead                                 | Each aggregate becomes a host query, one PR each.            | Each cross-book answer becomes a host query, one PR each.            |
| Issue table, "Paged analysis reads" row (3j) | payload ids and aggregates                                   | payload ids and affected cross-book queries                          |
| Section heading and first column header      | Aggregates / Aggregate                                       | Cross-book queries / Query                                           |

Also check the phases diagram under that table: if it labels Phase 5, change the label there too. I haven't checked the diagram's text.
