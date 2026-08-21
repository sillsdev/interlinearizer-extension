# Scenario atlas — six canonical navigations

Causality per scenario, across the five actors that matter: the host, the nav provider, the loader,
the segment window, and the strip. `interlinearizer-extension`, branch `perf/continuous-view-responsiveness` @ `0ab3de6` (unmerged).

> **Viewing:** these are mermaid `sequenceDiagram` blocks, which GitHub renders natively in the file
> view. In VS Code they need the _Markdown Preview Mermaid Support_ extension; without it the
> built-in preview shows the source as a code block.

---

## A — External navigation, same book

The baseline case, and the one that shows why the duplicate-delivery guard exists.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant H as Host PAPI scroll group
    participant N as InterlinearNavProvider
    participant I as Interlinearizer
    participant W as useSegmentWindow
    participant S as ContinuousView strip

    U->>H: pick LUK 2:1 in BookChapterControl
    H->>N: handleSubmit calls navigate ref, origin defaults to external
    N->>H: setScrRef ref
    H-->>N: delivery 1, a new object
    Note over N: areScrRefsEqual false, adopt it
    H-->>N: delivery 2, value-equal but a fresh object
    Note over N: areScrRefsEqual true, hand back the PREVIOUS object.<br/>Context value identity unchanged, so no nav consumer re-renders

    N->>I: scrRef changed
    I->>I: reseed focusedTokenRef to the active segment's first word.<br/>Skipped when the focused token's own segment already contains the verse
    I->>W: scrRef plus focusedTokenRef
    W->>N: consumeInternalNav scrRef
    N-->>W: false, no marker
    W->>W: triggerRecenter, markRecenterStarted, setIsFaded true
    Note over W: 500 ms RECENTER_FADE_MS
    W->>W: MIDPOINT, one state batch: rebuild range, beginRecenterSettle,<br/>setDisplayScrRef, setDisplayFocusedTokenRef,<br/>onDisplayContinuousScrollChange, setIsFaded false
    W->>W: layout effect, snapActiveToTop before paint
    W->>W: rAF re-snap, then a 100 ms quiet window
    W->>N: reportSettled
    Note over N: awaitingSettle is false for a same-book nav, so this is ignored

    I->>S: focusedTokenRef changed
    Note over S: internalFocusedTokenRefRef does not match, so EXTERNAL
    S->>S: setIsVisible false
    Note over S: 500 ms
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
    participant W as useSegmentWindow

    U->>H: pick JHN 3:16 while looking at LUK
    H-->>N: scrRef.book becomes JHN
    Note over N: RENDER PHASE. scrRef.book differs from displayedBookRef,<br/>so awaitingSettle becomes true and setFadePhase out — same commit
    N->>L: fadePhase is out
    Note over L: curtain opacity 0 at transitionDuration 0ms. Instant, not gradual,<br/>because the old book is swapped for Loading in this very commit
    Note over L: isCrossBookSwap, scrRef.book differs from book.bookRef, so showLoading
    L->>I: unmount the old book's whole subtree

    L->>H: useProjectData BookUSJ for JHN 1:1
    H-->>L: USJ payload, stabilized against the duplicate delivery
    L->>L: extractBookFromUsj, tokenizeBook, resegmentBook
    L->>L: activeScrRef, verse 0 becomes 1, an unmatched verse becomes<br/>the nearest preceding verse start in its chapter
    L->>I: mount with key JHN
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

---

## C — Strip arrow step

The internal path. Nothing fades; everything is a glide with a deferred relayout.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant S as ContinuousView
    participant I as Interlinearizer
    participant N as InterlinearNavProvider
    participant H as Host
    participant W as useSegmentWindow

    U->>S: click the next-phrase arrow
    S->>S: step plus 1. pendingPhraseIndexRef advances SYNCHRONOUSLY,<br/>so a second click reads the advanced value, not the rendered index
    S->>S: emitInternalFocus, stamping internalFocusedTokenRefRef
    S->>I: onFocusedTokenRefChange ref
    I->>I: focusToken, setFocusedTokenRef ref

    alt the target segment does not contain the current verse
        I->>N: navigate seg.startRef, origin internal
        N->>N: pendingInternalNav.set verseKey, Date.now
        N->>H: setScrRef
        H-->>N: echo
        N->>W: scrRef changed, so anchorIndex moved
        W->>N: consumeInternalNav
        N-->>W: true, marker consumed and cleared
        W->>W: no fade. Sync displayScrRef and displayFocusedTokenRef
    else the focus stays inside the active verse
        Note over I,W: no navigate at all, so the window's recenter effect never fires.<br/>The within-verse focus effect syncs the highlight instead
    end

    I->>S: focusedTokenRef echoes back
    Note over S: it matches internalFocusedTokenRefRef, so INTERNAL
    S->>S: setDisplayFocusedTokenRef immediately, lastDisplayUpdateWasInternal true
    S->>S: cancel any live hold, then one rAF, then centerGroup smooth
    S->>S: scrollSettlePending true. Listen for scrollend on BOTH the clipping<br/>viewport and the content row, with a 600 ms fallback timeout
    S-->>S: whichever fires first calls onSettled, the other is torn down
    S->>S: if the window moved mid-glide, centerGroup auto plus holdCentered
    S->>S: commitPendingActiveSegment. The inactive link icons relayout only NOW
```

---

## D — Token click in the segment list

The asymmetry worth internalising: one action, "internal" to the list and "external" to the strip.

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant SV as SegmentView
    participant I as Interlinearizer
    participant N as InterlinearNavProvider
    participant W as useSegmentWindow
    participant S as ContinuousView

    U->>SV: click a token chip
    SV->>I: onSelect ref, tokenRef
    I->>I: handleSegmentSelect

    alt the clicked verse differs from the current one
        I->>N: navigate ref, origin internal
        N->>W: via the host echo, anchor change with consumeInternalNav true
        W->>W: no fade, display refs synced immediately
    else the clicked verse is already current
        Note over I,N: no PAPI write at all, the echo round-trip is skipped
    end

    I->>I: setFocusedTokenRef tokenRef
    I->>S: focusedTokenRef changed
    Note over S: the strip did NOT emit this, so it is EXTERNAL to the strip
    S->>S: setIsVisible false, wait 500 ms, then snap, commit, holdCentered
    Note over W,S: net effect, the list does not fade and the strip does
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
    participant W as useSegmentWindow
    participant S as ContinuousView

    Note over S: an arrow-step glide is still animating, scrollSettlePending is true
    U->>SV: click merge on a boundary
    SV->>L: dispatch.merge secondSegmentStartRef
    L->>L: apply the delta, auto-save, bump segmentationVersion
    L->>I: new book identity plus segmentationVersion incremented
    I->>I: the book reseed keeps the focus, wordTokenByRef still resolves the ref
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

---

## F — Continuous-scroll toggle

The one place where a callback is used instead of a returned value, and the reason is one React commit.

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
    W->>W: the re-snap loop therefore measures the active verse against<br/>the final, strip-included layout
    S->>S: initial-load path, so an instant jump plus holdCentered
    W->>W: settling waves relayed via relayResize, 100 ms quiet, then onSettled
    Note over W,S: routing this through a callback rather than an effect on a returned<br/>value is what keeps the strip mount and the rebuild in one commit
```
