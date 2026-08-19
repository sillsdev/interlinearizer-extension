/**
 * Why a cluster could not be converted into an analysis record.
 *
 * - `verseNotFound`: the cluster's verse key has no matching segment (or its book is missing from the
 *   project text).
 * - `formMismatch`: no token (or token run, for phrases) folds to the cluster's expected surface.
 *   Subsumes word-division and heading/footnote-scope disagreements, which are indistinguishable
 *   from plain mismatches without PT9's own text.
 * - `lemmaOrOther`: the cluster is a Lemma or Other-type cluster, inert legacy data in modern PT9.
 * - `duplicateCluster`: a second cluster of the same kind at the same range; only the first converts.
 * - `unparseableLexemeId`: a lexeme id does not match PT9's `Type:Form[:Homograph]` grammar.
 */
export type Pt9ClusterDropReason =
  'verseNotFound' | 'formMismatch' | 'lemmaOrOther' | 'duplicateCluster' | 'unparseableLexemeId';

/** Conversion outcome counts for one book of one gloss language. */
export interface Pt9BookReport {
  bookId: string;
  /** False when the source project has no text for this book; every verse then drops. */
  bookFound: boolean;
  versesTotal: number;
  /** Verses whose approval hash was present, so their records import as approved. */
  versesHashed: number;
  /** Verses whose key matched no segment in the book's text layer. */
  versesNotFound: number;
  clustersTotal: number;
  /** Word and parse clusters that anchored and produced or enriched a token record. */
  clustersConverted: number;
  /** Phrase clusters that anchored and produced a phrase record. */
  phrasesConverted: number;
  clusterDrops: Record<Pt9ClusterDropReason, number>;
  /** Anchors chosen among several candidate tokens rather than matched uniquely. */
  ambiguousAnchors: number;
  /**
   * Punctuation entries that convert to nothing: they describe how a back translation replaces
   * punctuation, which the analysis model has no place for.
   */
  punctuationEntriesIgnored: number;
}

/** Conversion outcome counts for one gloss language across its books. */
export interface Pt9LanguageReport {
  /** The GlossLanguage value as written in the files. */
  rawLanguage: string;
  /** The resolved BCP 47 tag that glosses in this language are keyed by. */
  tag: string;
  /** True when `rawLanguage` was not a valid tag and passed through verbatim. */
  tagIsFallback: boolean;
  books: Pt9BookReport[];
}

/** Cross-language merge outcomes. */
export interface Pt9MergeReport {
  /** Token records that carry contributions from more than one language. */
  mergedTokenRecords: number;
  /** Records created because parses genuinely conflicted at one token. */
  parseConflicts: number;
  /** Would-be-approved records demoted to candidate by the one-approved-per-token invariant. */
  approvedDemotedToCandidate: number;
  /** Raw language values that resolved onto one tag, grouped per collision. */
  sameTagCollisions: string[][];
}

/** Gloss and lexicon-reference resolution outcomes. */
export interface Pt9SenseReport {
  /** Glosses resolved from an explicitly selected sense. */
  specificResolved: number;
  /** Glosses resolved through PT9's deterministic single-glossed-sense default. */
  defaultSingleResolved: number;
  /** Lexemes that resolved to no gloss text (dangling sense, empty gloss, or no default). */
  unresolvedGlossText: number;
  entryRefsResolved: number;
  entryRefsUnresolved: number;
  senseRefsResolved: number;
  senseRefsUnresolved: number;
}

/** Bare word-analysis payload outcomes. */
export interface Pt9BarePayloadReport {
  added: number;
  /** Analyses skipped because an identical cluster-derived record already exists. */
  skippedExistingIdentical: number;
  /** Analyses dropped because a lexeme id was unparseable. */
  droppedUnparseable: number;
  /** Analyses dropped because they carried no lexemes at all. */
  droppedEmpty: number;
}

/** The import report returned to the caller: the quality signal for the whole conversion. */
export interface Pt9ImportReport {
  languages: Pt9LanguageReport[];
  merge: Pt9MergeReport;
  senses: Pt9SenseReport;
  barePayloads: Pt9BarePayloadReport;
}

/** Every drop reason, for typed iteration over `clusterDrops` records. */
const PT9_CLUSTER_DROP_REASONS: readonly Pt9ClusterDropReason[] = [
  'verseNotFound',
  'formMismatch',
  'lemmaOrOther',
  'duplicateCluster',
  'unparseableLexemeId',
];

/** Adds every count in `source` onto `target` in place. */
export function addClusterDrops(
  target: Record<Pt9ClusterDropReason, number>,
  source: Record<Pt9ClusterDropReason, number>,
): void {
  PT9_CLUSTER_DROP_REASONS.forEach((reason) => {
    target[reason] += source[reason];
  });
}

/** A `clusterDrops` record with every reason at zero. */
export function emptyClusterDrops(): Record<Pt9ClusterDropReason, number> {
  return {
    verseNotFound: 0,
    formMismatch: 0,
    lemmaOrOther: 0,
    duplicateCluster: 0,
    unparseableLexemeId: 0,
  };
}

/** A book report with every count at zero. */
export function emptyBookReport(bookId: string, bookFound: boolean): Pt9BookReport {
  return {
    bookId,
    bookFound,
    versesTotal: 0,
    versesHashed: 0,
    versesNotFound: 0,
    clustersTotal: 0,
    clustersConverted: 0,
    phrasesConverted: 0,
    clusterDrops: emptyClusterDrops(),
    ambiguousAnchors: 0,
    punctuationEntriesIgnored: 0,
  };
}

/** An import report with every count at zero and no languages. */
export function emptyPt9ImportReport(): Pt9ImportReport {
  return {
    languages: [],
    merge: {
      mergedTokenRecords: 0,
      parseConflicts: 0,
      approvedDemotedToCandidate: 0,
      sameTagCollisions: [],
    },
    senses: {
      specificResolved: 0,
      defaultSingleResolved: 0,
      unresolvedGlossText: 0,
      entryRefsResolved: 0,
      entryRefsUnresolved: 0,
      senseRefsResolved: 0,
      senseRefsUnresolved: 0,
    },
    barePayloads: { added: 0, skippedExistingIdentical: 0, droppedUnparseable: 0, droppedEmpty: 0 },
  };
}
