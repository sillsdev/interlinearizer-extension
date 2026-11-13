import type { Book, TextAnalysis } from 'interlinearizer';
import type { Pt9InterlinearBook, Pt9InterlinearProjectData } from 'platform-scripture';
import { mergeLanguageAnalyses } from './analysisMerger';
import { buildBareWordAnalyses } from './bareWordAnalyses';
import { resolveGlossLanguageTag } from './glossLanguageTags';
import {
  buildLanguageBookAnalyses,
  LangPhraseRecord,
  LangTokenRecord,
} from './languageAnalysisBuilder';
import { Pt9LexiconResolver, unresolvedPt9LexiconResolver } from './lexiconResolver';
import { dedupePhraseAnalyses } from './phraseAnalysisDedupe';
import { createPt9GlossSource } from './pt9GlossSource';
import { emptyPt9ImportReport, Pt9ImportReport, Pt9LanguageReport } from './report';
import { dedupeTokenAnalyses } from './tokenAnalysisDedupe';

/** Everything one conversion needs; conversion itself is a pure function of these inputs. */
export interface Pt9ConversionInput {
  /** The project's PT9 interlinear data as the platform serves it. */
  data: Pt9InterlinearProjectData;
  /** The source project's text layer, one entry per book. */
  books: Book[];
  /** Lexicon-extension resolution seam; defaults to resolving nothing. */
  resolver?: Pt9LexiconResolver;
  /** ISO 8601 stamp applied to every produced record and link. */
  importedAt: string;
}

/** The converted analysis layer plus everything the import service persists and reports. */
export interface Pt9ConversionResult {
  analysis: TextAnalysis;
  /** Resolved gloss-language tags, one per distinct tag, most approved-glossed tokens first. */
  analysisLanguages: string[];
  report: Pt9ImportReport;
}

/** One book of interlinear data whose gloss-language and book id are both present. */
interface IdentifiedBook {
  glossLanguage: string;
  bookId: string;
  interlinear: Pt9InterlinearBook;
}

/** One gloss language's books and identity during conversion. */
interface LanguageGroup {
  raw: string;
  tag: string;
  books: IdentifiedBook[];
  report: Pt9LanguageReport;
}

/**
 * Converts a PT9 project's interlinear data into the extension's analysis layer, paired with a
 * report of what converted, what was dropped, and why. Only the files that PT9's own reader loads
 * are converted, because PT9 never shows the rest. The report lists the rest by path.
 */
