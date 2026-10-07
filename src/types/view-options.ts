/**
 * Bundled display toggles threaded down the component tree to the leaves that render them. Grouping
 * them in one object lets intermediate components forward the bundle unchanged, so adding a toggle
 * touches only the code that builds it and the leaf that reads it.
 */
export type ViewOptions = Readonly<{
  /** When true, morpheme rows and per-morpheme glosses are shown beneath each word token. */
  showMorphology: boolean;
  /** When true, a free-translation input is shown beneath each segment's tokens or baseline text. */
  showFreeTranslation: boolean;
}>;
