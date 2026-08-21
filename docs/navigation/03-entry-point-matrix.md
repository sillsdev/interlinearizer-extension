# Entry point × consequence matrix

Every way navigation can start, and what each subsystem does about it.
`interlinearizer-extension`, branch `perf/continuous-view-responsiveness` @ `0ab3de6` (unmerged).

A flowchart of this information needs six nested branches and hides its empty cells. A matrix
makes "nobody has thought about this combination" a visible blank.

---

## Table A — what the entry point writes

| #   | Entry point                                      | Writes `scrRef`?                                                | Origin                 | Changes `focusedTokenRef`?                       | Other state                                                    |
| --- | ------------------------------------------------ | --------------------------------------------------------------- | ---------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| 1   | `BookChapterControl` submit (power-mode toolbar) | yes                                                             | **external** (default) | indirectly — reseed effect [^1]                  | —                                                              |
| 2   | Scroll-group delivery (other WebView / Paratext) | yes (host-side)                                                 | **external**           | indirectly — reseed effect [^1]                  | duplicate delivery collapsed [^2]                              |
| 3   | `ScrollGroupSelector` change                     | only via the host's next delivery                               | **external**           | —                                                | `scrollGroupId`                                                |
| 4   | Segment-list click or focus (4 handlers) [^3]    | only when the verse differs                                     | **internal**           | yes — clicked token, or the segment's first word | —                                                              |
| 5   | Strip prev / next arrow                          | only when the target segment does not contain the current verse | **internal**           | yes — first token of the ±1 group                | `pendingPhraseIndexRef` (sync)                                 |
| 6   | Strip phrase click                               | same as 5                                                       | **internal**           | yes — no-op if already the focused group         | —                                                              |
| 7   | Phrase-mode entry (`edit` / `confirm-unlink`)    | same as 5                                                       | **internal**           | yes — first token of the phrase                  | `phraseMode`                                                   |
| 8   | LocateFixed button                               | no                                                              | —                      | no                                               | —                                                              |
| 9   | Continuous-scroll toggle                         | no                                                              | —                      | no                                               | setting (optimistic), `displayContinuousScroll` at midpoint    |
| 10  | `simplifyPhrases` / `showMorphology` toggle      | no                                                              | —                      | no                                               | setting (optimistic)                                           |
| 11  | Boundary edit — merge / split / move             | no                                                              | —                      | no — token refs survive re-segmentation          | `segmentationVersion`, new `book` identity, phrase splits [^4] |
| 12  | Book change (rows 1–3 naming another book)       | yes                                                             | **external**           | yes — reseed on the new `book`                   | `fadePhase`, remount via `key={book.bookRef}`                  |
| 13  | `requestFocusToken` (public seam) [^5]           | no — caller must navigate itself                                | —                      | yes, if this book resolves the ref               | `focusRequestCount`                                            |
| 14  | Initial mount                                    | no                                                              | —                      | seeded from the active segment's first word      | —                                                              |
| 15  | User scroll in the segment list                  | **no — scrolling never navigates**                              | —                      | no                                               | `range`, `pinnedChapter`                                       |
| 16  | Panel resize / late strip reflow                 | no                                                              | —                      | no                                               | `phraseWindowHalf`, `renderWindowStart`                        |

---

## Table B — what each subsystem does about it

| #   | Segment list (`useSegmentWindow`)                                                                         | Strip (`ContinuousView`) [^6]                                                                                                         | Gated display refs            | `committedActiveSegmentId`                 | Curtain (`fadePhase`)                                   | `onSettled`                                   |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------ | ------------------------------------------------------- | --------------------------------------------- |
| 1   | **fade** 500ms → rebuild centered → snap → settle                                                         | **fade** → snap + `holdCentered`                                                                                                      | lag to midpoint               | immediate (at the jump)                    | —                                                       | yes                                           |
| 2   | as row 1                                                                                                  | as row 1                                                                                                                              | lag to midpoint               | immediate                                  | —                                                       | yes                                           |
| 3   | nothing until a ref arrives                                                                               | nothing until a ref arrives                                                                                                           | —                             | —                                          | —                                                       | no                                            |
| 4   | **no fade** — target already mounted                                                                      | **fade** → snap + hold [^7]                                                                                                           | immediate                     | immediate                                  | —                                                       | no                                            |
| 5   | **no fade**                                                                                               | **glide** — rAF-deferred smooth scroll                                                                                                | immediate                     | deferred to `scrollend` \| 600ms           | —                                                       | no                                            |
| 6   | **no fade**                                                                                               | **glide**                                                                                                                             | immediate                     | deferred                                   | —                                                       | no                                            |
| 7   | **no fade**                                                                                               | **glide**                                                                                                                             | immediate                     | deferred                                   | —                                                       | no                                            |
| 8   | **fade** + rebuild + snap — always, even if the verse is already mounted                                  | nothing (focus unchanged)                                                                                                             | lag to midpoint (same values) | unchanged                                  | —                                                       | yes (ignored)                                 |
| 9   | **fade** + rebuild; flips `displayContinuousScroll` inside the midpoint batch                             | mounts / unmounts in that **same commit**; fresh mount takes the instant-jump + hold path                                             | lag to midpoint               | immediate on mount                         | —                                                       | yes                                           |
| 10  | nothing                                                                                                   | instant `centerGroup`, no hold [^8]                                                                                                   | —                             | unchanged                                  | —                                                       | no                                            |
| 11  | **no fade** — range shifted by `anchorDelta`                                                              | reconcile commits now, or defers to an in-flight glide's settle; a moved `renderWindowStart` re-centers + holds                       | synced in the edit's commit   | immediate, unless `scrollSettlePendingRef` | —                                                       | no                                            |
| 12  | fresh mount; `needsInitialSnap` when the anchor is mid-book → snap before paint                           | fresh mount → instant jump + hold; `focusPhraseIndex` falls back to the **live** focus while the display ref still names the old book | reseeded                      | immediate                                  | `out` (0ms) → hold through load → `in` → 500ms → `idle` | yes — this is what lifts the curtain          |
| 13  | nothing by itself                                                                                         | **fade** → snap + hold                                                                                                                | immediate                     | immediate                                  | —                                                       | no                                            |
| 14  | window built centered; snap only if `anchorIndex > range.start`                                           | instant jump + hold; notifies parent of the first token if none focused                                                               | initial values                | initial value                              | —                                                       | yes (next frame, or after the snap lifecycle) |
| 15  | `extend` ±6 at the sentinel, cull past 800px, restore the anchor element's viewport position before paint | untouched                                                                                                                             | —                             | —                                          | —                                                       | no                                            |
| 16  | `ResizeObserver` compensation (or relay to the re-snap while a recenter is in flight)                     | re-measure → window may resize → layout-effect re-center + hold, deferred if a glide is in flight                                     | —                             | —                                          | —                                                       | no                                            |

