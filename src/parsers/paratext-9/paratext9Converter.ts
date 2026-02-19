/**
 * @file Converts Paratext 9 interlinear data structures to the interlinearizer model.
 *
 *   This module converts from {@link InterlinearData} (paratext-9-types) to {@link Interlinearization}
 *   (interlinearizer types), mapping Paratext 9's verse/cluster/lexeme structure to the
 *   interlinearizer's book/segment/occurrence/analysis structure.
 */

import type { InterlinearData, VerseData, StringRange } from 'paratext-9-types';
import type {
  Interlinearization,
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
 * @param bookId - Book ID.
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
 * @param lexemeId - Lexeme ID.
 * @param senseId - Sense/gloss ID.
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

/**
 * Converts a text range to an anchor string.
 *
 * @param textRange - Character range in source text.
 * @returns Anchor string in format "index-length".
 */
function textRangeToAnchor(textRange: StringRange): string {
  return `${textRange.index}-${textRange.length}`;
}

/**
 * Converts a Paratext 9 verse to an interlinearizer segment.
 *
 * @param verseRef - Verse reference (e.g., "MAT 1:1").
 * @param verseData - Verse data from Paratext 9.
 * @param bookId - Book ID for generating segment ID.
 * @param glossLanguage - Gloss language code.
 * @returns A Segment with occurrences converted from clusters and punctuations.
 */
function convertVerseToSegment(
  verseRef: string,
  verseData: VerseData,
  glossLanguage: string,
): Segment {
  const segmentId = generateSegmentId(verseRef);

  const wordOccurrences = verseData.clusters.map((cluster, clusterIndex): Occurrence => {
    const assignments = cluster.lexemes.map((lexeme): AnalysisAssignment => {
      const analysisId = generateAnalysisId(lexeme.lexemeId, lexeme.senseId, glossLanguage);
      const assignmentId = generateAssignmentId(
        generateOccurrenceIdFromCluster(segmentId, cluster.id, clusterIndex),
        analysisId,
      );

      return {
        id: assignmentId,
        occurrenceId: generateOccurrenceIdFromCluster(segmentId, cluster.id, clusterIndex),
        analysisId,
        status: verseData.hash ? AssignmentStatus.Approved : AssignmentStatus.Suggested,
      };
    });

    const occurrenceId = generateOccurrenceIdFromCluster(segmentId, cluster.id, clusterIndex);

    return {
      id: occurrenceId,
      segmentId,
      index: clusterIndex,
      anchor: textRangeToAnchor(cluster.textRange),
      surfaceText: '', // Paratext 9 doesn't specify surface text per cluster
      writingSystem: '', // Paratext 9 doesn't specify writing system per cluster
      type: OccurrenceType.Word,
      assignments,
    };
  });

  const punctuationOccurrences: Occurrence[] = verseData.punctuations.map(
    (punctuation, puncIndex): Occurrence => {
      const occurrenceIndex = wordOccurrences.length + puncIndex;

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
    },
  );

  const occurrences = [...wordOccurrences, ...punctuationOccurrences];

  return {
    id: segmentId,
    segmentRef: verseRef,
    baselineText: '', // Paratext 9 doesn't specify baseline text
    occurrences,
  };
}

/**
 * Creates Analysis objects for all unique lexemes across all verses.
 *
 * @param interlinearData - Paratext 9 interlinear data.
 * @returns Map of analysis ID to Analysis object.
 */
function createAnalyses(interlinearData: InterlinearData): Map<string, Analysis> {
  const analyses = new Map<string, Analysis>();
  const { glossLanguage } = interlinearData;

  // Collect all unique lexeme-sense pairs
  Object.values(interlinearData.verses).forEach((verseData) => {
    verseData.clusters.forEach((cluster) => {
      cluster.lexemes.forEach((lexeme) => {
        const analysisId = generateAnalysisId(lexeme.lexemeId, lexeme.senseId, glossLanguage);

        if (!analyses.has(analysisId)) {
          const analysis: Analysis = {
            id: analysisId,
            analysisLanguage: glossLanguage,
            analysisType: AnalysisType.Gloss, // Paratext 9 provides word-level glosses
            confidence: Confidence.Medium, // Default confidence level
            sourceSystem: 'paratext-9',
            sourceUser: 'paratext-9-parser',
            glossText: lexeme.senseId || undefined, // Use senseId as gloss text placeholder
            // Note: Paratext 9 doesn't provide POS, features, or morpheme bundles in the XML
          };

          analyses.set(analysisId, analysis);
        }
      });
    });
  });

  return analyses;
}

/**
 * Converts Paratext 9 InterlinearData to interlinearizer Interlinearization.
 *
 * This function performs the following mappings:
 *
 * - InterlinearData → Interlinearization (one per book)
 * - VerseData → Segment (one per verse)
 * - ClusterData → Occurrence (word type) with AnalysisAssignments
 * - PunctuationData → Occurrence (punctuation type)
 * - LexemeData → Analysis + AnalysisAssignment
 *
 * Note: Analysis objects are created but not directly attached to the Interlinearization. They are
 * referenced via AnalysisAssignment.analysisId. In a full implementation, you might want to store
 * them in a separate collection or attach them to a parent structure.
 *
 * @param interlinearData - Paratext 9 interlinear data to convert.
 * @param baselineTexts - Optional map of verse references to baseline text (for extracting
 *   surfaceText). If not provided, surfaceText will be empty strings.
 * @returns Converted Interlinearization object.
 */
export function convertParatext9ToInterlinearization(
  interlinearData: InterlinearData,
): Interlinearization {
  const { glossLanguage, bookId, verses } = interlinearData;

  const interlinearizationId = generateInterlinearizationId(bookId);
  const analyzedBookId = generateBookId(bookId);

  // Note: analyses are created but not returned - they're referenced via analysisId in assignments
  createAnalyses(interlinearData);

  const segments = Object.entries(verses).map(([verseRef, verseData]) => {
    return convertVerseToSegment(verseRef, verseData, glossLanguage);
  });

  const verseDataArray = Object.values(verses);
  const verseWithHash = verseDataArray.find((verseData) => verseData.hash);
  const textVersion = verseWithHash?.hash || '';

  const analyzedBook: AnalyzedBook = {
    id: analyzedBookId,
    bookRef: bookId,
    textVersion,
    segments,
  };

  const interlinearization: Interlinearization = {
    id: interlinearizationId,
    sourceWritingSystem: '', // Paratext 9 doesn't specify source writing system in InterlinearData
    analysisLanguages: [glossLanguage],
    books: [analyzedBook],
  };

  return interlinearization;
}