export function convertPt9Project(input: Pt9ConversionInput): Pt9ConversionResult {
  const { data, books, importedAt } = input;
  const resolver = input.resolver ?? unresolvedPt9LexiconResolver;
  const report = emptyPt9ImportReport();

  const loaded = data.books.flatMap((interlinear): IdentifiedBook[] => {
    if (!interlinear.isCanonicalPath) {
      report.filesPt9NeverLoads.push(interlinear.filePath);
      return [];
    }
    /* v8 ignore next 3 -- the platform marks a file canonical only when it names its gloss language and book id */
    if (interlinear.glossLanguage === undefined || interlinear.bookId === undefined) {
      throw new Error(`Canonical PT9 interlinear file ${interlinear.filePath} lacks its identity`);
    }
    return [{ glossLanguage: interlinear.glossLanguage, bookId: interlinear.bookId, interlinear }];
  });

  const languageGroups: LanguageGroup[] = [];
  const groupByRaw = new Map<string, LanguageGroup>();
  loaded.forEach((entry) => {
    let group = groupByRaw.get(entry.glossLanguage);
    if (group === undefined) {
      const resolved = resolveGlossLanguageTag(entry.glossLanguage);
      group = {
        raw: entry.glossLanguage,
        tag: resolved.tag,
        books: [],
        report: {
          rawLanguage: entry.glossLanguage,
          tag: resolved.tag,
          tagIsFallback: resolved.isFallback,
          books: [],
        },
      };
      languageGroups.push(group);
      groupByRaw.set(entry.glossLanguage, group);
      report.languages.push(group.report);
    }
    group.books.push(entry);
  });

  const rawsByTag = new Map<string, string[]>();
  languageGroups.forEach((group) => {
    const raws = rawsByTag.get(group.tag);
    if (raws === undefined) rawsByTag.set(group.tag, [group.raw]);
    else raws.push(group.raw);
  });
  rawsByTag.forEach((raws) => {
    if (raws.length > 1) report.merge.sameTagCollisions.push(raws);
  });

  const booksByRef = new Map(books.map((book) => [book.bookRef, book]));
  const glossSource = createPt9GlossSource(data.lexicon);

  const records: LangTokenRecord[] = [];
  const phrases: LangPhraseRecord[] = [];
  languageGroups.forEach((group) => {
    group.books.forEach((entry) => {
      const build = buildLanguageBookAnalyses({
        interlinear: entry.interlinear,
        rawLanguage: group.raw,
        bookId: entry.bookId,
        tag: group.tag,
        book: booksByRef.get(entry.bookId),
        glossSource,
        senses: report.senses,
      });
      group.report.books.push(build.bookReport);
      records.push(...build.records);
      phrases.push(...build.phrases);
    });
  });

  const merged = mergeLanguageAnalyses({ records, phrases, resolver, importedAt, report });

  const writingSystem =
    books
      .flatMap((book) => book.segments)
      .flatMap((segment) => segment.tokens)
      .find((token) => token.type === 'word')?.writingSystem ?? 'und';

  const barePayloads = buildBareWordAnalyses({
    wordAnalyses: data.wordAnalyses,
    lexicon: data.lexicon,
    languages: languageGroups.map((group) => ({ raw: group.raw, tag: group.tag })),
    glossSource,
    resolver,
    clusterParseIdentities: merged.clusterParseIdentities,
    writingSystem,
    importedAt,
    report,
  });

  const analysis: TextAnalysis = {
    segmentAnalyses: [],
    segmentAnalysisLinks: [],
    ...dedupeTokenAnalyses(
      {
        tokenAnalyses: [...merged.tokenAnalyses, ...barePayloads],
        tokenAnalysisLinks: merged.tokenAnalysisLinks,
      },
      report,
    ),
    ...dedupePhraseAnalyses(
      {
        phraseAnalyses: merged.phraseAnalyses,
        phraseAnalysisLinks: merged.phraseAnalysisLinks,
      },
      report,
    ),
  };

  // Read-only views show approved glosses only, so those rank first.
  const shownTokensByTag = new Map<string, Set<string>>();
  const glossedTokensByTag = new Map<string, Set<string>>();
  const credit = (tally: Map<string, Set<string>>, tags: string[], tokenRefs: string[]) =>
    tags.forEach((tag) => {
      const glossed = tally.get(tag) ?? new Set<string>();
      tokenRefs.forEach((ref) => glossed.add(ref));
      tally.set(tag, glossed);
    });
  const tokenAnalysisById = new Map(analysis.tokenAnalyses.map((ta) => [ta.id, ta]));
  analysis.tokenAnalysisLinks.forEach((link) => {
    if (link.status !== 'approved') return;
    const payload = tokenAnalysisById.get(link.analysisId);
    const tags = [
      ...Object.keys(payload?.gloss ?? {}),
      ...(payload?.morphemes ?? []).flatMap((morpheme) => Object.keys(morpheme.gloss ?? {})),
    ];
    credit(shownTokensByTag, tags, [link.token.tokenRef]);
  });
  const phraseAnalysisById = new Map(analysis.phraseAnalyses.map((pa) => [pa.id, pa]));
  analysis.phraseAnalysisLinks.forEach((link) => {
    if (link.status !== 'approved') return;
    credit(
      shownTokensByTag,
      Object.keys(phraseAnalysisById.get(link.analysisId)?.gloss ?? {}),
      link.tokens.map((token) => token.tokenRef),
    );
  });
  // The fallback tally counts every unrejected gloss, read from the records.
  records.forEach((record) => {
    if (record.status === 'rejected') return;
    const glossed =
      record.word?.glossText !== undefined ||
      (record.parse?.lexemes ?? []).some((lexeme) => lexeme.glossText !== undefined);
    if (glossed) credit(glossedTokensByTag, [record.tag], [record.tokenRef]);
  });
  phrases.forEach((record) => {
    if (record.status === 'rejected' || record.phrase.glossText === undefined) return;
    credit(
      glossedTokensByTag,
      [record.tag],
      record.tokens.map((token) => token.ref),
    );
  });
  const countOf = (tally: Map<string, Set<string>>, tag: string) => tally.get(tag)?.size ?? 0;
  const analysisLanguages = [...new Set(languageGroups.map((group) => group.tag))].sort(
    (a, b) =>
      countOf(shownTokensByTag, b) - countOf(shownTokensByTag, a) ||
      countOf(glossedTokensByTag, b) - countOf(glossedTokensByTag, a),
  );

  return { analysis, analysisLanguages, report };
}