---

## Legend

- **fade** — the 500ms `RECENTER_FADE_MS` clock: fade out, swap content at the midpoint, fade back in.
- **glide** — `scrollIntoView({ behavior: 'smooth' })`, deferred one rAF so the window slide settles first.
- **snap** — `scrollIntoView({ behavior: 'auto' })`, always behind a fade or a curtain.
- **hold** — `holdCentered`: re-centers every frame until the content row stops reflowing (quiet period
  `LINK_SLOT_TRANSITION_MS`, hard cap `HOLD_CENTERED_MAX_MS`).
- **Gated display refs** — `displayScrRef` / `displayFocusedTokenRef`. "Lag to midpoint" means the
  highlight and every link-button active/disabled decision move only behind the fade, so buttons
  never re-evaluate (and dim) on the old, still-visible content.

---

## What the blanks and asymmetries say

1. **Rows 4 and 5 disagree about the strip on purpose.** Both are `internal` navigations as far as
   the _list_ is concerned, but the strip classifies by whether _it_ emitted the change
   (`internalFocusedTokenRefRef`). A list click is external to the strip and fades it; an arrow step
   is internal and glides. Two different meanings of "internal" coexist, one per subsystem.

2. **Row 1 can leave the strip completely still.** The reseed effect early-returns when the focused
   token's own segment already contains the new verse, so an external navigation _within one segment_
   fades and rebuilds the list while the strip does not move at all. Intentional — but nothing in
   either file says so, which is what makes it read as a bug.

3. **Row 8 always fades**, even when the target is already mounted, so that every recenter in the
   panel stays on one clock. It is the only row that fades with no reference and no focus change.

4. **Row 11 is the only content change that must _not_ fade** — hence `segmentationVersion` exists at
   all. Anchor coordinates misclassify it in both directions, so an explicit signal was needed.

5. **Row 15 writes nothing.** Scrolling the list never moves the active verse, so the list's scroll
   position and the active verse can drift arbitrarily far apart — which is why row 8 exists.

6. **Row 13 has no production caller.** `requestFocusToken` is exercised only by tests
   (`Interlinearizer.test.tsx`, `InterlinearNavContext.test.tsx`). Its contract — a request moves
   focus and nothing else, so the caller must navigate too — is unenforced by any real call site.

7. **Combinations worth a test that the matrix cannot show as covered:** LocateFixed pressed mid-glide;
   a scroll-group delivery arriving during a cross-book load; a book change with a phrase edit open;
   two rapid clicks batched into one commit (the case `INTERNAL_NAV_TTL_MS` exists for).

---

[^1]:
    `Interlinearizer`'s `scrRef` effect reseeds `focusedTokenRef` to the active segment's first
    word token — unless the focused token's own segment already contains the new verse (see
    asymmetry 2).

[^2]:
    The host resolves one scripture-picker selection as two deliveries. `areScrRefsEqual` hands
    back the previously adopted object so `scrRef` identity does not change, and
    `useInterlinearizerBookData` does the same for the duplicate USJ payload.

[^3]:
    Segment background click, baseline-text body click, token-chip click (token-chip mode), and
    free-translation input focus. All four route through `onSelect` → `handleSegmentSelect`.

[^4]:
    A split first force-breaks every phrase the new boundary would cut
    (`forceBreakStraddledPhrases`), so no phrase ever spans two segments. Merge only removes a
    boundary and passes through.

[^5]:
    A request naming another book stays pending until navigation leaves that book; a ref the book
    cannot resolve is dropped and logged. The claim effect is declared _after_ both reseed effects
    so it wins by running last in the same commit.

[^6]:
    The strip exists only in continuous-scroll mode. In segment mode every strip cell reads
    "unmounted".

[^7]:
    External _to the strip_ — the strip did not emit it, so `internalFocusedTokenRefRef` does not
    match and it takes the fade path.

[^8]:
    `hideInactiveLinkButtons` is deliberately excluded: hidden slots keep their layout space
    (`opacity: 0`), so toggling it shifts nothing.
