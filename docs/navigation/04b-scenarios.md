# Scenario atlas — six canonical navigations, on the focus store

Causality per scenario, across the six actors that matter: the host, the nav provider, the focus
store, the loader, the segment window, and the strip. `interlinearizer-extension`, branch
`feat/focus-store` @ `b5ffa88` (unmerged).

> **Viewing:** these are mermaid `sequenceDiagram` blocks, which GitHub renders natively in the file
> view. In VS Code they need the _Markdown Preview Mermaid Support_ extension; without it the
> built-in preview shows the source as a code block.

## What changed under these scenarios

[04-scenarios.md](04-scenarios.md) describes the same six navigations on
`perf/continuous-view-responsiveness`, where focus was `Interlinearizer` state passed down as a
prop, and each view reconstructed where a focus move came from — the strip by stamping
`internalFocusedTokenRefRef` before emitting and comparing on the way back. This branch hoists focus
into `src/components/FocusStore.tsx`. Three consequences run through every diagram below:

1. **Origin is recorded at the call site, not reconstructed.** Every write carries a `FocusOrigin` —
   `seed`, `strip`, `list`, `reseed`, or `request` — and each consumer maps origin to behavior
   itself. The strip glides for `strip` and fades for everything else; the segment window still asks
   its own, wider question through `consumeInternalNav`. The two disagreeing about one event is now
   a stated design point rather than two independent guesses that happen to differ.
2. **A focus move no longer re-renders `Interlinearizer`.** `useFocus` is a `useSyncExternalStore`
   subscription, so an arrow step wakes the strip and the list and nothing else — pinned by _leaves
   Interlinearizer unrendered by a focus move inside the active verse_ in
   `Interlinearizer.test.tsx`.
3. **The reseed rules are one ordered rule set in one effect.** Request outranks the book reseed,
   which outranks the verse reseed, so no two rules can race on which reseed wins. A write naming
   the token already focused is dropped, so a reseed resolving to the standing focus wakes nobody.

`FocusProvider` sits inside `Interlinearizer`'s fade wrapper and above both views, so the store
outlives a continuous-scroll toggle but not a book change — `Interlinearizer` is keyed on
`book.bookRef`.

---

## A — External navigation, same book

The baseline case, and the one that shows why the duplicate-delivery guard exists.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant H as Host PAPI scroll group
    participant N as InterlinearNavProvider
    participant F as FocusProvider store
    participant W as useSegmentWindow
    participant S as ContinuousView strip

    U->>H: pick LUK 2:1 in BookChapterControl
    H->>N: handleSubmit calls navigate ref, origin defaults to external
    N->>H: setScrRef ref
    H-->>N: delivery 1, a new object
    Note over N: areScrRefsEqual false, adopt it
    H-->>N: delivery 2, value-equal but a fresh object
    Note over N: areScrRefsEqual true, hand back the PREVIOUS object.<br/>Context value identity unchanged, so no nav consumer re-renders

    Note over N,S: the new scrRef flows down as a prop, so Interlinearizer and both<br/>views re-render for the reference — unlike a pure focus move
    N->>W: scrRef changed, so anchorIndex moved
    W->>N: consumeInternalNav scrRef
    N-->>W: false, no marker
    W->>W: triggerRecenter, markRecenterStarted, setIsFaded true
    Note over W: 500 ms RECENTER_FADE_MS

    N->>F: same commit, the resolve effect runs
    Note over F: consumeFocusRequest finds nothing, the book held still,<br/>so the verse rule decides

    alt the focused token's OWN segment contains the new verse
        Note over F,S: no write. The deliberate focus stands, the strip never fades,<br/>and only the window's own recenter is visible
    else it does not
        F->>F: write firstWordTokenRefOf activeSegment, origin reseed
        F-->>S: store notify
    end

    W->>W: MIDPOINT, one state batch: rebuild range, beginRecenterSettle,<br/>setDisplayScrRef, setDisplayFocusedTokenRef from the LIVE focus,<br/>onDisplayContinuousScrollChange, setIsFaded false
    Note over W: the within-verse focus effect is skipped while recenterTimeoutRef<br/>is set, so the reseed lands at the midpoint and not before
    W->>W: layout effect, snapActiveToTop before paint
    W->>W: rAF re-snap, then a 100 ms quiet window
    W->>N: reportSettled
    Note over N: awaitingSettle is false for a same-book nav, so this is ignored

    Note over S: focusOrigin is reseed, not strip, so EXTERNAL
    S->>S: setIsVisible false
    Note over S: 500 ms. isStepBlocked is true across it, since the live focus and<br/>the displayed one disagree, so BOTH arrows are disabled — a step would<br/>otherwise count from a group the reader can no longer see
    S->>S: swap the display ref, snap, commitPendingActiveSegment,<br/>skipSlotTransitionForJump, holdCentered
