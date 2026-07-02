/**
 * Bundled display toggles threaded from {@link InterlinearizerLoader} down through the segment and
 * continuous views to the phrase strips. Grouping them in one object lets intermediate components
 * forward `viewOptions` unchanged, so adding a new toggle only touches the loader that builds it
 * and the leaf that reads it — not every component in between.
 */
export type ViewOptions = Readonly<{
  /** When true, link buttons between phrases are hidden in segments other than the active verse. */
  hideInactiveLinkButtons: boolean;
  /** When true, phrase-level controls are hidden on every phrase except the focused one. */
  simplifyPhrases: boolean;
  /**
   * When true, every verse is labeled `chapter:verse` and no inline chapter header is shown; when
   * false, an inline chapter header precedes the first verse of each chapter and verse labels stay
   * bare verse numbers.
   */
  chapterLabelInVerse: boolean;
  /** When true, morpheme rows and per-morpheme glosses are shown beneath each word token. */
  showMorphology: boolean;
  /** When true, a free-translation input is shown beneath each segment's tokens or baseline text. */
  showFreeTranslation: boolean;
}>;
