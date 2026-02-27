/**
 * @file Converts Paratext 9 interlinear data structures to the interlinearizer model.
 *
 *   This module converts from {@link InterlinearData} (types) to {@link Interlinearization}
 *   (interlinearizer types). Interlinear XML is the source side (words/wordParses and ranges). The
 *   Lexicon is the target side (gloss-language senses and gloss text). Mapping:
 *   verse/cluster/source-lexeme + GlossId → book/segment/occurrence/analysis, with glossText from
 *   Lexicon lookup.
 */

import type {
  Interlinearization,
  InterlinearAlignment,
  AnalyzedBook,
  Segment,
  Analysis,
  Occurrence,
  AnalysisAssignment,
} from 'interlinearizer';
import {
  OccurrenceType,
  AnalysisType,
  AssignmentStatus,
  Confidence,
} from 'types/interlinearizer-enums';
import type {
  InterlinearData,
  VerseData,
  StringRange,
  ClusterData,
  PunctuationData,
  LexiconData,
} from './types';
import type { LexiconGlossLookup } from './lexiconParser';
import { buildGlossLookupFromLexicon, getWordLevelGlossForForm } from './lexiconParser';

/**
 * Default SHA-256 hex implementation using the Web Crypto API so the converter can run in WebViews.
 *
 * @param input - UTF-8 string to hash.
 * @returns Promise that resolves to the hex-encoded SHA-256 digest.
 */