```

---

## B — Cross-book jump

The only scenario with a curtain, and the only one where a single user action arrives as two
navigations.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant H as Host
    participant N as InterlinearNavProvider
    participant L as InterlinearizerLoader
    participant I as Interlinearizer keyed on book
    participant F as FocusProvider store
    participant W as useSegmentWindow

    U->>H: pick JHN 3:16 while looking at LUK
    H-->>N: scrRef.book becomes JHN
    Note over N: RENDER PHASE. scrRef.book differs from displayedBookRef,<br/>so awaitingSettle becomes true and setFadePhase out — same commit
    N->>L: fadePhase is out
    Note over L: curtain opacity 0 at transitionDuration 0ms. Instant, not gradual,<br/>because the old book is swapped for Loading in this very commit
    Note over L: isCrossBookSwap, scrRef.book differs from book.bookRef, so showLoading
    L->>I: unmount the old book's whole subtree
    Note over F: the store goes with it. Nothing is carried across —<br/>the new book seeds its own

    L->>H: useProjectData BookUSJ for JHN 1:1
    H-->>L: USJ payload, stabilized against the duplicate delivery
    L->>L: extractBookFromUsj, tokenizeBook, resegmentBook
    L->>L: activeScrRef, verse 0 becomes 1, an unmatched verse becomes<br/>the nearest preceding verse start in its chapter
    L->>I: mount with key JHN
    I->>F: FIRST RENDER, createFocusStore seeded with the first word token<br/>of the segment that owns the active verse, origin seed
    Note over F: seeded during render, not in an effect, so the strip and the list<br/>mount already knowing where to look. No reseed frame, no fade
    F->>F: first effect run, consumeFocusRequest bookRef
    Note over F: a request made before the load is claimed HERE and outranks<br/>the seed. One matching no word token is dropped with a warning
    I->>W: fresh hook, needsInitialSnap is anchorIndex greater than range.start
    W->>W: layout effect, snapActiveToTop before paint
    W->>W: rAF re-snap, relayResize on each settling wave, 100 ms quiet,<br/>500 ms deadline as the backstop
    W->>N: reportSettled
    Note over N: awaitingSettle cleared, displayedBook becomes JHN,<br/>setFadePhase in, then a 500 ms timer to idle

    H-->>N: second delivery, the precise target, arriving mid-reveal
    Note over N: fadePhase is in, the verse changed, no fresh internal marker,<br/>so RE-ENGAGE: clear the fade-in timer, awaitingSettle true, fadePhase out
    Note over N: the curtain lifts once on the next settle, instead of fading<br/>the just-revealed content a second time

    Note over L,N: on a load error the loader calls cancelFade instead,<br/>so the error is shown rather than left behind a curtain that never lifts
```

The nav provider drops an unclaimed focus request once navigation lands on a book other than the one
it names — the abandon effect depends on `scrRef.book` alone, so a verse navigation _within_ the
requested book leaves the request standing for the load that has yet to arrive.

---

## C — Strip arrow step

