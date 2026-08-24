# Entry point × consequence matrix, on the focus store

Every way navigation can start, and what each subsystem does about it.
`interlinearizer-extension`, branch `feat/focus-store` @ `355e352` (unmerged).

A flowchart of this information needs six nested branches and hides its empty cells. A matrix
makes "nobody has thought about this combination" a visible blank.

[03-entry-point-matrix.md](03-entry-point-matrix.md) is the same matrix read off
`perf/continuous-view-responsiveness` @ `0ab3de6`. The entry points are unchanged — the branch adds
no way to start a navigation and removes none. What changed is the middle of the table: focus lives
in a store, every write to it carries an origin recorded at the call site, and the strip decides
what to do by reading that origin rather than by recognising its own echo. Table A therefore
carries two origin columns now, and rows 5 through 7 gained couplings to rows 1, 2, 4 and 13 that
the old matrix had no way to show.

---

## Table A — what the entry point writes

| #   | Entry point                                      | Writes `scrRef`?                                                | Nav origin             | Focus origin                                        | Other state                                                    |
| --- | ------------------------------------------------ | --------------------------------------------------------------- | ---------------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `BookChapterControl` submit (power-mode toolbar) | yes                                                             | **external** (default) | `reseed`, indirectly and often not at all [^1]      | —                                                              |
| 2   | Scroll-group delivery (other WebView / Paratext) | yes (host-side)                                                 | **external**           | `reseed`, as row 1 [^1]                             | duplicate delivery collapsed [^2]                              |
| 3   | `ScrollGroupSelector` change                     | only via the host's next delivery                               | **external**           | —                                                   | `scrollGroupId`                                                |
| 4   | Segment-list click or focus (4 handlers) [^3]    | only when the verse differs                                     | **internal**           | `list` — clicked token, or the segment's first word | —                                                              |
| 5   | Strip prev / next arrow [^4]                     | only when the target segment does not contain the current verse | **internal**           | `strip` — first token of the ±1 group               | —                                                              |
| 6   | Strip phrase click                               | same as 5                                                       | **internal**           | `strip` — no-op if already the focused group        | may supersede a fade [^5]                                      |
| 7   | Phrase-mode entry (`edit` / `confirm-unlink`)    | same as 5                                                       | **internal**           | `strip` — first token of the phrase                 | `phraseMode`; may supersede a fade [^5]                        |
| 8   | LocateFixed button                               | no                                                              | —                      | —                                                   | —                                                              |
| 9   | Continuous-scroll toggle                         | no                                                              | —                      | —                                                   | setting (optimistic), `displayContinuousScroll` at midpoint    |
| 10  | `simplifyPhrases` / `showMorphology` toggle      | no                                                              | —                      | —                                                   | setting (optimistic)                                           |
| 11  | Boundary edit — merge / split / move             | no                                                              | —                      | — token refs survive re-segmentation [^6]           | `segmentationVersion`, new `book` identity, phrase splits [^7] |
| 12  | Book change (rows 1–3 naming another book)       | yes                                                             | **external**           | `seed` — a new store, built during render [^8]      | `fadePhase`, remount via `key={book.bookRef}`                  |
| 13  | `requestFocusToken` (public seam) [^9]           | no — caller must navigate itself                                | —                      | `request`, if this book resolves the ref            | `focusRequestCount`                                            |
| 14  | Initial mount                                    | no                                                              | —                      | `seed` from the active segment's first word [^8]    | —                                                              |
| 15  | User scroll in the segment list                  | **no — scrolling never navigates**                              | —                      | —                                                   | `range`, `pinnedChapter`                                       |
| 16  | Panel resize / late strip reflow                 | no                                                              | —                      | —                                                   | `phraseWindowHalf`, `renderWindowStart`                        |

---

## Table B — what each subsystem does about it

