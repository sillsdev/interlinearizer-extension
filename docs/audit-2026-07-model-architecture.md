# Interlinearizer Extension — Model & Architecture Audit (2026-07-01)

## Instructions (for resuming this task)

> **If this task was interrupted, re-read this section and continue from the first
> unchecked item in the Plan below.**
>
> Original request: Do a high-level audit/analysis of the `interlinearizer-extension`
> data model (`src/types/interlinearizer.d.ts`) and architecture as it is on branch
> `main` (commit `73cf42b`). Review open GitHub issues to see where the project is
> heading and assess how well the current model/architecture supports that direction.
> Use cheaper subagents where useful. Progressively save plan, progress, and findings
> to this file, committing to branch `audit/model-architecture-2026-07` (created from
> `main`). Do NOT modify existing branches; do NOT push or make any remote changes.

## Plan

- [x] Create branch `audit/model-architecture-2026-07` from `main`; create this file.
- [x] Read and analyze the data model (`src/types/interlinearizer.d.ts` and
      supporting types in `src/types/`).
- [x] Map the architecture via subagents:
  - [x] Extension lifecycle & PAPI surface (`src/main.ts`, commands, web views,
        settings, contributions).
  - [x] State management & persistence (`src/store/`, `src/services/projectStorage.ts`,
        `src/hooks/useDraftProject.ts`).
  - [x] Parsing/tokenization pipeline (`src/parsers/`).
  - [x] UI component architecture (`src/components/`, `src/hooks/`).
- [x] Review open issues (26 open as of today) and cluster into themes; map each
      theme against the current model/architecture for fit and friction.
- [x] Synthesize findings: strengths, risks, model gaps vs. roadmap, recommendations.
- [x] Final commit.

## Progress log

- 2026-07-01: Branch and audit file created. Repo state: `main` @ `73cf42b`
  ("Add engine to generate token gloss suggestions from previous glosses (#131)").
  26 open issues fetched.
- 2026-07-01: Model analysis (§1) written from direct read of
  `src/types/interlinearizer.d.ts`.
- 2026-07-01: Four subagent reports received (lifecycle/PAPI, state mgmt,
  parsers+UI, issues) and distilled into §2–§5. File:line citations in §2–§4 are
  subagent-reported and spot-checked, not individually re-verified.
- 2026-07-01: Synthesis and recommendations written (§6). **Audit complete.**
- 2026-07-02: Recommendations filed as issues #136–#142 (drafts in
  [recommended-issues-2026-07.md](recommended-issues-2026-07.md)); the
  maintainer folded the recommended updates into existing issues #43, #49, #61,
  #87, #94, #97, #128, #129, #130 (body edits and comments). Findings below now
  reference the tracking issues.

## Findings

### 1. Data model (`src/types/interlinearizer.d.ts`)

**Shape.** Two cleanly separated layers plus a persistence envelope:

- **Text layer** (`Book` → `Segment` → `Token`) — rebuilt from USJ on every load,
  never persisted. Tokens carry `charStart`/`charEnd` offsets into
  `Segment.baselineText` with a documented invariant
  (`baselineText.slice(charStart, charEnd) === surfaceText`), which correctly
  supports scriptio continua scripts and precise drift detection.
- **Analysis layer** (`TextAnalysis`) — deliberately **flat**: parallel arrays of
  payload records (`segmentAnalyses`, `tokenAnalyses`, `phraseAnalyses`) plus link
  records (`*AnalysisLinks`) that attach payloads to text-layer ids. Supports
  competing analyses per token/segment/phrase distinguished by
  `status`/`confidence`/`producer`.
- **Alignment** (`AlignmentLink` / `AlignmentEndpoint`) — directional many-to-many
  source→target links, token- or morpheme-level, with `TokenSnapshot.surfaceText`
  for staleness detection.
- **Envelope** (`InterlinearProject`, `DraftProject`, runtime `ActiveProject`) —
  persisted via `papi.storage` under `projectIds` index + `project:{id}` keys;
  draft under `draft:{sourceProjectId}`, decoupled from saved projects.

**Strengths.**

- Exceptional documentation density: every type carries source-system mappings for
  the three import origins (LCM/FieldWorks, Paratext 9, BT Extension). The model
  doubles as an import specification.
- Separation of *identity* (link records) from *content* (payload records) is the
  right call for competing machine/human analyses and matches the FieldWorks
  `IWfiAnalysis`/`IWfiGloss` mental model.