The internal path. Nothing fades; everything is a glide with a deferred relayout.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant S as ContinuousView
    participant F as FocusProvider store
    participant N as InterlinearNavProvider
    participant H as Host
    participant W as useSegmentWindow

    U->>S: click the next-phrase arrow
    S->>F: step reads getFocus, the focus as of the PRESS
    Note over S,F: counted from the store, not the rendered index. A second press<br/>before the re-render accumulates, and a phrase-link edit that regrouped<br/>the strip without moving focus still steps from the right place
    S->>F: focusToken nextRef, origin strip
    F->>F: store.write SYNCHRONOUSLY, so the next press already sees it

    alt the target segment does not contain the current verse
        Note over F: and its book still matches the active reference —<br/>mid cross-book nav an echo of the stale verse is suppressed
        F->>N: navigate seg.startRef, origin internal
        N->>N: pendingInternalNav.set verseKey, Date.now
        N->>H: setScrRef
        H-->>N: echo
        N->>W: scrRef changed, so anchorIndex moved
        W->>N: consumeInternalNav
        N-->>W: true, marker consumed and cleared
        W->>W: no fade. Sync displayScrRef and displayFocusedTokenRef
    else the focus stays inside the active verse
        Note over F,W: no navigate at all, so the window's recenter effect never fires.<br/>The within-verse focus effect syncs the highlight instead, and<br/>Interlinearizer is not re-rendered at all
    end

    F-->>S: store notify, the strip re-renders on its subscription
    Note over S: focusOrigin is strip, this view's own, so INTERNAL
    S->>S: setDisplayFocusedTokenRef immediately, lastDisplayUpdateWasInternal true
    Note over S: the live and displayed refs agree in this same commit, so isStepBlocked<br/>never goes true and the arrows stay live. Only a jump opens that window
    S->>S: cancel any live hold, then one rAF, then centerGroup smooth
    S->>S: scrollSettlePending true. Listen for scrollend on BOTH the clipping<br/>viewport and the content row, with a 600 ms fallback timeout
    S-->>S: whichever fires first calls onSettled, the other is torn down
    S->>S: if the window moved mid-glide, centerGroup auto plus holdCentered
    S->>S: commitPendingActiveSegment. The inactive link icons relayout only NOW
```

Entering edit or confirm-unlink mode takes the same path: the strip focuses the active phrase's
first token with origin `strip`, so the move glides rather than fading.

---

## D — Token click in the segment list

The asymmetry worth internalising: one action, `list` rather than `strip`, so a move for the view
that made it and a jump for the other.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant SV as SegmentView
    participant F as FocusProvider store
    participant N as InterlinearNavProvider
    participant W as useSegmentWindow
    participant S as ContinuousView

    U->>SV: click a token chip
    SV->>F: onSelect ref, tokenRef — the provider's selectSegment
    Note over SV,F: the free-translation input's focus and submit handlers<br/>route through the same action with the segment's first word token

    alt the clicked verse differs from the current one
        F->>N: navigate ref, origin internal
        N->>W: via the host echo, anchor change with consumeInternalNav true
        W->>W: no fade, display refs synced immediately
    else the clicked verse is already current
        Note over F,N: no PAPI write at all, the echo round-trip is skipped
    end

    F->>F: write tokenRef, origin list
    Note over F: selecting a whole segment passes no tokenRef, so focus holds still
    F-->>W: store notify
    F-->>S: store notify
    Note over S: focusOrigin is list, not strip, so EXTERNAL to the strip
    S->>S: setIsVisible false, wait 500 ms, then snap, commit, holdCentered
    Note over S: isStepBlocked through that wait, so the strip's arrows are disabled<br/>while the list stays fully interactive
    Note over W,S: net effect, the list does not fade and the strip does.<br/>One origin field read two ways, rather than two views guessing
```

---

## E — Boundary edit landing mid-glide

Two independent clocks colliding. The interesting part is what does _not_ happen.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant SV as SegmentView boundary control
    participant L as InterlinearizerLoader
    participant I as Interlinearizer
    participant F as FocusProvider store
    participant W as useSegmentWindow
    participant S as ContinuousView

    Note over S: an arrow-step glide is still animating, scrollSettlePending is true
    U->>SV: click merge on a boundary
    SV->>L: dispatch.merge secondSegmentStartRef
    L->>L: apply the delta, auto-save, bump segmentationVersion
    L->>I: new book identity plus segmentationVersion incremented
    I->>F: the resolve effect runs on the new book identity
    Note over F: the book moved, but token refs survive re-segmentation, so the focus<br/>still resolves. Falls through to the verse rule, and the verse held still
    F->>F: NO write. The focus and its origin both stand
    I->>W: segments identity changed AND the version bumped
    Note over W: isBoundaryEdit, so this is NOT a navigation
    W->>W: shift range by anchorDelta. A merge moves every later index by minus 1,<br/>so the stored absolute range would otherwise slice the wrong content
    W->>W: sync the display refs. NO fade, because the user is looking at the edit
    I->>S: tokenSegmentMap identity changed while the focus did not
    Note over S: scrollSettlePending, so do NOT commit now. Committing would flip<br/>committedActiveSegmentId and truncate the glide into a snap
    S-->>S: the glide's own scrollend fires
    S->>S: onSettled commits against the live target, which already<br/>reflects the re-segmentation
    Note over S: a moved renderWindowStart also defers to this settle,<br/>via windowChangedDuringScrollRef