| #   | Segment list (`useSegmentWindow`)                                                                         | Strip (`ContinuousView`) [^10]                                                                                                        | Strip arrows  | Gated display refs            | `committedActiveSegmentId`                 | Curtain (`fadePhase`)                                   | `onSettled`                                   |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------- | ------------------------------------------ | ------------------------------------------------------- | --------------------------------------------- |
| 1   | **fade** 500ms → rebuild centered → snap → settle                                                         | **fade** → snap + `holdCentered`, unless superseded [^5]                                                                              | disabled [^4] | lag to midpoint               | immediate (at the jump)                    | —                                                       | yes                                           |
| 2   | as row 1                                                                                                  | as row 1                                                                                                                              | disabled [^4] | lag to midpoint               | immediate                                  | —                                                       | yes                                           |
| 3   | nothing until a ref arrives                                                                               | nothing until a ref arrives                                                                                                           | live          | —                             | —                                          | —                                                       | no                                            |
| 4   | **no fade** — target already mounted                                                                      | **fade** → snap + hold [^11]                                                                                                          | disabled [^4] | immediate                     | immediate                                  | —                                                       | no                                            |
| 5   | **no fade**                                                                                               | **glide** — rAF-deferred smooth scroll                                                                                                | live [^4]     | immediate                     | deferred to `scrollend` \| 600ms           | —                                                       | no                                            |
| 6   | **no fade**                                                                                               | **glide**; reveals the strip when it superseded a fade                                                                                | live          | immediate                     | deferred                                   | —                                                       | no                                            |
| 7   | **no fade**                                                                                               | **glide**; reveals as row 6                                                                                                           | live          | immediate                     | deferred                                   | —                                                       | no                                            |
| 8   | **fade** + rebuild + snap — always, even if the verse is already mounted                                  | nothing (focus unchanged)                                                                                                             | live          | lag to midpoint (same values) | unchanged                                  | —                                                       | yes (ignored)                                 |
| 9   | **fade** + rebuild; flips `displayContinuousScroll` inside the midpoint batch                             | mounts / unmounts in that **same commit**; fresh mount takes the instant-jump + hold path                                             | live on mount | lag to midpoint               | immediate on mount                         | —                                                       | yes                                           |
| 10  | nothing                                                                                                   | instant `centerGroup`, no hold [^12]                                                                                                  | live          | —                             | unchanged                                  | —                                                       | no                                            |
| 11  | **no fade** — range shifted by `anchorDelta`                                                              | reconcile commits now, or defers to an in-flight glide's settle; a moved `renderWindowStart` re-centers + holds                       | live          | synced in the edit's commit   | immediate, unless `scrollSettlePendingRef` | —                                                       | no                                            |
| 12  | fresh mount; `needsInitialSnap` when the anchor is mid-book → snap before paint                           | fresh mount → instant jump + hold; `focusPhraseIndex` falls back to the **live** focus while the display ref still names the old book | live on mount | seeded                        | immediate                                  | `out` (0ms) → hold through load → `in` → 500ms → `idle` | yes — this is what lifts the curtain          |
| 13  | nothing by itself                                                                                         | **fade** → snap + hold                                                                                                                | disabled [^4] | immediate                     | immediate                                  | —                                                       | no                                            |
| 14  | window built centered; snap only if `anchorIndex > range.start`                                           | instant jump + hold; names its own first token only when nothing resolved one [^8]                                                    | live          | initial values                | initial value                              | —                                                       | yes (next frame, or after the snap lifecycle) |
| 15  | `extend` ±6 at the sentinel, cull past 800px, restore the anchor element's viewport position before paint | untouched                                                                                                                             | live          | —                             | —                                          | —                                                       | no                                            |
| 16  | `ResizeObserver` compensation (or relay to the re-snap while a recenter is in flight)                     | re-measure → window may resize → layout-effect re-center + hold, deferred if a glide is in flight                                     | live          | —                             | —                                          | —                                                       | no                                            |

---

## Legend

- **fade** — the 500ms `RECENTER_FADE_MS` clock: fade out, swap content at the midpoint, fade back in.
- **glide** — `scrollIntoView({ behavior: 'smooth' })`, deferred one rAF so the window slide settles first.
- **snap** — `scrollIntoView({ behavior: 'auto' })`, always behind a fade or a curtain.
- **hold** — `holdCentered`: re-centers every frame until the content row stops reflowing (quiet period
  `LINK_SLOT_TRANSITION_MS`, hard cap `HOLD_CENTERED_MAX_MS`).
- **Nav origin** — `NavOrigin`, recorded at the `navigate` call site and read by the segment window
  through `consumeInternalNav`. Two values: an `internal` target is already mounted, an `external`
  one may be anywhere.
- **Focus origin** — `FocusOrigin`, recorded at the focus write and read by whoever subscribes. Five
  values: `seed`, `strip`, `list`, `reseed`, `request`. Not the same axis as the nav origin, and
  deliberately so — see asymmetry 1.
- **Gated display refs** — `displayScrRef` / `displayFocusedTokenRef`. "Lag to midpoint" means the
  highlight and every link-button active/disabled decision move only behind the fade, so buttons
  never re-evaluate (and dim) on the old, still-visible content.
- **Strip arrows** — whether row 5 is reachable while this row is in flight. `isStepBlocked` is the
  gate; see asymmetry 7.

---

## What the blanks and asymmetries say

1. **Rows 4 and 5 disagree about the strip on purpose, and now say so in a type.** Both are
   `internal` navigations as far as the _list_ is concerned. The strip asks a different question —
   did _I_ make this move? — and answers it by reading `FocusOrigin`, so a `list` write fades it and
   a `strip` write glides. The old matrix described the same split as the strip recognising its own
   echo through `internalFocusedTokenRefRef`; that reconstruction is gone. Two meanings of
   "internal" still coexist, one per subsystem, but they are now two named vocabularies rather than
   one word doing double duty.

2. **Row 1 can leave the strip completely still.** The verse rule early-returns when the focused
   token's own segment already contains the new verse, so an external navigation _within one
   segment_ fades and rebuilds the list while the strip does not move at all. Still intentional, and
   no longer undocumented: the rule and its reason now sit together in `FocusStore.tsx`, which is
   what the old matrix's version of this entry complained was missing.

3. **Row 8 always fades**, even when the target is already mounted, so that every recenter in the
   panel stays on one clock. It is the only row that fades with no reference and no focus change.

