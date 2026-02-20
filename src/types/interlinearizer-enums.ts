/**
 * @file Runtime enum values for the interlinearizer model.
 *
 *   Type declarations (and these enums as types) live in interlinearizer.d.ts for the declared module
 *   'interlinearizer'. This file provides the actual enum values so code that imports from this
 *   path (e.g. parsers/converter) has runtime access. Keeps a single source of truth for enum
 *   values and avoids duplicating them in test mocks.
 */

/** Whether an occurrence position holds a word or punctuation. */
export enum OccurrenceType {
  /** A word occurrence. */
  Word = 'word',
  /** A punctuation occurrence. */
  Punctuation = 'punctuation',
}

/** The kind of linguistic analysis represented. */
export enum AnalysisType {
  /** Surface wordform only — no gloss or morpheme breakdown. */
  Wordform = 'wordform',
  /** Morpheme-level analysis with MorphemeBundles. */
  Morph = 'morph',
  /** Word-level gloss (no morpheme decomposition). */
  Gloss = 'gloss',
  /** Punctuation placeholder. */
  Punctuation = 'punctuation',
}

/**
 * How the analysis was produced.
 *
 * - `guess`
 * - `low`
 * - `medium`
 * - `high`
 */
export enum Confidence {
  Guess = 'guess',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

/**
 * Lifecycle status of an assignment or alignment link.
 *
 * - `approved` — human-confirmed.
 * - `suggested` — machine-generated or unreviewed.
 * - `candidate` — proposed but not yet reviewed.
 * - `rejected` — explicitly rejected by a human.
 */
export enum AssignmentStatus {
  Approved = 'approved',
  Suggested = 'suggested',
  Candidate = 'candidate',
  Rejected = 'rejected',
}
