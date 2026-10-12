# #403 merged plan: four wording changes from our terminology review

These come from our terminology review of the merged plan (rev 10). Your audit doesn't cover them, or it recommends something different. Each one lists the exact text as it stands and the replacement. None of them changes scope or design; they remove words a reader could take the wrong way.

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