- Lexicon data is referenced, never duplicated (`EntryRef`/`SenseRef`/
  `AllomorphRef`/`GrammarRef`), with the lexicon-extension API gaps explicitly
  catalogued in the file header (no by-id entry lookup, no sense/allomorph/MSA
  surface). The model is positioned as the standard the Lexicon extension should
  grow toward.
- Provenance model (`producer` + `sourceUser` + `Confidence` + `AssignmentStatus`)
  is expressive enough for the planned suggestion/confidence workflows.
- Punctuation as first-class text-layer tokens (omitted from analysis layer) keeps
  baseline reconstruction faithful without noise records.

**Weaknesses / risks.**

- **Identity is text-derived, not stable.** `Segment.id` is the verse SID
  (`"GEN 1:1"`) and `Token.ref` embeds the character offset (`"GEN 1:1:0"`). Any
  upstream text edit that shifts offsets re-keys *every subsequent token in the
  segment*, orphaning `TokenAnalysisLink`s wholesale. The snapshot/stale mechanism
  detects drift but the model has no re-anchoring story (#49 "Adjust segment
  boundaries" and text-edit resilience generally will collide with this). The
  re-anchoring decision is now tracked as #136, which blocks #43 and #49.
- **No schema version field** on `InterlinearProject`/`DraftProject`. Persisted
  JSON has no `modelVersion`; any future shape change requires ad-hoc sniffing.
  Cheap to add now, expensive later. Tracked as #137.
- **Invariants are prose-only.** "At most one approved analysis per token/segment"
  is documented as the caller's responsibility with no runtime enforcement or
  shared helper; every writer must re-implement it correctly. Tracked as #140
  (validate and report instead of silently repairing).
- **Inconsistent staleness coverage.** `TokenSnapshot` drift detection exists on
  `TokenAnalysisLink`, `PhraseAnalysisLink`, and `AlignmentEndpoint`, but
  `SegmentAnalysisLink` has only `segmentId` — a changed verse text silently keeps
  its free translation fresh-looking. `Book.textVersion` exists but nothing in the
  model records *which* version an analysis was made against. Tracked as #139.
- **`updatedAt`/`modifiedAt` absent.** `createdAt` only; no per-record or
  per-project modification timestamps, which the roadmap (save performance #87,
  status views #117) will likely want. Tracked as #138.
- **JSON-string command bus.** Every command in `CommandHandlers` passes
  `InterlinearProject`/`TextAnalysis` as JSON *strings* (serialize → PAPI →
  parse), doubling serialization work and losing type-safety at the boundary.
  Presumably a PAPI serialization constraint, but worth revisiting; at minimum the
  whole-analysis-per-save pattern couples payload size to save latency (#87).
- **`features?: Record<string, string>`** is a flat AV map — fine for display, but
  lossy vs. LCM's nested `IFsFeatStruc`; round-tripping FieldWorks data may
  degrade.
- **Morph-type not modeled.** `MorphemeAnalysis` has no morph-type field (prefix/
  suffix/stem/clitic…) and no affix-marker convention — exactly what open issue
  #130 ("Handle morph-type indicators") is about; today it can only be inferred
  via the lexicon `entryRef`. The proposed `morphType` field is now specified on
  #130 (2026-07-02 comment).

### 2. Extension lifecycle, PAPI surface, and persistence

**Activation** ([main.ts](../src/main.ts), ~L380–816): caches the execution token,
registers the single `interlinearizer.mainWebView` provider, 6 boolean
project-setting validators, 13 commands, and open/close WebView subscriptions
(an `openWebViewsByProject` map prevents duplicate tabs per project).

**Command surface** splits cleanly in two:

- 9 backend commands with real logic (`createProject`, `getProject`,
  `saveAnalysis`, `getProjectsForSource`, `getDraft`, `saveDraft`,
  `updateProjectMetadata`, `deleteProject`, `openForWebView`) — thin wrappers
  around `projectStorage`, each with the log → notify → rethrow error pattern.
- 6 WebView-only commands registered as no-op backend stubs purely so they appear
  in platform menus (`openSelectProjectModal`, `openNewProjectModal`,
  `openProjectInfoModal`, `save`, `openSaveAsModal`, `wipe`); the WebView listens
  and handles them.

**Persistence** ([projectStorage.ts](../src/services/projectStorage.ts)): three
key families in `papi.storage` — `projectIds` (index array), `project:{uuid}`,
`draft:{sourceProjectId}`. Three promise-chain serialization queues (global index
queue, per-project queue, per-draft queue) prevent lost read-modify-write updates.
Create/delete rolls back the project record if the index write fails. Reads treat
ENOENT as empty; corrupted records are logged and skipped (projects) or reset to
an empty draft (drafts). Runtime `type-guards.ts` validation runs before writes.

**Contributions**: WebView top menu (Select/New/Info, Save/Save As, Wipe), one
scripture-editor menu item (`openForWebView`), 6 boolean project settings, no
global settings, 100+ localized strings, no themes.

**Risks observed** (agent-verified, spot-checked):

| Risk | Where | Severity |
| --- | --- | --- |
| No schema version on persisted records; format evolution ⇒ guard failure ⇒ records skipped/reset (silent data loss path) — tracked as #137 | projectStorage.ts | med-high |
| JSON-string payloads over the command bus; type safety rests entirely on runtime guards | main.ts:154, 254, 308, 328 | med |
| Orphaned `project:{uuid}` records possible if index rollback also fails (storage bloat, invisible to picker) — tracked as #141 | projectStorage.ts:177–189 | med |
| Full-draft JSON written per edit; queues serialize but nothing batches/debounces at this layer | main.ts:326–343 | low-med (feeds #87) |
| Guards validate array shapes deeply for morphemes but not enum values (`Confidence`, `AssignmentStatus`) or `MultiString` keys — folded into #140 | type-guards.ts:213–236 | low |

### 3. WebView state management & data flow

**State architecture.** Redux Toolkit with a per-provider local store; single
`analysis` slice holding the raw `TextAnalysis` (the model's flat arrays) plus the
active analysis language ([analysisSlice.ts](../src/store/analysisSlice.ts)).
The flat model is normalized for the UI via memoized selectors that build Maps:
`tokenRef → approved analysisId` (L993), `id → TokenAnalysis` (L983), phrase-link
indexes (L1163, L1173), and approval-frequency counts (L1036). So the model's
"consumers index links at load time" contract is honored — the flat shape stays
canonical and indexing is a view concern.

**Draft lifecycle** ([useDraftProject.ts](../src/hooks/useDraftProject.ts)): the
draft lives in a ref (synchronous source of truth), autosaves with a 300 ms
debounce on every analysis mutation, tracks `dirty` optimistically, and flushes
pending saves on unmount. New/Open/Wipe cancel pending autosaves and bump a
`draftVersion` counter to force remount/reseed. Save/Save As copy the draft's
analysis into a project; `markSynced` clears `dirty` only if no later edit
supervened.

**Text/analysis join** ([useInterlinearizerBookData.ts](../src/hooks/useInterlinearizerBookData.ts)):
USJ fetched via `platformScripture.USJ_Book`, stabilized by content comparison to
avoid re-tokenization churn, then `extractBookFromUsj` + `tokenizeBook` produce
the Book/Segment/Token layer. There is no join table — analysis links match
USJ-derived token refs by string equality, which is exactly the model-level
identity fragility flagged in §1.

**Suggestion engine** ([suggestion-engine.ts](../src/utils/suggestion-engine.ts)):
read-only pool of approved analyses keyed by normalized surface form, ranked by
approval frequency; O(n) pool build per approved-write (memoized), O(1) per-token
derive; a bounded (50k, LRU) module-global normalization cache.

**Risks observed** (agent-reported, plausibility-checked):

| Risk | Where | Severity |
| --- | --- | --- |
| Token-ref string identity is the join key everywhere; tokenization changes orphan analyses (mirrors §1 model risk) — decision tracked as #136 | analysisSlice.ts:223 | high |
| `isPayloadSharedByOtherLinks` scans all links **per edit** (O(links)); fine now, scales poorly to Bible-sized analyses | analysisSlice.ts:301–308 | med |
| Full-draft `JSON.stringify` per (debounced) autosave; no incremental serialization — the client half of issue #87 | useDraftProject.ts:150 | med |
| Orphan-link repair is silent (`resolveApprovedAnalysis` filters dangling `analysisId`s), masking corruption in production — tracked as #140 | analysisSlice.ts:219–233 | low-med |
| Failed autosave writes are only surfaced via notification; no retry | useDraftProject.ts:141–143 | low |
| `bookOfRef` parses refs by string-splitting `"GEN 1:1"`; format drift ⇒ silent mismatch | analysis-book.ts:12–15 | low |

### 4. Parsers & UI component architecture

**USJ pipeline** ([usjBookExtractor.ts](../src/parsers/papi/usjBookExtractor.ts) →
[bookTokenizer.ts](../src/parsers/papi/bookTokenizer.ts)): recursive USJ traversal
accumulates verse text (notes and heading paras excluded), opens a synthetic
verse-0 scope per chapter for superscriptions (dropped if empty), and stamps an
FNV-1a content hash (`Book.textVersion`). Tokenization is a Unicode-property
regex: word tokens `[\p{L}\p{N}\p{M}\p{Join_Control}]+` with careful glottal-stop
and word-internal-joiner absorption; punctuation as single-char tokens; offsets
satisfy the model's slice invariant. One segment per verse — the model allows
sub-verse segments, but the tokenizer doesn't produce them yet (relevant to #49).

**PT9 XML parser** ([interlinearXmlParser.ts](../src/parsers/pt9/interlinearXmlParser.ts)):
production-quality `fast-xml-parser` layer; strict cluster validation
(throws on malformed ranges), lenient punctuation, duplicate-verse rejection.
Parses to an `InterlinearData` intermediate — the PT9→model conversion the d.ts
mappings describe is specified but the import path is not yet wired end-to-end.

**Known parser gaps**: no scriptio-continua segmentation hooks (whitespace +
Unicode props only, despite the model's explicit charStart/charEnd design for
this); join-control characters preserved but no bidi handling (all deferred to
CSS — issue #97); no re-alignment algorithm when the baseline hash changes (drift
is detected, never healed — the re-anchoring decision is #136).

**UI tree** (roles): `InterlinearizerLoader` (data fetching + nav provider) →
`AnalysisStoreProvider` (Redux) → `Interlinearizer` → two coordinated views —
`SegmentListView` (vertical, windowed via `useSegmentWindow`, one `SegmentView`
per verse with `ArcOverlay` SVG phrase arcs) and optional `ContinuousView`
(horizontal token strip). Tokens render as `TokenChip` (gloss input +
morpheme popover via `MorphemeEditor`); phrases as `PhraseBox` groups with
`TokenLinkIcon` link/unlink affordances between groups. Modal layer of 7 modals
handles project CRUD/save/wipe/unlink confirmation.

**Test coverage**: ~45 test files; parsers, components, modals, hooks, and layout
utils well covered. Gaps: no end-to-end USJ→render integration test, no RTL
rendering tests, no drift/re-alignment tests, cross-segment phrase edge cases
unclear. The integration/drift gaps are filed as #142.

### 5. Open-issue landscape vs. the model

26 open issues cluster into seven themes. Model impact is concentrated in a
handful; most of the backlog is UI/workflow/infra that the current model already
supports.

| Theme | Issues | Model impact |
| --- | --- | --- |
| PT9 mode parity & alignment spec | #94, #129 | **Yes** — #94 needs `modelProjectId?` (model text driving suggestions — distinct from `targetProjectId`) and an `interlinearMode?: 'back-translation' \| 'adaptation'` discriminator on `InterlinearProject`; #129 may reshape `AlignmentLink`/`AlignmentEndpoint` toward the Scripture Burrito alignment flavor |
| Lexicon/Concordance integration & public API | #26, #44, #46, #48, #50, #128 | Mostly no — the ref types (`EntryRef`/`SenseRef`/`glossSenseRef`) already carry this; #128 (query API for analyses) makes the d.ts a real cross-extension contract and raises the cost of the missing schema version |
| Analysis choice, confidence, morph display | #51, #53, #54, #130 | Partial — #51/#53/#54 exercise the existing `Confidence`/`AssignmentStatus` machinery (built but unsurfaced); **#130 needs a `morphType` field on `MorphemeAnalysis`** (currently inferable only via lexicon entryRef) |
| Token/segment re-shaping | #43 (split/join tokens), #49 (segment boundaries) | **Yes, hardest** — both collide with text-derived token/segment identity (§1): a split/join changes every subsequent `Token.ref` in the segment; persistence across retokenization is an unsolved model question |
| Rendering & language support | #97 (RTL), #118, #117, #125, #61 | Minimal — #97's key decision (global vs. per-writing-system direction) is display-layer; `Token.writingSystem` already exists to thread it |
| Persistence & performance | #87, #119 | Minimal model change; #87 (full-analysis serialization per save) is the architectural cost of the whole-blob persistence design; #119 adds a project setting (blocked on #79 / paranext-core#2238 for booleans) |
| Infra/chores | #5, #10, #13, #79 | None |

Notable direction statements from issue bodies: #97 — "The single biggest
decision … is whether text direction is one **global** flag or threaded
**per writing-system**. Settle that first"; #94 — model text is "a separate
concept from `targetProjectId`"; #87 — "serializing the full `TextAnalysis` on
every keystroke blur could be expensive."

**Status update (2026-07-02):** the audit's findings are now reflected on the
tracker. New issues #136 (identity re-anchoring, blocks #43/#49), #137 (schema
version), #138 (`updatedAt`), #139 (segment-level staleness), #140 (invariant
validation/reporting), #141 (orphaned-record cleanup), and #142
(integration/drift tests) were created; #94 now carries the
`modelProjectId`/`interlinearMode` findings, #130 the `morphType` model change,
#87 the persistence-granularity options (per-book partitioning preferred), #128
the contract-hardening checklist, #129 the do-it-while-unexercised timing note,
and #43/#49/#61 the dependency/model notes. On #97 the global-vs-per-side
question is answered: per writing-system (2026-07-02 comment).

### 6. Synthesis & recommendations

**Overall assessment.** The architecture is healthy and unusually well documented
for its age. The model file doubles as an import spec for three source systems;
the flat analysis layer with link records is the right substrate for competing
machine/human analyses and the confidence/status roadmap (#51/#53/#54 need no
model work). Storage has real concurrency discipline (serialized queues,
rollback), the WebView normalizes the flat model idiomatically via memoized
selectors, and test coverage is genuinely good for a young extension.

**The one structural fault line: text-derived identity.** `Token.ref` =
verse SID + char offset; `Segment.id` = verse SID. Three roadmap items collide
with it head-on: #43 (split/join tokens), #49 (adjust segment boundaries), and
ordinary upstream text edits. Today an offset shift orphans every downstream
link in the segment; drift is detected (snapshots → `stale`) but never healed,
and orphan repair in the WebView is silent. **Recommendation:** before #43/#49
are attempted, decide the re-anchoring story — either stable synthetic token ids
with a ref-mapping layer, or a documented re-anchoring algorithm
(snapshot-surface-text matching within a segment) that runs on retokenization.
This is the highest-leverage design decision in the backlog. Filed as #136 (P1);
#43 and #49 are marked blocked on it.

**Recommended near-term, low-cost model additions** (cheap now, expensive after
#128 makes the model a cross-extension contract):

1. `modelVersion` on `InterlinearProject` and `DraftProject` (+ write-side
   stamping and read-side tolerance). No migration logic needed yet — just the
   field. Filed as #137.
2. `morphType?` on `MorphemeAnalysis` (#130) — align values with FieldWorks
   morph types (root, bound root, stem, prefix, suffix, infix, clitic…). Now
   specified on #130.
3. `modelProjectId?` and `interlinearMode?` on `InterlinearProject` (#94) — now
   recorded in #94's findings.
4. `updatedAt?` on `InterlinearProject` (and arguably per-analysis) — #117's
   status view and #61's unnamed-project disambiguation both want it. Filed as
   #138.
5. A `TokenSnapshot`-style staleness hook for `SegmentAnalysisLink` (or a
   per-link `textVersion`) so free translations can go stale like everything
   else. Filed as #139.

**Architecture recommendations.**

- **Persistence granularity (#87):** the whole-blob `TextAnalysis` save is the
  main scaling risk (client stringify per autosave + backend full write). An
  incremental op-log or per-book partition of the analysis blob would address it;
  per-book partitioning fits the existing `analysis-book.ts` filtering and the
  #117 per-book wipe feature naturally. These options are now recorded on #87
  (per-book partitioning preferred; needs #137 for migration).
- **Enforce invariants in one place:** the "at most one approved link per
  token/segment/phrase" rule is prose. Provide shared mutation helpers (the
  Redux slice already effectively owns this) and consider a validation pass in
  `type-guards.ts` so corrupted state is *reported*, not silently repaired.
  Filed as #140.
- **#128 (public query API)** should be the forcing function to tighten the
  contract: schema version, enum validation in guards, and a documented stance on
  JSON-string vs. typed payloads over the command bus. This checklist is now on
  #128 (depends on #137 and #140).
- **#129 (Burrito alignment spec)** is worth investigating *before* alignment
  editing UI exists — `AlignmentLink` is currently unexercised by any feature
  (drafts don't even carry `links`), so the cost of reshaping it is near zero
  right now. This timing note is now on #129.
- **RTL (#97):** thread direction per writing system, not globally — the model
  already carries `Token.writingSystem`/`MorphemeAnalysis.writingSystem`, so a
  global flag would discard information the model already has. Recorded on #97
  (2026-07-02 comment).

**Smaller hygiene items:** debounce/batch at the storage layer too (autosave is
client-debounced only); surface orphaned-record cleanup for the
index-rollback-failure path (#141); validate enum values in type guards (part of
#140); add an integration test for USJ → tokenize → render and a drift-detection
test (#142).