4. **Row 11 is the only content change that must _not_ fade** — hence `segmentationVersion` exists at
   all. Anchor coordinates misclassify it in both directions, so an explicit signal was needed. The
   focus side needs no signal: token refs survive re-segmentation, so the resolve effect finds the
   focus still resolving and writes nothing.

5. **Row 15 writes nothing.** Scrolling the list never moves the active verse, so the list's scroll
   position and the active verse can drift arbitrarily far apart — which is why row 8 exists.

6. **Row 13 has no production caller.** `requestFocusToken` is exercised only by tests
   (`FocusStore.test.tsx`, `Interlinearizer.test.tsx`, `InterlinearNavContext.test.tsx`). Its
   contract — a request moves focus and nothing else, so the caller must navigate too — is
   unenforced by any real call site.

7. **Rows 1, 2, 4 and 13 disable row 5 for half a second.** Each fades the strip, and across that
   fade the displayed focus lags the live one, so `isStepBlocked` disables both arrows: a step there
   would count from a group the reader can no longer see. The rows of this matrix are not
   independent — one entry point can make another unreachable, and only for a transient the matrix
   has no column for. Row 5 itself is exempt by origin rather than by timing, which is what keeps
   the second of a pair of rapid presses from being dropped.

8. **Rows 6 and 7 can cancel the clock rows 1, 2, 4 and 13 started.** Opacity does not stop pointer
   events, so a phrase box stays clickable through the fade that is hiding it. Such a click writes
   `strip`, takes the glide branch, and reveals the strip — the reveal the cancelled fade timer
   would otherwise have owed and never run. This is the one place where the arrows being disabled
   matters for correctness rather than for feel: the arrows cannot supersede a fade, so the phrase
   boxes are the only route into that state.

9. **Combinations worth a test that the matrix cannot show as covered:** LocateFixed pressed
   mid-glide; a scroll-group delivery arriving during a cross-book load; a book change with a phrase
   edit open; two rapid clicks batched into one commit (the case `INTERNAL_NAV_TTL_MS` exists for);
   a phrase click landing in the final frame of a fade, where the supersede and the timer race.

---

[^1]:
    `FocusProvider`'s resolve effect reseeds the focus to the active segment's first word token —
    unless the focused token's own segment already contains the new verse (see asymmetry 2), which
    is the common case for a short hop. The effect runs its rules in one fixed order, and a write
    naming the token already focused is dropped, so most external navigations move no focus at all.

[^2]:
    The host resolves one scripture-picker selection as two deliveries. `areScrRefsEqual` hands
    back the previously adopted object so `scrRef` identity does not change, and
    `useInterlinearizerBookData` does the same for the duplicate USJ payload.

[^3]:
    Segment background click, baseline-text body click, token-chip click (token-chip mode), and
    free-translation input focus. All four route through `onSelect` → `selectSegment`. A baseline
    click on a segment with no word token passes no token ref, so it navigates without moving
    focus.

[^4]:
    Both arrows are disabled while `isStepBlocked` — the displayed focus lags the live one _and_ the
    origin is not `strip`. The second half of that test is what exempts row 5's own glide, whose
    displayed ref also lags briefly; testing the lag alone would leave the exemption resting on
    React reaching the focus-change effect within the same discrete event as the press. See
    asymmetry 7.

[^5]:
    The fade timer lives in `fadeTimeoutRef` rather than in the focus effect's cleanup, so the run
    that supersedes a fade can tell there was one to cancel — and take on the reveal the cancelled
    timer will never run. A cleanup drops the timer before the superseding run can see it, which is
    how a phrase click on a half-faded box used to strand the strip at opacity 0. See asymmetry 8.

[^6]:
    The resolve effect sees a new `book` identity, finds the focused ref still resolves in it, and
    falls through to the verse rule — which finds the verse unmoved and writes nothing.

[^7]:
    A split first force-breaks every phrase the new boundary would cut
    (`forceBreakStraddledPhrases`), so no phrase ever spans two segments. Merge only removes a
    boundary and passes through.

[^8]:
    `createFocusStore` seeds during the provider's first render, not in an effect, so a mounting
    view already knows where to look. `Interlinearizer` is keyed on `book.bookRef`, so a book change
    builds a whole new store rather than reseeding the old one. The strip's own mount-time seed
    fires only when that construction resolved nothing — which needs the active verse to own no word
    token.

[^9]:
    A request naming another book stays pending until navigation leaves that book; a ref the book
    cannot resolve is dropped and logged. It is claimed first in the resolve effect's ordered rules,
    so it outranks both reseeds by construction — where the old matrix had it winning by being
    declared last among three separate effects.

[^10]:
    The strip exists only in continuous-scroll mode. In segment mode every strip cell reads
    "unmounted".

[^11]:
    External _to the strip_ — the write carried origin `list`, not `strip`, so it takes the fade
    path.

[^12]:
    `hideInactiveLinkButtons` is deliberately excluded: hidden slots keep their layout space
    (`opacity: 0`), so toggling it shifts nothing.