/* c8 ignore start -- Web Crypto path; exercised in browser/WebView, not in Jest/jsdom */
async function sha256HexWebCrypto(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
/* c8 ignore end */

/**
 * Computes a stable book-level text version from verse hashes.
 *
 * Collects all non-empty verse hashes, sorts them deterministically, concatenates them, and returns
 * the SHA-256 digest in hex. Used so that textVersion reflects changes in any verse. Uses the
 * provided hasher or the default Web Crypto implementation (for WebViews).
 *
 * @param verseDataArray - Verse data in deterministic (e.g. sorted by ref) order.
 * @param hashSha256Hex - Optional hasher; when omitted, uses Web Crypto. In Node contexts pass one
 *   that matches paranext-core's generateHashFromBuffer('sha256', 'hex', Buffer.from(str,
 *   'utf8')).
 * @returns Promise that resolves to the hex SHA-256 digest, or '' if no verse hashes.
 */
async function computeBookTextVersion(
  verseDataArray: VerseData[],
  hashSha256Hex: (input: string) => Promise<string>,
): Promise<string> {
  const nonEmptyHashes = verseDataArray
    .map((vd) => vd.hash)
    .filter((h): h is string => h.length > 0);
  if (nonEmptyHashes.length === 0) return '';
  const sortedHashes = [...nonEmptyHashes].sort();
  const concatenated = sortedHashes.join('');
  return hashSha256Hex(concatenated);
}

/**
 * Generates a deterministic ID for an interlinearization from Paratext 9 data.
 *
 * @param bookId - Book ID from InterlinearData.
 * @returns A unique ID for the interlinearization.
 */
function generateInterlinearizationId(bookId: string): string {
  return `${bookId}-interlinear`.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Generates a deterministic ID for an analyzed book.
 *
 * @param bookId - Book ID.
 * @returns A unique ID for the book.
 */
function generateBookId(bookId: string): string {
  return bookId.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Generates a deterministic ID for a segment (verse).
 *
 * @param verseRef - Verse reference (e.g., "MAT 1:1").
 * @returns A unique ID for the segment.
 */
function generateSegmentId(verseRef: string): string {
  return verseRef.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Generates a deterministic ID for an occurrence from a cluster.
 *
 * @param segmentId - Parent segment ID.
 * @param clusterId - Cluster ID from ClusterData.
 * @param index - Zero-based index within the segment.
 * @returns A unique ID for the occurrence.
 */
function generateOccurrenceIdFromCluster(
  segmentId: string,
  clusterId: string,
  index: number,
): string {
  return `${segmentId}-occ-${index}-${clusterId}`;
}

/**
 * Generates a deterministic ID for an occurrence from punctuation.
 *
 * @param segmentId - Parent segment ID.
 * @param textRange - Text range of the punctuation.
 * @param index - Zero-based index within the segment.
 * @returns A unique ID for the occurrence.
 */
function generateOccurrenceIdFromPunctuation(
  segmentId: string,
  textRange: StringRange,
  index: number,
): string {
  return `${segmentId}-punc-${index}-${textRange.index}-${textRange.length}`;
}

/**
 * Generates a deterministic ID for an analysis from lexeme data.
 *
 * @param lexemeId - Source word/wordParse ID from Interlinear XML (e.g. "Word:In", "Stem:begin").
 * @param senseId - Target sense ID (GlossId); references Lexicon Sense for gloss text.
 * @param glossLanguage - Gloss language code.
 * @returns A unique ID for the analysis.
 */
function generateAnalysisId(lexemeId: string, senseId: string, glossLanguage: string): string {
  const sensePart = senseId ? `-${senseId}` : '';
  return `analysis-${glossLanguage}-${lexemeId}${sensePart}`;
}

/**
 * Generates a deterministic ID for an analysis assignment.
 *
 * @param occurrenceId - Occurrence ID.
 * @param analysisId - Analysis ID.
 * @returns A unique ID for the assignment.
 */
function generateAssignmentId(occurrenceId: string, analysisId: string): string {
  return `assign-${occurrenceId}-${analysisId}`;
}

/** Prefix for target-side analysis IDs so they do not collide with source-side. */
const TARGET_ANALYSIS_ID_PREFIX = 'target-';

/**
 * Converts a text range to an anchor string.
 *
 * @param textRange - Character range in source text.
 * @returns Anchor string in format "index-length".
 */
function textRangeToAnchor(textRange: StringRange): string {
  return `${textRange.index}-${textRange.length}`;
}

/** Paratext 9 cluster kind: Word (single Word lexeme), WordParse (Stem/Suffix/Prefix), or other. */
function clusterKind(cluster: ClusterData): 'word' | 'wordParse' | 'other' {
  if (cluster.lexemes.length === 0) return 'other';
  const types = new Set(
    cluster.lexemes.map((l) =>
      l.lexemeId.indexOf(':') >= 0 ? l.lexemeId.slice(0, l.lexemeId.indexOf(':')) : '',
    ),
  );
  if (cluster.lexemes.length === 1 && (types.has('Word') || (types.size === 1 && types.has(''))))
    return 'word';
  if ([...types].some((t) => t === 'Stem' || t === 'Suffix' || t === 'Prefix')) return 'wordParse';
  return 'other';
}

/** Whether the lexeme ID is a WordParse type (Stem, Suffix, or Prefix). */
function isWordParseLexemeId(lexemeId: string): boolean {
  const prefix = lexemeId.indexOf(':') >= 0 ? lexemeId.slice(0, lexemeId.indexOf(':')) : '';
  return prefix === 'Stem' || prefix === 'Suffix' || prefix === 'Prefix';
}

/** Source morpheme form from a lexeme ID (part after first colon; e.g. "Stem:begin" → "begin"). */
function sourceFormFromLexemeId(lexemeId: string): string {
  const colon = lexemeId.indexOf(':');
  return colon >= 0 ? lexemeId.slice(colon + 1) : lexemeId;
}

/**
 * Display form for source morphs: affixes get hyphens (Suffix → leading "-", Prefix → trailing
 * "-").
 */
function sourceMorphDisplayForm(lexemeId: string): string {
  const form = sourceFormFromLexemeId(lexemeId);
  if (lexemeId.startsWith('Suffix:')) return form.startsWith('-') ? form : `-${form}`;
  if (lexemeId.startsWith('Prefix:')) return form.endsWith('-') ? form : `${form}-`;
  return form;
}

/**
 * Derives a display form for a cluster from its source-word lexeme IDs when surface text is not
 * provided (e.g. Paratext 9 Interlinear XML only has Range + Lexeme Id/GlossId). Lexeme IDs are
 * source-side (e.g. "Word:form", "Stem:form", "Suffix:form"); the part after the first colon is
 * used. Multiple lexemes are concatenated (e.g. Stem:hello + Suffix:ing → "helloing").
 *
 * @param cluster - Cluster with at least one lexeme (source text words/wordParses).
 * @returns Non-empty string suitable for occurrence surfaceText when verse text is unavailable.
 */
function surfaceTextFromLexemes(cluster: ClusterData): string {
  /* c8 ignore start -- defensive; no cluster with empty lexemes reaches this from conversion */
  if (cluster.lexemes.length === 0) return '';
  /* c8 ignore end */
  return cluster.lexemes
    .map((l) => {
      const colon = l.lexemeId.indexOf(':');
      return colon >= 0 ? l.lexemeId.slice(colon + 1) : l.lexemeId;
    })
    .join('');
}

/**
 * Groups clusters by text range so that Word and WordParse clusters for the same span are combined
 * into one occurrence (surface from Word, analyses from WordParse when present). See
 * data-model.md.
 */
function clustersByRange(
  verseData: VerseData,
): Map<string, { word?: ClusterData; wordParse?: ClusterData }> {
  const byRange = new Map<string, { word?: ClusterData; wordParse?: ClusterData }>();
  verseData.clusters.forEach((cluster) => {
    const key = `${cluster.textRange.index}-${cluster.textRange.length}`;
    let entry = byRange.get(key);
    if (!entry) {
      entry = {};
      byRange.set(key, entry);
    }
    const kind = clusterKind(cluster);
    if (kind === 'word' && !entry.word) entry.word = cluster;
    else if (kind === 'wordParse' && !entry.wordParse) entry.wordParse = cluster;
    // If multiple Word or WordParse for same range, first wins (matches Paratext "best parse" idea).
  });
  return byRange;
}

/**
 * Converts a Paratext 9 verse to an interlinearizer segment.
 *
 * Word and WordParse clusters that share the same text range are merged into a single occurrence:
 * surface form from the Word cluster when present, analyses from the WordParse cluster when present
 * (so stem+affix is shown without duplicating the word). See data-model.md.
 *
 * @param verseRef - Verse reference (e.g., "MAT 1:1").
 * @param verseData - Verse data from Paratext 9.
 * @param glossLanguage - Gloss language code (used for analysis IDs).
 * @returns A Segment with occurrences in text order (one per word span, one per punctuation).
 */
/** Item in the merged list of word spans and punctuations for reading-order sort. */
type WordSpanOrPunctuation =
  | {
      kind: 'word';
      textRange: StringRange;
      wordCluster?: ClusterData;
      wordParseCluster?: ClusterData;
    }
  | { kind: 'punctuation'; textRange: StringRange; punctuation: PunctuationData };

/**
 * Builds a source-language segment: Word:-prefixed lexemes map to occurrence.surfaceText only;
 * Stem/Suffix/Prefix map to morph analyses linked via assignments.
 */
function convertVerseToSourceSegment(
  verseRef: string,
  verseData: VerseData,
  glossLanguage: string,
): Segment {
  const segmentId = generateSegmentId(verseRef);
  const byRange = clustersByRange(verseData);

  const wordSpans: WordSpanOrPunctuation[] = Array.from(byRange.entries())
    .filter(([, entry]) => entry.word !== undefined || entry.wordParse !== undefined)
    .map(([rangeKey, entry]) => {
      const [indexStr, lengthStr] = rangeKey.split('-');
      const textRange: StringRange = {
        index: parseInt(indexStr, 10),
        length: parseInt(lengthStr, 10),
      };
      return {
        kind: 'word' as const,
        textRange,
        wordCluster: entry.word,
        wordParseCluster: entry.wordParse,
      };
    });

  const items: WordSpanOrPunctuation[] = [
    ...wordSpans,
    ...verseData.punctuations.map(
      (p): WordSpanOrPunctuation => ({
        kind: 'punctuation',
        textRange: p.textRange,
        punctuation: p,
      }),
    ),
  ].sort((a, b) => {
    const byIndex = a.textRange.index - b.textRange.index;
    if (byIndex !== 0) return byIndex;
    const byLength = a.textRange.length - b.textRange.length;
    if (byLength !== 0) return byLength;
    // Word before punctuation when same range (display order: word then following punctuation).
    if (a.kind !== b.kind) return a.kind === 'word' ? -1 : 1;
    return 0;
  });

  const occurrences: Occurrence[] = items.map((item, occurrenceIndex): Occurrence => {
    if (item.kind === 'word') {
      const clusterForAssignments = item.wordParseCluster ?? item.wordCluster;
      const clusterForSurface = item.wordCluster ?? item.wordParseCluster;
      const singleCluster = clusterForAssignments === clusterForSurface;
      if (singleCluster) {
        // Single cluster for this span (Word only or WordParse only). Use it for both assignments and surface.
        const single = clusterForAssignments ?? clusterForSurface;
        if (!single) throw new Error('word span with no cluster');
        const occurrenceId = generateOccurrenceIdFromCluster(segmentId, single.id, occurrenceIndex);
        const surfaceText = surfaceTextFromLexemes(single);
        const assignments = single.lexemes
          .filter((lexeme) => isWordParseLexemeId(lexeme.lexemeId))
          .map((lexeme): AnalysisAssignment => {
            const analysisId = generateAnalysisId(lexeme.lexemeId, lexeme.senseId, glossLanguage);
            return {
              id: generateAssignmentId(occurrenceId, analysisId),
              occurrenceId,
              analysisId,
              status: verseData.hash ? AssignmentStatus.Approved : AssignmentStatus.Suggested,
            };
          });
        return {
          id: occurrenceId,
          segmentId,
          index: occurrenceIndex,
          anchor: textRangeToAnchor(single.textRange),
          surfaceText,
          writingSystem: '',
          type: OccurrenceType.Word,
          assignments,
        };
      }
      if (!clusterForAssignments || !clusterForSurface)
        throw new Error('word span with no cluster');
      const occurrenceId = generateOccurrenceIdFromCluster(
        segmentId,
        clusterForAssignments.id,
        occurrenceIndex,
      );
      const surfaceText = surfaceTextFromLexemes(clusterForSurface);
      const assignments = clusterForAssignments.lexemes
        .filter((lexeme) => isWordParseLexemeId(lexeme.lexemeId))
        .map((lexeme): AnalysisAssignment => {
          const analysisId = generateAnalysisId(lexeme.lexemeId, lexeme.senseId, glossLanguage);
          return {
            id: generateAssignmentId(occurrenceId, analysisId),
            occurrenceId,
            analysisId,
            status: verseData.hash ? AssignmentStatus.Approved : AssignmentStatus.Suggested,
          };
        });
      return {
        id: occurrenceId,
        segmentId,
        index: occurrenceIndex,
        anchor: textRangeToAnchor(item.textRange),
        surfaceText,
        writingSystem: '',
        type: OccurrenceType.Word,
        assignments,
      };
    }
    const { punctuation } = item;
    return {
      id: generateOccurrenceIdFromPunctuation(segmentId, punctuation.textRange, occurrenceIndex),
      segmentId,
      index: occurrenceIndex,
      anchor: textRangeToAnchor(punctuation.textRange),
      surfaceText: punctuation.afterText || punctuation.beforeText || '',
      writingSystem: '',
      type: OccurrenceType.Punctuation,
      assignments: [],
    };
  });

  return {
    id: segmentId,
    segmentRef: verseRef,
    baselineText: '', // Paratext 9 doesn't specify baseline text
    occurrences,
  };
}

/** Target segment ID suffix so target and source segments can be matched. */
const TARGET_SEGMENT_ID_SUFFIX = '-target';

/**
 * Builds a target-language segment aligned to the source: same order and count of occurrences.
 * Word-level gloss from Lexicon Word entries → occurrence.surfaceText; Stem/Suffix/Prefix from
 * Lexicon → morph analyses linked via assignments (target analysis IDs).
 *
 * @param verseRef - Verse reference (e.g. "JHN 1:1").
 * @param verseData - Verse data from Paratext 9.
 * @param sourceSegmentId - Source segment ID (used to derive target segment and occurrence IDs).
 * @param glossLanguage - Gloss language code.
 * @param lexicon - Parsed Lexicon for word-level and sense gloss lookup.
 * @returns Target Segment with same segmentRef and occurrence count as source.
 */
function convertVerseToTargetSegment(
  verseRef: string,
  verseData: VerseData,
  sourceSegmentId: string,
  glossLanguage: string,
  lexicon: LexiconData,
): Segment {
  const targetSegmentId = sourceSegmentId + TARGET_SEGMENT_ID_SUFFIX;
  const byRange = clustersByRange(verseData);
  const glossLookup = buildGlossLookupFromLexicon(lexicon);

  const wordSpans: WordSpanOrPunctuation[] = Array.from(byRange.entries())
    .filter(([, entry]) => entry.word !== undefined || entry.wordParse !== undefined)
    .map(([rangeKey, entry]) => {
      const [indexStr, lengthStr] = rangeKey.split('-');
      const textRange: StringRange = {
        index: parseInt(indexStr, 10),
        length: parseInt(lengthStr, 10),
      };
      return {
        kind: 'word' as const,
        textRange,
        wordCluster: entry.word,
        wordParseCluster: entry.wordParse,
      };
    });

  const items: WordSpanOrPunctuation[] = [
    ...wordSpans,
    ...verseData.punctuations.map(
      (p): WordSpanOrPunctuation => ({
        kind: 'punctuation',
        textRange: p.textRange,
        punctuation: p,
      }),
    ),
  ].sort((a, b) => {
    const byIndex = a.textRange.index - b.textRange.index;
    if (byIndex !== 0) return byIndex;
    const byLength = a.textRange.length - b.textRange.length;
    if (byLength !== 0) return byLength;
    if (a.kind !== b.kind) return a.kind === 'word' ? -1 : 1;
    return 0;
  });

  const occurrences: Occurrence[] = items.map((item, occurrenceIndex): Occurrence => {
    if (item.kind === 'word') {
      const clusterForAssignments = item.wordParseCluster ?? item.wordCluster;
      const clusterForSurface = item.wordCluster ?? item.wordParseCluster;
      const singleCluster = clusterForAssignments === clusterForSurface;
      const cluster = singleCluster
        ? (clusterForAssignments ?? clusterForSurface)
        : clusterForAssignments;
      const surfaceCluster = singleCluster ? cluster : clusterForSurface;
      if (!cluster || !surfaceCluster) throw new Error('word span with no cluster');

      const surfaceForm = surfaceTextFromLexemes(surfaceCluster);
      // Prefer gloss from Interlinear GlossId (senseId) so the assigned sense is shown; fallback to
      // Lexicon form-based lookup (e.g. for WordParse-only spans or when sense is missing).
      const senseGloss = surfaceCluster.lexemes
        .map((l) => glossLookup(l.senseId, glossLanguage))
        .find((g) => g !== undefined);
      const wordLevelGloss = getWordLevelGlossForForm(lexicon, surfaceForm, glossLanguage);
      const targetSurfaceText = (senseGloss !== undefined ? senseGloss : wordLevelGloss) ?? '';

      const targetOccurrenceId = `${targetSegmentId}-occ-${occurrenceIndex}-${cluster.id}`;
      const assignments = cluster.lexemes
        .filter((lexeme) => isWordParseLexemeId(lexeme.lexemeId))
        .map((lexeme): AnalysisAssignment => {
          const analysisId =
            TARGET_ANALYSIS_ID_PREFIX +
            generateAnalysisId(lexeme.lexemeId, lexeme.senseId, glossLanguage);
          return {
            id: generateAssignmentId(targetOccurrenceId, analysisId),
            occurrenceId: targetOccurrenceId,
            analysisId,
            status: verseData.hash ? AssignmentStatus.Approved : AssignmentStatus.Suggested,
          };
        });

      return {
        id: targetOccurrenceId,
        segmentId: targetSegmentId,
        index: occurrenceIndex,
        anchor: textRangeToAnchor(cluster.textRange),
        surfaceText: targetSurfaceText,
        writingSystem: '',
        type: OccurrenceType.Word,
        assignments,
      };
    }
    const { punctuation } = item;
    const targetPuncId = `${targetSegmentId}-punc-${occurrenceIndex}-${punctuation.textRange.index}-${punctuation.textRange.length}`;
    return {
      id: targetPuncId,
      segmentId: targetSegmentId,
      index: occurrenceIndex,
      anchor: textRangeToAnchor(punctuation.textRange),
      surfaceText: punctuation.afterText || punctuation.beforeText || '',
      writingSystem: '',
      type: OccurrenceType.Punctuation,
      assignments: [],
    };
  });

  return {
    id: targetSegmentId,
    segmentRef: verseRef,
    baselineText: '',
    occurrences,
  };
}

/** Options for {@link createSourceAnalyses} (no options) and {@link createTargetAnalyses}. */
export type CreateTargetAnalysesOptions = {
  /** Lookup (senseId, language) → gloss text from Lexicon. */
  glossLookup?: LexiconGlossLookup;
};

/**
 * Options for legacy {@link createAnalyses}. Prefer {@link createSourceAnalyses} and
 * {@link createTargetAnalyses} with separate source/target interlinearizations.
 */
export type CreateAnalysesOptions = {
  /** Lookup (senseId, language) → gloss text. Used for combined single interlinearization. */
  glossLookup?: LexiconGlossLookup;
};

/**
 * Creates source-side Analysis objects: only WordParse lexemes (Stem/Suffix/Prefix) as Morph
 * analyses with form in morphemeBundles. Word:-prefixed lexemes are not analyses; they map to
 * occurrence.surfaceText only.
 *
 * @param interlinearData - Paratext 9 interlinear data.
 * @returns Map of source analysis ID to Analysis (Morph type).
 */
export function createSourceAnalyses(interlinearData: InterlinearData): Map<string, Analysis> {
  const analyses = new Map<string, Analysis>();
  const { glossLanguage } = interlinearData;

  Object.values(interlinearData.verses).forEach((verseData) => {
    verseData.clusters.forEach((cluster) => {
      cluster.lexemes
        .filter((lexeme) => isWordParseLexemeId(lexeme.lexemeId))
        .forEach((lexeme) => {
          const analysisId = generateAnalysisId(lexeme.lexemeId, lexeme.senseId, glossLanguage);
          if (analyses.has(analysisId)) return;

          const displayForm = sourceMorphDisplayForm(lexeme.lexemeId);
          analyses.set(analysisId, {
            id: analysisId,
            analysisLanguage: glossLanguage,
            analysisType: AnalysisType.Morph,
            confidence: Confidence.Medium,
            sourceSystem: 'paratext-9',
            sourceUser: 'paratext-9-parser',
            morphemeBundles: [
              {
                id: `${analysisId}-bundle-0`,
                index: 0,
                form: displayForm,
                writingSystem: '',
              },
            ],
          });
        });
    });
  });

  return analyses;
}

/**
 * Creates target-side Analysis objects: only WordParse lexemes as Morph analyses with glossText
 * from the Lexicon. IDs are prefixed so they do not collide with source analyses.
 *
 * @param interlinearData - Paratext 9 interlinear data.
 * @param options - GlossLookup for senseId → gloss text.
 * @returns Map of target analysis ID to Analysis (Morph type with glossText).
 */
export function createTargetAnalyses(
  interlinearData: InterlinearData,
  options?: CreateTargetAnalysesOptions,
): Map<string, Analysis> {
  const analyses = new Map<string, Analysis>();
  const { glossLanguage } = interlinearData;
  const glossLookup = options?.glossLookup;

  Object.values(interlinearData.verses).forEach((verseData) => {
    verseData.clusters.forEach((cluster) => {
      cluster.lexemes
        .filter((lexeme) => isWordParseLexemeId(lexeme.lexemeId))
        .forEach((lexeme) => {
          const analysisId =
            TARGET_ANALYSIS_ID_PREFIX +
            generateAnalysisId(lexeme.lexemeId, lexeme.senseId, glossLanguage);
          if (analyses.has(analysisId)) return;

          let glossText: string | undefined;
          if (glossLookup && lexeme.senseId) {
            const fromLexicon = glossLookup(lexeme.senseId, glossLanguage);
            glossText = fromLexicon !== undefined ? fromLexicon : lexeme.senseId;
          } else {
            glossText = lexeme.senseId || undefined;
          }

          const displayForm = sourceMorphDisplayForm(lexeme.lexemeId);
          analyses.set(analysisId, {
            id: analysisId,
            analysisLanguage: glossLanguage,
            analysisType: AnalysisType.Morph,
            confidence: Confidence.Medium,
            sourceSystem: 'paratext-9',
            sourceUser: 'paratext-9-parser',
            glossText,
            morphemeBundles: [
              {
                id: `${analysisId}-bundle-0`,
                index: 0,
                form: displayForm,
                writingSystem: '',
              },
            ],
          });
        });
    });
  });

  return analyses;
}

/**
 * Legacy: creates a single combined analysis map (source morph analyses only). Prefer
 * createSourceAnalyses + createTargetAnalyses with InterlinearAlignment.
 *
 * @param interlinearData - Paratext 9 interlinear data.
 * @param options - Optional. glossLookup (ignored for source-only; kept for API compat).
 * @returns Map of analysis ID to Analysis (source morph only).
 */
export function createAnalyses(interlinearData: InterlinearData): Map<string, Analysis> {
  return createSourceAnalyses(interlinearData);
}

/** Options for Paratext 9 conversion (source-only or full alignment). */
export type ConvertParatext9Options = {
  /** SHA-256 hex hasher for composite book text version. Default: Web Crypto (WebView-safe). */
  hashSha256Hex?: (input: string) => Promise<string>;
};

/**
 * Converts Paratext 9 InterlinearData to the **source** interlinearization only. Word:-prefixed
 * lexemes map to occurrence.surfaceText; Stem/Suffix/Prefix map to morph analyses via assignments.
 * Use {@link convertParatext9ToInterlinearAlignment} when you have a Lexicon and want source +
 * target in one structure.
 *
 * @param interlinearData - Paratext 9 interlinear data to convert.
 * @param options - Optional. hashSha256Hex for book-level text version.
 * @returns Promise that resolves to the source Interlinearization.
 */
export async function convertParatext9ToInterlinearization(
  interlinearData: InterlinearData,
  options?: ConvertParatext9Options,
): Promise<Interlinearization> {
  const { glossLanguage, bookId, verses } = interlinearData;
  const hashSha256Hex = options?.hashSha256Hex ?? sha256HexWebCrypto;

  const interlinearizationId = generateInterlinearizationId(bookId);
  const analyzedBookId = generateBookId(bookId);
  const sortedVerseRefs = Object.keys(verses).sort();
  const verseDataArray = sortedVerseRefs.map((ref) => verses[ref]);
  const segments = sortedVerseRefs.map((ref) =>
    convertVerseToSourceSegment(ref, verses[ref], glossLanguage),
  );

  const textVersion = await computeBookTextVersion(verseDataArray, hashSha256Hex);

  const analyzedBook: AnalyzedBook = {
    id: analyzedBookId,
    bookRef: bookId,
    textVersion,
    segments,
  };

  return {
    id: interlinearizationId,
    sourceWritingSystem: '',
    analysisLanguages: [glossLanguage],
    books: [analyzedBook],
  };
}

/**
 * Builds the target interlinearization from the source and Lexicon: same segment/occurrence layout;
 * occurrence.surfaceText = word-level gloss from Lexicon Word entries; assignments = morph analyses
 * (Stem/Suffix/Prefix) with glossText from Lexicon.
 */
function buildTargetInterlinearization(
  source: Interlinearization,
  interlinearData: InterlinearData,
  lexicon: LexiconData,
): Interlinearization {
  const { glossLanguage, verses } = interlinearData;
  const targetId = source.id + TARGET_SEGMENT_ID_SUFFIX;

  const books: AnalyzedBook[] = source.books.map((book) => {
    const targetBookId = book.id + TARGET_SEGMENT_ID_SUFFIX;
    const segments: Segment[] = book.segments.map((segment) => {
      const verseRef = segment.segmentRef;
      const verseData = verses[verseRef];
      if (!verseData) {
        return {
          id: segment.id + TARGET_SEGMENT_ID_SUFFIX,
          segmentRef: verseRef,
          baselineText: '',
          occurrences: segment.occurrences.map((occ) => ({
            ...occ,
            id: occ.id + TARGET_SEGMENT_ID_SUFFIX,
            segmentId: segment.id + TARGET_SEGMENT_ID_SUFFIX,
            surfaceText: '',
            assignments: [],
          })),
        };
      }
      return convertVerseToTargetSegment(verseRef, verseData, segment.id, glossLanguage, lexicon);
    });
    return {
      id: targetBookId,
      bookRef: book.bookRef,
      textVersion: book.textVersion,
      segments,
    };
  });

  return {
    id: targetId,
    sourceWritingSystem: '',
    analysisLanguages: [glossLanguage],
    books,
  };
}

/**
 * Converts Paratext 9 InterlinearData + optional Lexicon to an InterlinearAlignment with separate
 * source and target interlinearizations. Source: from Interlinear XML (Word → surfaceText,
 * Stem/Suffix/Prefix → analyses). Target: from Lexicon (Word → surfaceText, other types →
 * analyses), aligned by segment and occurrence index.
 *
 * @param interlinearData - Paratext 9 interlinear data.
 * @param lexicon - Optional. When provided, target occurrence.surfaceText and target analyses get
 *   gloss text from the Lexicon.
 * @param options - Optional. hashSha256Hex for book-level text version.
 * @returns Promise that resolves to InterlinearAlignment (source, target, links).
 */
export async function convertParatext9ToInterlinearAlignment(
  interlinearData: InterlinearData,
  lexicon: LexiconData | undefined,
  options?: ConvertParatext9Options,
): Promise<InterlinearAlignment> {
  const source = await convertParatext9ToInterlinearization(interlinearData, options);
  const target = lexicon
    ? buildTargetInterlinearization(source, interlinearData, lexicon)
    : buildTargetInterlinearizationEmpty(source);

  return {
    id: `${source.id}-alignment`,
    source,
    target,
    links: [],
  };
}

/**
 * Builds a target interlinearization with same structure as source but empty surfaceText and no
 * assignments (when no Lexicon is provided).
 */
function buildTargetInterlinearizationEmpty(source: Interlinearization): Interlinearization {
  const targetId = source.id + TARGET_SEGMENT_ID_SUFFIX;

  const books: AnalyzedBook[] = source.books.map((book) => ({
    id: book.id + TARGET_SEGMENT_ID_SUFFIX,
    bookRef: book.bookRef,
    textVersion: book.textVersion,
    segments: book.segments.map((segment) => ({
      id: segment.id + TARGET_SEGMENT_ID_SUFFIX,
      segmentRef: segment.segmentRef,
      baselineText: '',
      occurrences: segment.occurrences.map((occ) => ({
        ...occ,
        id: occ.id + TARGET_SEGMENT_ID_SUFFIX,
        segmentId: segment.id + TARGET_SEGMENT_ID_SUFFIX,
        surfaceText: '',
        assignments: [],
      })),
    })),
  }));

  return {
    id: targetId,
    sourceWritingSystem: '',
    analysisLanguages: source.analysisLanguages,
    books,
  };
}
