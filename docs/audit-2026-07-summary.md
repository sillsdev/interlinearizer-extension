# Interlinearizer Audit — Team Summary (2026-07)

Condensed from [audit-2026-07-model-architecture.md](audit-2026-07-model-architecture.md)
(full findings, file/line citations) and
[recommended-issues-2026-07.md](recommended-issues-2026-07.md) (issue drafts).
Audited: `main` @ `73cf42b`, the model in `src/types/interlinearizer.d.ts`, and
all 26 open issues.

## TL;DR

- The model and architecture are **sound and unusually well documented** — the
  d.ts doubles as an import spec for FieldWorks/LCM, PT9, and BT Extension.
- **One structural fault line:** token/segment identity is derived from text
  position (`"GEN 1:1:0"`), so text edits or retokenization orphan analyses.
  Decision issue **#136** now blocks #43 and #49.
- **Main scaling risk:** every save serializes the entire `TextAnalysis` (#87).
- Audit findings are all on the tracker: new issues **#136–#142**, plus updates
  to #43, #49, #61, #87, #94, #97, #128, #129, #130.

## What's good

- Flat analysis layer (payload records + link records) cleanly supports
  competing machine/human analyses — the confidence/status roadmap
  (#51/#53/#54) needs **no model changes**.
- Lexicon data is referenced (`EntryRef`/`SenseRef`/…), never duplicated;
  lexicon-extension API gaps are explicitly catalogued in the model.
- Storage has real concurrency discipline: serialized queues per
  index/project/draft, rollback on failed index writes.
- WebView state is idiomatic Redux Toolkit; flat model indexed via memoized
  selectors; suggestion engine is O(1) per token.
- ~45 test files with good coverage of parsers, components, modals, and hooks.

## Key risks

| # | Risk | Where | Severity | Tracked |
| --- | --- | --- | --- | --- |
| 1 | Text-derived identity: token/segment refs re-key on any offset shift, orphaning analysis links; drift detected but never healed | model + `analysisSlice.ts` | high | #136 |
| 2 | Whole-blob `TextAnalysis` persisted per save; cost grows with project size, not edit size | `useDraftProject.ts`, `projectStorage.ts` | med | #87 |
| 3 | No schema version on persisted records → format change = silent skip/reset of user data | `projectStorage.ts` | med-high | #137 |
| 4 | Invariants ("one approved link per token") prose-only; WebView silently repairs violations | model + `analysisSlice.ts` | med | #140 |
| 5 | Segment-level analyses (free translations) have no staleness detection | model | low-med | #139 |
| 6 | No `updatedAt` timestamps | model | low | #138 |
| 7 | Orphaned project records if index rollback also fails | `projectStorage.ts` | low | #141 |
| 8 | No end-to-end (USJ → render) or drift tests | `src/__tests__/` | low | #142 |

Not yet tracked: JSON-string payloads over the command bus (revisit with #128),
flat `features` map is lossy vs. LCM's nested feature structures.

## Roadmap fit (26 open issues)

| Theme | Issues | Model impact |
| --- | --- | --- |
| Token/segment re-shaping | #43, #49 | **Hardest** — blocked on identity decision #136 |
| PT9 mode parity & alignment spec | #94, #129 | Additive fields (`modelProjectId`, `interlinearMode`); #129 best done while `AlignmentLink` is still unused |
| Lexicon/Concordance integration & public API | #26, #44, #46, #48, #50, #128 | Mostly none; #128 freezes the contract → do #137/#140 first |
| Analysis choice & confidence UI | #51, #53, #54, #130 | None except `morphType` (#130) — machinery already modeled |
| Rendering & language support | #97, #117, #118, #125, #61 | Minimal; #97 decided: direction per writing-system, not global |
| Persistence & performance | #87, #119 | Per-book partitioning preferred on #87 (also enables #117) |
| Infra/chores | #5, #10, #13, #79 | None |

## Filed issues & sequencing

| Issue | Title (short) | Size | Priority |
| --- | --- | --- | --- |
| #136 | Token/segment identity re-anchoring decision | M | **P1** — blocks #43, #49 |
| #137 | Schema version on persisted records | XS–S | **P1** — before #128 |
| #138 | `updatedAt` timestamps | XS | P2 |
| #140 | Validate & report invariant violations | S | P2 |
| #142 | Integration + drift tests | S–M | P2 |
| #139 | Segment-level staleness | S | P3 |
| #141 | Orphaned-record cleanup | XS–S | P3 |

```
#137 modelVersion ─────────────┬──▶ #128 public query API
#140 invariant validation ─────┘
#136 identity/re-anchoring ────┬──▶ #43 split/join ──▶ #49 segment boundaries
#142 integration/drift tests ──┘
#138 updatedAt ────────────────┬──▶ #61 unnamed projects, #117 book status
#87 per-book partitioning ─────┘    (#87 needs #137)
```

Independent of the chains above: #94 (PT9 fields), #130 (`morphType`),
#139, #129 (Burrito), #97 (RTL), #141.
