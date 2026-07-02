# Recommended Issues — from the 2026-07 Model & Architecture Audit

Derived from [audit-2026-07-model-architecture.md](audit-2026-07-model-architecture.md).
The seven new issues were created on GitHub as #136–#142 (2026-07-02); their
sections below record what was posted. The updates to existing issues are still
drafts for review — nothing has been posted to those issues.

**Conventions used in the drafts:**

- **Size:** XS (< half day) · S (≈ 1 day) · M (2–4 days) · L (≈ a week) · XL (multi-week)
- **Priority:** P1 (blocking or should precede other backlog work) · P2 (near-term) · P3 (opportunistic)

---

## New issues (created as #136–#142)

### #136 — Decide the token/segment identity re-anchoring strategy

**Summary:** Choose and document how analyses survive changes to token refs and
segment ids (which are text-derived: `"GEN 1:1:0"` = verse SID + char offset),
because today any offset shift orphans every downstream link in the segment.

**Relations:** Blocks #43 (split/join tokens) and #49 (adjust segment
boundaries); closely related to drift detection (`TokenSnapshot` → `stale`) and
to #139 (segment-level staleness); the decision constrains #142's drift tests.

**Recommended draft body:**

> `Token.ref` embeds the verse SID and character offset (`"GEN 1:1:0"`), and
> `Segment.id` is the verse SID. Every analysis link, phrase link, and alignment
> endpoint joins on these strings. Any change that shifts offsets — an upstream
> text edit, a tokenizer improvement, or the user actions proposed in #43/#49 —
> re-keys every subsequent token in the segment and orphans its links. Drift is
> currently _detected_ (surface-text snapshots flip links to `stale`) but never
> _healed_, and the WebView silently filters dangling links
> (`analysisSlice.ts` `resolveApprovedAnalysis`).
>
> Decide between (at least):
>
> 1. **Stable synthetic token ids** (UUID or content-position hybrid) with a
>    ref-mapping layer built at tokenization time. Clean identity, but requires
>    persisting the token layer (today it is rebuilt from USJ and never stored).
> 2. **A documented re-anchoring algorithm** that runs on retokenization:
>    match stored snapshots (`surfaceText` + neighborhood) against new tokens
>    within the segment, rewrite refs, and mark unmatched links `stale`.
>    Keeps the model as-is; the algorithm becomes the contract.
> 3. **Hybrid:** keep derived refs but persist a per-project re-anchor journal
>    of user token operations (#43's splits/joins) that replays after
>    tokenization.
>
> Deliverable: a short design doc in `docs/`, agreed by the team, plus a spike
> validating the chosen approach on a real text edit. #43 and #49 should not
> start until this lands.
>
> **Size:** M (design doc + spike)
>
> **Priority:** P1 — blocks #43 and #49

### #137 — Add a schema version to persisted project and draft records

**Summary:** Add a `modelVersion` field to `InterlinearProject` and
`DraftProject` (stamped on write, tolerated on read) so future shape changes can
be migrated instead of sniffed.

**Relations:** Should land **before** #128 (public query API) freezes the
contract; reduces the data-loss risk noted for the guard-and-reset read paths;
sibling of #138 (both are cheap additive model fields).

**Recommended draft body:**

> Persisted records (`project:{id}`, `draft:{sourceProjectId}`) have no version
> field. Today a format change makes old records fail type-guard validation and
> get skipped (projects) or reset to empty (drafts) — a silent data-loss path.
>
> - Add `modelVersion: number` to `InterlinearProject` and `DraftProject` in
>   `src/types/interlinearizer.d.ts`; document that consumers must treat
>   unknown _higher_ versions as read-only/unsupported.
> - Stamp the current version (start at `1`) in `projectStorage.ts` on every
>   write; treat a missing field as version `0` on read.
> - No migration framework yet — just the field and a single
>   `CURRENT_MODEL_VERSION` constant. Migration logic can be added the first
>   time the shape actually changes.
>
> **Size:** XS–S
>
> **Priority:** P1 — cheap now, expensive after #128

### #138 — Add modification timestamps to projects

**Summary:** Add `updatedAt` to `InterlinearProject`, maintained by the storage
layer on every write, so UIs can show recency.

**Relations:** Wanted by #117 (book status view) and #61 (distinguishing unnamed
projects — its body already suggests "datetime created or last-modified");
sibling of #137.

