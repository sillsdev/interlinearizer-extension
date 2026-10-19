/** How far reading a source project's whole text has got. */
export type TextReadStatus = Readonly<{
  /**
   * `listing` until the text's books are known, `unlisted` when they could not be, `reading` until
   * every book has been read once, then `read`.
   */
  state: 'listing' | 'unlisted' | 'reading' | 'read';
  /** How many of the text's books have been read at least once, those that failed included. */
  booksRead: number;
  /** How many books the text holds; `0` until they are known. */
  bookCount: number;
  /** The books whose latest read failed, in canonical order. */
  failedBookIds: readonly string[];
}>;
