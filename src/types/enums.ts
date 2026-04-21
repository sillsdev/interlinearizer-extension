/** Whether a token holds a word or punctuation. */
export enum TokenType {
  Word = 'word',
  Punctuation = 'punctuation',
}

/**
 * How an analysis was produced.
 *
 * - `high` — human-created or human-confirmed
 * - `medium` — tool-assisted, reasonably confident
 * - `low` — tool-assisted, low certainty
 * - `guess` — unreviewed machine suggestion
 */
export enum Confidence {
  Guess = 'guess',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

/**
 * Lifecycle status of a token analysis, phrase, or alignment link.
 *
 * - `approved` — human-confirmed
 * - `suggested` — machine-generated or unreviewed
 * - `candidate` — proposed but not yet reviewed
 * - `rejected` — explicitly rejected by a human
 * - `stale` — the underlying token text has changed since this record was created; the record needs
 *   human review. Set by drift-detection logic comparing `tokenSnapshot` against the current
 *   `Token.surfaceText`.
 */
export enum AssignmentStatus {
  Approved = 'approved',
  Suggested = 'suggested',
  Candidate = 'candidate',
  Rejected = 'rejected',
  Stale = 'stale',
}