**Recommended draft body:**

> `InterlinearProject` has `createdAt` only. Add `updatedAt: string` (ISO 8601),
> set by `projectStorage.ts` in `updateAnalysis` / `updateProjectMetadata` /
> create. Expose it in the select-project dialog (sort by recency; show as the
> visual distinguisher #61 asks for) and in the per-book status view (#117).
> Consider a follow-up for per-book last-modified once #87's partitioning
> direction is settled.
>
> **Size:** XS
>
> **Priority:** P2

### #139 — Staleness detection for segment-level analyses

**Summary:** Give `SegmentAnalysisLink` the same drift-detection treatment that
token, phrase, and alignment links already have, so free/literal translations go
stale when the verse text changes.

**Relations:** Extends the existing `TokenSnapshot` staleness mechanism; related
to #136 (re-anchoring) and #49 (segment boundaries); test coverage belongs to #142.

**Recommended draft body:**

> `TokenAnalysisLink`, `PhraseAnalysisLink`, and `AlignmentEndpoint` all carry
> `surfaceText` snapshots for drift detection, but `SegmentAnalysisLink` has
> only `segmentId` — a changed verse silently keeps its free translation looking
> fresh. Options:
>
> - Add a `baselineTextHash` (or full `baselineText` snapshot) to
>   `SegmentAnalysisLink`, compared on load; flip `status` to `'stale'` on
>   mismatch, or
> - Record the owning `Book.textVersion` on the link and compare at book level
>   (coarser, but nearly free).
>
> Prefer the per-segment hash: book-level `textVersion` marks _every_ segment
> stale on any edit anywhere in the book.
>
> **Size:** S
>
> **Priority:** P3 (do before free-translation features expand)

### #140 — Report analysis-invariant violations instead of silently repairing them

**Summary:** Enforce/observe the "at most one approved link per
token/segment/phrase" invariant and dangling-link conditions in one shared
place, logging violations rather than silently filtering them.

**Relations:** Precondition for making #128's public API trustworthy; related to
#54 (analysis chooser relies on statuses being correct); today's silent repair
is in `analysisSlice.ts` (`resolveApprovedAnalysis`, orphan filtering).

**Recommended draft body:**

> The model documents invariants ("at most one `approved` link per token") as
> the caller's responsibility with no runtime enforcement. The WebView silently
> repairs violations (e.g. `findLast` over multi-approved links, filtering
> dangling `analysisId`s), which masks corruption in production.
>
> - Add a `validateTextAnalysis(analysis)` pass (extend `type-guards.ts`) that
>   reports: multiple approved links per target, links whose `analysisId` has
>   no payload, payloads referenced by zero links, and invalid enum values
>   (`Confidence`, `AssignmentStatus` are currently unchecked).
> - Run it on draft/project load and before save; log violations with counts
>   (no user-facing noise), keeping the existing tolerant rendering behavior.
> - Route all approved-status mutations through the existing slice reducers
>   (already effectively the case) and document that as the enforcement point.
>
> **Size:** S
>
> **Priority:** P2

### #141 — Clean up orphaned project records when index rollback fails

**Summary:** Handle the storage edge case where a project record is written but
both the `projectIds` index update and its rollback fail, leaving an invisible
orphaned `project:{uuid}` record forever.

**Relations:** Storage hygiene follow-up to the audit's §2 findings; independent
of other issues.

**Recommended draft body:**

> `projectStorage.ts` writes `project:{id}` before updating the `projectIds`
> index; if the index write fails it rolls the record back, but if the rollback
> _also_ fails the orphan persists — never listed, never deleted, pure storage
> bloat. Add a lazy sweep: when `listProjects()` runs, optionally reconcile keys
> against the index (or record failed rollbacks under a `pendingCleanup` key and
> retry on next activation). Keep it simple; this is a rare double-failure path.
>
> **Size:** XS–S
>
> **Priority:** P3

### #142 — Add integration and drift-detection tests

**Summary:** Add an end-to-end USJ → tokenize → render test and tests for
baseline-change drift behavior, the two coverage gaps the audit found in an
otherwise well-tested suite.

**Relations:** Guards #136's re-anchoring work and #139's segment staleness; #97
notes the suite enforces 100% coverage, so RTL work will add its own tests.

**Recommended draft body:**

> Current tests cover parsers, components, hooks, and utils well (~45 files),
> but there is no test that goes USJ input → `extractBookFromUsj` →
> `tokenizeBook` → rendered segments with analyses joined, and no test of what
> happens to existing links when the baseline changes (hash change, token shift,
> `stale` flipping). Add:
>
> - One integration test with a small real USJ fixture, a seeded
>   `TextAnalysis`, and assertions on rendered glosses/phrases.
> - Drift tests: same fixture with an edited verse — assert snapshot mismatch
>   detection and (once #136 lands) re-anchoring behavior.
> - A cross-segment phrase edge-case test (model permits it; UI disables it —
>   pin the current behavior).
>
> **Size:** S–M
>
> **Priority:** P2 (before #136/#43/#49 land)

---

## Updates to existing issues

### #94 — Thoroughly evaluate the 4 PT9 interlinearizer choices

**Summary:** Append the audit's concrete model findings so the issue captures
the two fields the evaluation has already surfaced.

**Relations:** Parent of a likely follow-up implementation issue; the new fields
ride on #137's versioning; the create-project modal work relates to #61.

**Recommended body addition (append to existing body, keeping the screenshot):**

> **Findings so far (from the 2026-07 model audit):**
>
> Two model gaps have been identified for PT9 mode parity — both additive:
>
> - `modelProjectId?: string` on `InterlinearProject` — PT9 Options 1 & 3
>   reference a _model text_ (a major-language translation used **only for
>   generating suggestions**). This is a separate concept from
>   `targetProjectId`, which is the output/alignment target.
> - `interlinearMode?: 'back-translation' | 'adaptation'` — Options 3 & 4 both
>   produce output in a second project but differ in intent; a discriminator is
>   needed for correct UI wording and suggestion behavior.
>
> Implementation implications: `interlinearizer.createProject` command
> signature and `CreateProjectModal` need a mode/model picker.
>
> **Size:** M (evaluation write-up + model fields; UI is a follow-up)
>
> **Priority:** P1 — decides project-creation UX for PT9 users

### #130 — Handle morph-type indicators

**Summary:** Extend the issue (currently just the indicator table) with the
model change it implies: a `morphType` field on `MorphemeAnalysis`.

**Relations:** Model-side sibling of #137/#138; display side relates to #118 (morph
breakdown UX); values should mirror FieldWorks/Lexicon morph types (see the
`IEntry.morphType` reference already in the d.ts phrase docs).

**Recommended body addition (append below the table):**

> **Model change:** `MorphemeAnalysis` currently has no morph-type field —
> the type is only inferable via the lexicon `entryRef`, which is absent for
> unlinked morphemes. Add:
>
> ```ts
> morphType?: 'root' | 'boundRoot' | 'stem' | 'boundStem' | 'prefix' | 'suffix'
>   | 'infix' | 'circumfix' | 'simulfix' | 'suprafix' | 'prefixingInterfix'
>   | 'suffixingInterfix' | 'infixingInterfix' | 'clitic' | 'proclitic'
>   | 'enclitic' | 'particle' | 'phrase' | 'discontiguousPhrase';
> ```
>
> aligned with the FieldWorks morph-type inventory in the table above.
> Rendering: derive the leading/trailing indicators from `morphType` (never
> store the markers in `form`); parse/strip indicators on input in the
> morpheme-breakdown editor.
>
> **Size:** S (model field + indicator rendering)
>
> **Priority:** P2

### #87 — Interlinear project save performance

**Summary:** Append the audit's direction: per-book partitioning of the
analysis blob (or an op-log), plus storage-layer batching, rather than only
client-side debouncing.

**Relations:** Per-book partitioning also serves #117 (per-book status/wipe)
and interacts with #119 (autosave option); client already debounces 300 ms
(`useDraftProject.ts`), which partially addresses the original report.

**Recommended body addition:**

> **Update (2026-07 audit):** the WebView now debounces autosaves (300 ms), so
> the remaining cost is architectural: every save serializes and writes the
> _entire_ `TextAnalysis`, so save cost grows with total project size, not edit
> size. Options, in rough order of preference:
>
> 1. **Partition the persisted analysis per book** (`project:{id}:analysis:{book}`).
>    Fits the existing `analysis-book.ts` filtering, makes #117's per-book wipe
>    trivial, and bounds save payloads to one book.
> 2. Incremental op-log with periodic compaction (more general, more machinery).
> 3. Storage-layer batching/coalescing in the existing per-project queues
>    (cheap, but doesn't fix payload growth).
>
> Requires #137 (schema version) to migrate existing single-blob records.
>
> **Size:** M–L (option 1)
>
> **Priority:** P2 — before Bible-scale dogfooding

### #129 — Investigate using alignment specification for our linking

**Summary:** Add the audit's timing argument: investigate Burrito alignment
_now_, while `AlignmentLink` is still unexercised by any feature.

**Relations:** Reshapes §5 of the model (`AlignmentLink`/`AlignmentEndpoint`);
upstream of any future alignment-editing UI; relates to #26/#128 (cross-
extension reference schemes).

**Recommended body addition:**

> **Timing note (2026-07 audit):** `AlignmentLink` is currently dead weight in
> the best sense — no feature writes it, drafts don't carry `links`, and no UI
> renders alignments. The cost of adopting or mapping to the Burrito alignment
> flavor is therefore near zero _today_ and grows with every feature that
> touches alignment. Recommend doing this investigation before any
> alignment-editing UI is scheduled. Scope: (a) can our
> `AlignmentLink`/`AlignmentEndpoint` round-trip to the Burrito flavor, (b) do
> its reference schemes fit our text-to-lexicon refs
> (`EntryRef`/`SenseRef`), (c) what changes, if any, to §5 of
> `interlinearizer.d.ts`.
>
> **Size:** S (investigation + written recommendation)
>
> **Priority:** P2

### #128 — Add service/API for querying the analyses

**Summary:** Expand the issue into a short contract-hardening checklist, since
exposing the analyses to other extensions freezes the model's public surface.

**Relations:** Depends on #137 (schema version) and benefits from #140 (invariant
validation); serves #26/#46/#50 (cross-extension consumers); dogfooding
requirement (internal suggestion engine consumes it) is already in the body.

**Recommended body addition:**

> **Contract checklist (2026-07 audit):** before the API is public:
>
> - [ ] #137: schema version on persisted/returned records.
> - [ ] Decide typed payloads vs. JSON strings over the command bus (all
>       current commands pass JSON strings; a network-object service like
>       `lexicon.entryService` would give typed signatures).
> - [ ] Validate enum values (`Confidence`, `AssignmentStatus`) at the boundary
>       (#140).
> - [ ] Define query shape: by token ref(s), by surface form (normalized — the
>       suggestion pool's normalization should be part of the contract), by
>       book, by status.
> - [ ] Read-only first; mutation API is a separate decision.
>
> **Size:** M
>
> **Priority:** P2 — sequencing matters more than speed

### #117 — View status of and wipe interlinearized books

**Summary:** Draft a body for this currently-empty issue, tying it to the
existing `Book.textVersion`, #138's `updatedAt`, and #87's partitioning direction.

**Relations:** Consumes #138 (timestamps); per-book wipe becomes trivial if #87
chooses per-book partitioning; wipe UX already exists draft-wide (`WipeModal`).

**Recommended draft body:**

> Provide a view showing, per book: whether any interlinear data exists, how
> many tokens/segments are analyzed (approved vs. suggested), and last-modified
> (needs #138's `updatedAt`; per-book timestamps come free if #87 adopts per-book
> partitioning). From the same view, allow wiping a single book's analysis —
> the wipe-current-book flow already exists in `WipeModal`; this generalizes it
> to any book without navigating there.
>
> Counting is a pure function over `TextAnalysis` filtered by book
> (`analysis-book.ts` already has the ref-prefix filtering).
>
> **Size:** M
>
> **Priority:** P3

### #43 — Split/join tokens that were wrongly tokenized

**Summary:** Add the dependency note: persistence across retokenization is
exactly the identity problem, so this issue should wait on #136.

**Relations:** Blocked by #136 (re-anchoring strategy); sibling of #49; the
"remembered when the book is retokenized" clause in the current body is the
hard part.

**Recommended body addition:**

> **Dependency (2026-07 audit):** "remembered when the book is retokenized" is
> the crux. Token refs are derived from character offsets, so a split/join
> shifts every subsequent token's ref in the segment and orphans their analysis
> links. This issue is blocked on the re-anchoring strategy decision (#136); the
> likely shape here is a persisted per-project list of token operations
> (split/join at snapshot positions) replayed after tokenization.
>
> **Size:** L (after #136)
>
> **Priority:** P2 (labeled "up next", but sequence after #136)

### #49 — Adjust segment boundaries

**Summary:** Draft a body for this currently-empty issue, scoping it and
flagging the same identity dependency as #43.

**Relations:** Blocked by #136; sibling of #43; the model already supports
sub-verse segments (`ScriptureRef.charIndex`, segments as "sentence, clause, or
verse") but the tokenizer only emits verse-granularity segments today.

**Recommended draft body:**

> Allow users to adjust segment boundaries — splitting a verse into
> sentence/clause segments or merging — so analysis (especially free
> translation) can attach at the right granularity. The model already supports
> sub-verse segments (`startRef`/`endRef` with `charIndex`), but
> `tokenizeBook` emits exactly one segment per verse, and `Segment.id` is the
> verse SID — sub-verse segments need an id scheme and re-anchoring story
> (blocked on #136). Segment changes also re-parent tokens, affecting
> `SegmentAnalysisLink`s and free translations.
>
> **Size:** L (after #136)
>
> **Priority:** P3 (labeled "up next", but sequence after #136 and #43)

### #61 — Decide what to do with unnamed projects to make them visually distinct

**Summary:** Add a small note that #138's `updatedAt` provides the "datetime
last-modified" option the issue already lists.

**Relations:** Consumes #138; UI-only otherwise.

**Recommended body addition:**

> **Note (2026-07 audit):** the "datetime created or last-modified"
> distinguisher needs a model field for the latter — `updatedAt` is proposed as
> #138 (XS). With it, the cheapest resolution here is: show
> `analysisLanguages` + created/modified dates in the picker, and autogenerate
> display-only names ("English interlinear 2") without persisting them.
>
> **Size:** S
>
> **Priority:** P3

---

## Suggested sequencing (dependency view)

```
#137 modelVersion ─────────────┬──▶ #128 public query API
#140 invariant validation ─────┘
#136 identity/re-anchoring ────┬──▶ #43 split/join ──▶ #49 segment boundaries
#142 integration/drift tests ──┘         (#142 before/alongside #136 landing)
#138 updatedAt ────────────────┬──▶ #61 unnamed projects, #117 book status
#87 per-book partitioning ─────┘         (#87 needs #137)
#94 PT9 fields, #130 morphType, #139 segment staleness, #129 Burrito,
#97 RTL, #141 orphan cleanup — independent of the chains above
```
