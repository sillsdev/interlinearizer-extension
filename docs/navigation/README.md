# Navigation diagrams

Six diagrams of the book / segment / verse / phrase / token navigation surface — one per axis of
complexity. No single diagram covers it: the structure, the coordinate spaces, the entry points, the
per-scenario causality, the concurrent state, and the frame-level timing each want a different
notation.

> [!IMPORTANT]
> **These describe `main`, and this branch is not `main`.** Both branches they were originally drawn
> against have since merged — the continuous-view perf work as `59bdca3`, the focus store as
> `7827c72` — but this docs branch forked before either, so none of the code they cite exists in the
> tree around them. Read them against `main`.
>
> Diagrams **5** and **6** predate the focus store and each carry one stale patch; see the table.

## The six

| #   | File                                                 | Notation                    | Answers                                                                         | Current at `7827c72`?             |
| --- | ---------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- | --------------------------------- |
| 1   | [01-structure-bands.svg](01-structure-bands.svg)     | to-scale band diagram       | What are the units, and where do they fail to nest?                             | yes                               |
| 2   | [02-coordinate-spaces.svg](02-coordinate-spaces.svg) | hub-and-spoke mapping graph | How many addresses does one place have, and which conversions lose information? | yes [^1]                          |
| 3   | [03-entry-point-matrix.md](03-entry-point-matrix.md) | matrix + footnotes          | Every way navigation can start, and what each subsystem does about it.          | yes — regenerated against it      |
| 4   | [04-scenarios.md](04-scenarios.md)                   | 6 mermaid sequence diagrams | For one action, who talks to whom, in what order?                               | yes — regenerated against it      |
| 5   | [05-concurrent-clocks.svg](05-concurrent-clocks.svg) | Harel orthogonal statechart | What state is the view in, across five machines running at once?                | **region 3 is stale** [^2]        |
| 6   | [06-timing-waterfall.svg](06-timing-waterfall.svg)   | timing waterfall, 2 traces  | When does each thing happen, relative to frames and to the real constants?      | **trace A, note 2 is stale** [^3] |

## Reading order

Start with **1** — it establishes the vocabulary everything else assumes. Then **3** for coverage,
then **6** for what actually happens frame by frame. **2**, **4** and **5** are elaboration: reach
for 2 when a resolver is misbehaving, 4 when tracing one specific interaction, 5 when two clocks
appear to be fighting.

## Viewing

- **The `.svg` files** render in GitHub's file view. They are 1240–1340px wide with labels down to
  8px, so use **Raw** and the browser's own zoom to read the fine print. All four paint an explicit
  white background, so they stay legible in dark mode.
- **The `.md` files** render in place. GitHub draws the mermaid blocks in `04` natively — no image,
  and it scales with your zoom.

## Sources

Every claim comes from these files _on `main`_. They are listed as paths rather than links on
purpose: this branch forked before the code landed, so a relative link would resolve to nothing.

| Area                                                            | File                                       |
| --------------------------------------------------------------- | ------------------------------------------ |
| nav surface, fade clock, internal-nav markers, focus requests   | `src/components/InterlinearNavContext.tsx` |
| focus store, origin classification, reseed rules, request claim | `src/components/FocusStore.tsx`            |
| segment-window range, fade, extend/cull, scroll compensation    | `src/hooks/useSegmentWindow.ts`            |
| post-recenter re-snap, quiet-debounce, settle deadline          | `src/hooks/useRecenterSnap.ts`             |
| strip focus machine, glide, holdCentered, render window         | `src/components/ContinuousView.tsx`        |
| measured strip window half                                      | `src/hooks/usePhraseWindowHalf.ts`         |
| mode-toggle fade, the `FocusProvider` mount point               | `src/components/Interlinearizer.tsx`       |
| book load, `activeScrRef` resolution, curtain, cross-book swap  | `src/components/InterlinearizerLoader.tsx` |
| duplicate USJ payload stabilisation                             | `src/hooks/useInterlinearizerBookData.ts`  |
| verse containment, label ranges, ref conversion                 | `src/utils/verse-ref.ts`                   |
| the seven book-wide lookup indexes                              | `src/hooks/useBookIndexes.ts`              |
| segment id derivation on re-segmentation                        | `src/parsers/papi/resegmentBook.ts`        |
| shared fade duration and easing                                 | `src/components/recenter-fade.ts`          |
| mode-switch recenter, LocateFixed, pinned chapter               | `src/components/SegmentListView.tsx`       |
| in-list click/focus handlers                                    | `src/components/SegmentView.tsx`           |
| group/slot/render-unit shapes                                   | `src/types/token-layout.ts`                |

## Staleness

Every diagram cites specific functions and specific constants — `RECENTER_FADE_MS`,
`INTERNAL_NAV_TTL_MS`, `HOLD_CENTERED_MAX_MS`, `SCROLL_SETTLE_FALLBACK_MS`,
`LINK_SLOT_TRANSITION_MS`. When one of those moves, the diagram citing it is wrong and nothing will
tell you. If you change navigation behaviour and these have not been updated, treat them as
describing history rather than the present.

The two stale patches noted above are the standing example: the focus store renamed the mechanism
`05` and `06` describe without touching a single constant, so nothing in either diagram looks wrong
until you go looking for `emitInternalFocus` and find it gone.

## Deliberate omissions

- **Phrase editing** (link, unlink, gloss, morphemes) appears only where it moves focus or
  segmentation. The analysis-store write path is a separate concern and needs its own diagram.
- **Arc geometry** (`useArcPaths`, `phrase-arc.ts`) is treated as a layout input that reflows
  asynchronously — which is all navigation needs to know about it.
- **`hideInactiveLinkButtons`** is noted as excluded from re-centring but not otherwise modelled;
  hidden slots keep their layout space, so it is navigation-inert.
- Diagram 3's row 13 (`requestFocusToken`) documents a seam with no production caller. If one is
  added, that row and diagram 2's edge `[16]` both need revisiting.

[^1]:
    `firstWordTokenRefOf` moved to `src/components/FocusStore.tsx`, keeping its name and behaviour,
    so edge `[4]` still reads correctly. Edge `[3]`'s claim about `focusToken` testing containment
    before navigating holds verbatim.

[^2]:
    Region 3 (strip focus machine) labels its transitions "focus prop changed and does not match the
    emit" / "focus prop echoes the strip's own emit". Focus is no longer a prop and there is no emit
    to match — the strip reads `FocusOrigin` instead. The region is also missing a transition: a
    focus move landing mid-fade supersedes it and returns the machine to _settled_. Regions 1, 2, 4
    and 5 are accurate, and every constant the diagram cites still holds.

[^3]:
    Trace A note 2 names `pendingPhraseIndexRef` and `emitInternalFocus`, both deleted. A step now
    reads the focus from the store and writes back with origin `strip`. The replacement is
    synchronous in the same way, so the waterfall's geometry and every constant it plots are
    unaffected; only that one note is wrong. Trace B is untouched.
