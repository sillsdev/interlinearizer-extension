import type { Book, Segment } from 'interlinearizer';
import type { Pt9InterlinearBook } from 'platform-scripture';
import { composeLexemeKeyId, LexemeKeyData } from 'parsers/pt9/lexemeKey';
import { anchorVerseClusters, ClassifiedLexeme } from './clusterAnchoring';
import type { Pt9GlossSource } from './pt9GlossSource';
import { addClusterDrops, emptyBookReport, Pt9BookReport, Pt9SenseReport } from './report';

/** A lexeme with its gloss resolved for one language: the facts merging needs, nothing more. */
export interface ResolvedLexeme {
  key: LexemeKeyData;
  /** Composed key id, the identity two lexemes are compared by. */
  keyId: string;
  /**
   * The effective sense: the cluster's explicit selection, or the default sense when the lexicon
   * offers exactly one glossed sense in this language. Absent when neither applies.
   */
  senseId?: string;
  /** Resolved gloss text for this language; absent when unresolvable. */
  glossText?: string;
}

/** Review status a contribution carries before cross-language merging. */
export type LangRecordStatus = 'approved' | 'suggested' | 'rejected';

/** One language's analysis of one token: the unit the cross-language merger consumes. */
export interface LangTokenRecord {
  tag: string;
  tokenRef: string;
  tokenSurface: string;
  tokenWritingSystem: string;
  status: LangRecordStatus;
  ambiguous: boolean;
  word?: ResolvedLexeme;
  parse?: { lexemes: ResolvedLexeme[]; signature: string };
}

/** One language's phrase selection, anchored to its token run. */
export interface LangPhraseRecord {
  tag: string;
  phrase: ResolvedLexeme;
  tokens: { ref: string; surface: string }[];
  status: LangRecordStatus;
  ambiguous: boolean;
}

/**
 * Builds per-token and phrase contributions for one gloss language's book of interlinear data
 * against its book's text layer. Status follows the verse approval hash: present means approved,
 * absent means suggested, and a record whose every anchored facet is excluded imports as rejected.
 * Gloss resolution outcomes accumulate onto the shared sense report.
 */
export function buildLanguageBookAnalyses(args: {
  interlinear: Pt9InterlinearBook;
  /** The gloss-language value as written in the interlinear data. */
  rawLanguage: string;
  /** The book id the interlinear data carries. */
  bookId: string;
  /** Resolved tag the language's glosses are keyed by. */
  tag: string;
  /** The book's text layer; `undefined` when the source project has no text for this book. */
  book: Book | undefined;
  glossSource: Pt9GlossSource;
  /** Shared sense-outcome counters, incremented in place. */
  senses: Pt9SenseReport;
}): { records: LangTokenRecord[]; phrases: LangPhraseRecord[]; bookReport: Pt9BookReport } {
  const { interlinear, rawLanguage, bookId, tag, book, glossSource, senses } = args;
  const bookReport = emptyBookReport(bookId, book !== undefined);
  const segmentById = new Map<string, Segment>(
    (book?.segments ?? []).map((segment) => [segment.id, segment]),
  );

  const resolveLexeme = (lexeme: ClassifiedLexeme): ResolvedLexeme => {
    const outcome = glossSource.resolve(lexeme.key, lexeme.senseId, rawLanguage);
    const resolved: ResolvedLexeme = {
      key: lexeme.key,
      keyId: composeLexemeKeyId(lexeme.key),
    };
    if (outcome.kind === 'none') {
      senses.unresolvedGlossText += 1;
      return resolved;
    }
    if (outcome.kind === 'specific') {
      if (outcome.text === undefined) senses.unresolvedGlossText += 1;
      else senses.specificResolved += 1;
      return {
        ...resolved,
        senseId: outcome.senseId,
        ...(outcome.text !== undefined && { glossText: outcome.text }),
      };
    }
    senses.defaultSingleResolved += 1;
    return {
      ...resolved,
      ...(outcome.senseId !== undefined && { senseId: outcome.senseId }),
      glossText: outcome.text,
    };
  };

  const records: LangTokenRecord[] = [];
  const phrases: LangPhraseRecord[] = [];

  interlinear.verses.forEach((verse) => {
    bookReport.versesTotal += 1;
    if (verse.approvedHash !== undefined) bookReport.versesHashed += 1;
    bookReport.punctuationEntriesIgnored += verse.punctuations.length;
    bookReport.clustersTotal += verse.clusters.length;

    const segment = segmentById.get(verse.reference);
    if (segment === undefined) {
      bookReport.versesNotFound += 1;
      bookReport.clusterDrops.verseNotFound += verse.clusters.length;
      return;
    }

    const baseStatus: LangRecordStatus =
      verse.approvedHash !== undefined ? 'approved' : 'suggested';
    const anchored = anchorVerseClusters(segment, verse.clusters);
    addClusterDrops(bookReport.clusterDrops, anchored.dropCounts);
    bookReport.ambiguousAnchors += anchored.ambiguousCount;

    anchored.groups.forEach((group) => {
      const excludedFacets: boolean[] = [];
      if (group.word !== undefined) excludedFacets.push(group.word.excluded);
      if (group.parse !== undefined) excludedFacets.push(group.parse.excluded);
      // Every anchored group carries at least one facet, so every() never sees an empty array.
      const status = excludedFacets.every(Boolean) ? 'rejected' : baseStatus;
      bookReport.clustersConverted += excludedFacets.length;

      records.push({
        tag,
        tokenRef: group.token.ref,
        tokenSurface: group.token.surfaceText,
        tokenWritingSystem: group.token.writingSystem,
        status,
        ambiguous: group.ambiguous,
        ...(group.word !== undefined && { word: resolveLexeme(group.word.lexeme) }),
        ...(group.parse !== undefined && {
          parse: {
            lexemes: group.parse.lexemes.map(resolveLexeme),
            signature: group.parse.lexemes.map((l) => composeLexemeKeyId(l.key)).join('/'),
          },
        }),
      });
    });

    anchored.phrases.forEach((phrase) => {
      bookReport.phrasesConverted += 1;
      phrases.push({
        tag,
        phrase: resolveLexeme(phrase.lexeme),
        tokens: phrase.tokens.map((t) => ({ ref: t.ref, surface: t.surfaceText })),
        status: phrase.excluded ? 'rejected' : baseStatus,
        ambiguous: phrase.ambiguous,
      });
    });
  });

  return { records, phrases, bookReport };
}
