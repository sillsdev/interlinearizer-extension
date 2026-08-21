# Navigation diagrams

Six diagrams of the book / segment / verse / phrase / token navigation surface — one per axis of
complexity. No single diagram covers it: the structure, the coordinate spaces, the entry points, the
per-scenario causality, the concurrent state, and the frame-level timing each want a different
notation.

> [!IMPORTANT]
> **These describe branch `perf/continuous-view-responsiveness` @ `0ab3de6`, which is not merged.**
> They do not describe this branch, and they do not describe `main`. Most of the code they cite does
> exist on `main`, but `src/hooks/usePhraseWindowHalf.ts` does not, and the strip's render-window
> sizing, the `holdCentered` loop, and the deferred mid-glide re-centre are all branch-only
> behaviour. Read them against that branch or they will mislead you.

## The six

| #   | File                                                 | Notation                    | Answers                                                                         |
| --- | ---------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| 1   | [01-structure-bands.svg](01-structure-bands.svg)     | to-scale band diagram       | What are the units, and where do they fail to nest?                             |
| 2   | [02-coordinate-spaces.svg](02-coordinate-spaces.svg) | hub-and-spoke mapping graph | How many addresses does one place have, and which conversions lose information? |
| 3   | [03-entry-point-matrix.md](03-entry-point-matrix.md) | matrix + footnotes          | Every way navigation can start, and what each subsystem does about it.          |
| 4   | [04-scenarios.md](04-scenarios.md)                   | 6 mermaid sequence diagrams | For one action, who talks to whom, in what order?                               |
| 5   | [05-concurrent-clocks.svg](05-concurrent-clocks.svg) | Harel orthogonal statechart | What state is the view in, across five machines running at once?                |
| 6   | [06-timing-waterfall.svg](06-timing-waterfall.svg)   | timing waterfall, 2 traces  | When does each thing happen, relative to frames and to the real constants?      |

## Reading order

Start with **1** — it establishes the vocabulary everything else assumes. Then **3** for coverage,
then **6** for the behaviour the source branch is actually about. **2**, **4** and **5** are
elaboration: reach for 2 when a resolver is misbehaving, 4 when tracing one specific interaction, 5
when two clocks appear to be fighting.

## Viewing

- **The `.svg` files** render in GitHub's file view. They are 1240–1340px wide with labels down to
  8px, so use **Raw** and the browser's own zoom to read the fine print. All four paint an explicit
  white background, so they stay legible in dark mode.
- **The `.md` files** render in place. GitHub draws the mermaid blocks in `04` natively — no image,
  and it scales with your zoom.

## Sources

Every claim comes from these files _on the source branch_. They are listed as paths rather than
links on purpose: this branch does not contain that code, so a relative link would resolve to the
wrong version or to nothing.

| Area                                                           | File                                       |
| -------------------------------------------------------------- | ------------------------------------------ |
| nav surface, fade clock, internal-nav markers, focus requests  | `src/components/InterlinearNavContext.tsx` |
| segment-window range, fade, extend/cull, scroll compensation   | `src/hooks/useSegmentWindow.ts`            |
| post-recenter re-snap, quiet-debounce, settle deadline         | `src/hooks/useRecenterSnap.ts`             |
| strip focus machine, glide, holdCentered, render window        | `src/components/ContinuousView.tsx`        |
| measured strip window half (branch-only)                       | `src/hooks/usePhraseWindowHalf.ts`         |
| focus/navigate handlers, reseed effects, focus-request claim   | `src/components/Interlinearizer.tsx`       |
| book load, `activeScrRef` resolution, curtain, cross-book swap | `src/components/InterlinearizerLoader.tsx` |
| duplicate USJ payload stabilisation                            | `src/hooks/useInterlinearizerBookData.ts`  |
| verse containment, label ranges, ref conversion                | `src/utils/verse-ref.ts`                   |
| the seven book-wide lookup indexes                             | `src/hooks/useBookIndexes.ts`              |
| segment id derivation on re-segmentation                       | `src/parsers/papi/resegmentBook.ts`        |
| shared fade duration and easing                                | `src/components/recenter-fade.ts`          |
| mode-switch recenter, LocateFixed, pinned chapter              | `src/components/SegmentListView.tsx`       |
| in-list click/focus handlers                                   | `src/components/SegmentView.tsx`           |
| group/slot/render-unit shapes                                  | `src/types/token-layout.ts`                |

## Staleness

Every diagram cites specific functions and specific constants — `RECENTER_FADE_MS`,
`INTERNAL_NAV_TTL_MS`, `HOLD_CENTERED_MAX_MS`, `SCROLL_SETTLE_FALLBACK_MS`,
`LINK_SLOT_TRANSITION_MS`. When one of those moves, the diagram citing it is wrong and nothing will
tell you. If you change navigation behaviour and these have not been updated, treat them as
describing history rather than the present.

## Deliberate omissions

- **Phrase editing** (link, unlink, gloss, morphemes) appears only where it moves focus or
  segmentation. The analysis-store write path is a separate concern and needs its own diagram.
- **Arc geometry** (`useArcPaths`, `phrase-arc.ts`) is treated as a layout input that reflows
  asynchronously — which is all navigation needs to know about it.
- **`hideInactiveLinkButtons`** is noted as excluded from re-centring but not otherwise modelled;
  hidden slots keep their layout space, so it is navigation-inert.
- Diagram 3's row 13 (`requestFocusToken`) documents a seam with no production caller. If one is
  added, that row and diagram 2's edge `[16]` both need revisiting.
