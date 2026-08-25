/**
 * Bundled display toggles threaded down the component tree to the leaves that render them. Grouping
 * them in one object lets intermediate components forward the bundle unchanged, so adding a toggle
 * touches only the code that builds it and the leaf that reads it.
 */
export type ViewOptions = Readonly<{
  /** When true, link buttons between phrases are hidden in segments other than the active verse. */
  hideInactiveLinkButtons: boolean;
  /** When true, phrase-level controls are hidden on every phrase except the focused one. */
  simplifyPhrases: boolean;
  /** When true, morpheme rows and per-morpheme glosses are shown beneath each word token. */
  showMorphology: boolean;
  /** When true, a free-translation input is shown beneath each segment's tokens or baseline text. */
  showFreeTranslation: boolean;
  /**
   * When true, each segment shows its verse range in a left gutter column and suppresses the inline
   * verse superscripts; when false, the inline superscripts show and the gutter is hidden. The two
   * are mutually exclusive display styles for the same verse information.
   */
  showVerseGutter: boolean;
  /**
   * When true, a wheel over the continuous strip scrolls it freely and leaves the focus where it
   * is; when false, each wheel notch steps the focus by one phrase.
   */
  freeScrollStrip: boolean;
}>;
