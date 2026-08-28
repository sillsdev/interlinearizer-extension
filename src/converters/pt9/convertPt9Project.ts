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
import { createPt9GlossSource } from './pt9GlossSource';
import { emptyPt9ImportReport, Pt9ImportReport, Pt9LanguageReport } from './report';

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
  /** Resolved gloss-language tags in discovery order, one per distinct tag. */
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
 * report of what converted, what was dropped, and why. When several books carry the same gloss
 * language and book id (a Send/Receive merge can leave a root-level twin beside the canonical
 * file), the one PT9's own reader loads wins and the rest are counted, never converted.
 */
export function convertPt9Project(input: Pt9ConversionInput): Pt9ConversionResult {
  const { data, books, importedAt } = input;
  const resolver = input.resolver ?? unresolvedPt9LexiconResolver;
  const report = emptyPt9ImportReport();

  const identified = data.books.flatMap((interlinear): IdentifiedBook[] => {
    if (interlinear.glossLanguage === undefined || interlinear.bookId === undefined) {
      report.booksMissingIdentity += 1;
      return [];
    }
    return [{ glossLanguage: interlinear.glossLanguage, bookId: interlinear.bookId, interlinear }];
  });

  const byIdentity = new Map<string, IdentifiedBook[]>();
  identified.forEach((entry) => {
    const bookKey = `${entry.glossLanguage}\n${entry.bookId}`;
    const twins = byIdentity.get(bookKey);
    if (twins === undefined) byIdentity.set(bookKey, [entry]);
    else twins.push(entry);
  });
  const winners: IdentifiedBook[] = [];
  byIdentity.forEach((twins) => {
    winners.push(twins.find((entry) => entry.interlinear.isCanonicalPath) ?? twins[0]);
    report.booksDroppedAsDuplicates += twins.length - 1;
  });

  const languageGroups: LanguageGroup[] = [];
  const groupByRaw = new Map<string, LanguageGroup>();
  winners.forEach((entry) => {
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

  const analysisLanguages: string[] = [];
  languageGroups.forEach((group) => {
    if (!analysisLanguages.includes(group.tag)) analysisLanguages.push(group.tag);
  });

  const analysis: TextAnalysis = {
    segmentAnalyses: [],
    segmentAnalysisLinks: [],
    tokenAnalyses: [...merged.tokenAnalyses, ...barePayloads],
    tokenAnalysisLinks: merged.tokenAnalysisLinks,
    phraseAnalyses: merged.phraseAnalyses,
    phraseAnalysisLinks: merged.phraseAnalysisLinks,
  };

  return { analysis, analysisLanguages, report };
}