```

When the edit _does_ strand the focus — a re-tokenization in which the focused ref no longer
resolves — the book rule fires instead and reseeds to the active verse's first word with origin
`reseed`, which the strip then reads as a jump.

---

## F — Continuous-scroll toggle

The one place where a callback is used instead of a returned value, and the reason is one React
commit.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant V as ViewOptionsDropdown
    participant L as InterlinearizerLoader
    participant I as Interlinearizer
    participant SL as SegmentListView
    participant W as useSegmentWindow
    participant S as ContinuousView

    U->>V: toggle continuous scroll
    V->>L: handleContinuousScrollChange, an optimistic setting write
    L->>I: continuousScroll true
    Note over I: isModeToggleFading is continuousScroll versus displayContinuousScroll,<br/>so the whole wrapper, strip and list together, fades on the shared clock
    I->>SL: continuousScroll changed
    SL->>W: the mode-switch effect calls recenterOnActive
    W->>W: setIsFaded true
    Note over W: 500 ms
    W->>W: MIDPOINT, one state batch: rebuild range, beginRecenterSettle,<br/>sync the display refs, setIsFaded false
    W->>I: onDisplayContinuousScrollChange true, inside that SAME batch
    I->>S: mount, in the same React commit as the window rebuild
    Note over S: FocusProvider is above the toggle and is not keyed, so the store<br/>outlives this mount. displayFocusedTokenRef initializes to the standing<br/>focus, and the mount-time seed effect finds one and does nothing
    W->>W: the re-snap loop therefore measures the active verse against<br/>the final, strip-included layout
    S->>S: initial-load path, so an instant jump plus holdCentered
    W->>W: settling waves relayed via relayResize, 100 ms quiet, then onSettled
    Note over W,S: routing this through a callback rather than an effect on a returned<br/>value is what keeps the strip mount and the rebuild in one commit
```

The strip's mount-time seed effect only fires when nothing has resolved a focus at all — which
needs the active verse to own no word token. When it does fire it writes origin `seed`, and because
`seed` is not `strip` the strip reads its own naming as a jump: one `RECENTER_FADE_MS` behind the
already-invisible strip, then the instant snap and the reveal.

---

## Origin, end to end

Where each `FocusOrigin` is written, and what each side does with it.

| Origin    | Written by                                                            | Strip | Segment window                          |
| --------- | --------------------------------------------------------------------- | ----- | --------------------------------------- |
| `seed`    | `createFocusStore` at provider construction; the strip's mount effect | jump  | no navigation, so no recenter           |
| `strip`   | `focusToken` from an arrow step, phrase click, or phrase-mode entry   | glide | `consumeInternalNav` true, no fade      |
| `list`    | `selectSegment` from a click or focus in the list                     | jump  | `consumeInternalNav` true, no fade      |
| `reseed`  | the resolve effect's book and verse rules                             | jump  | external nav, fade and recenter         |
| `request` | the resolve effect claiming `consumeFocusRequest`                     | jump  | unmoved unless the caller navigates too |

Every `jump` row shares one side effect: the displayed ref lags the live focus for a
`RECENTER_FADE_MS` fade, and `isStepBlocked` disables both strip arrows across that window, so a
step can never count from a group the reader has stopped seeing. The `strip` row is the only one
that adopts the focus in the same commit, which is why rapid arrow presses still accumulate.

`request` has no production caller yet — `requestFocusToken` is exposed on the nav surface and
claimed by `FocusProvider`, but nothing in the extension calls it. If one is added, this row and
diagram 3's row 13 both need revisiting.
