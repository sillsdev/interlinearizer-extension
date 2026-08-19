import type { Book, TextAnalysis } from 'interlinearizer';
import type { InterlinearData } from 'parsers/pt9/interlinearXmlParser';
import type { InterlinearSetupsData } from 'parsers/pt9/interlinearSetupXmlParser';
import type { LexiconData } from 'parsers/pt9/lexiconXmlParser';
import type { WordAnalysesData } from 'parsers/pt9/wordAnalysesXmlParser';
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

/** The parsed PT9 file set for one project. */
export interface Pt9ProjectData {
  /** One parsed interlinear file per gloss language and book, in discovery order. */
  interlinear: InterlinearData[];
  lexicon?: LexiconData;
  wordAnalyses?: WordAnalysesData;
  setups?: InterlinearSetupsData;
}

/** Everything one conversion needs; conversion itself is a pure function of these inputs. */
export interface Pt9ConversionInput {
  data: Pt9ProjectData;
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
  suggestedName: string;
  suggestedDescription: string;
}

/** One gloss language's files and identity during conversion. */
interface LanguageGroup {
  raw: string;
  tag: string;
  files: InterlinearData[];
  report: Pt9LanguageReport;
}

/**
 * Converts a PT9 project's parsed interlinear data into the extension's analysis layer, paired with
 * a report of what converted, what was dropped, and why.
 *
 * @throws {Error} If two interlinear files carry the same gloss language and book: one
 *   interlinearization per language and book is PT9's own file layout, so a duplicate means the
 *   caller assembled the input wrong.
 */
export function convertPt9Project(input: Pt9ConversionInput): Pt9ConversionResult {
  const { data, books, importedAt } = input;
  const resolver = input.resolver ?? unresolvedPt9LexiconResolver;
  const report = emptyPt9ImportReport();

  const seenFiles = new Set<string>();
  data.interlinear.forEach((file) => {
    const fileKey = `${file.GlossLanguage}\n${file.BookId}`;
    if (seenFiles.has(fileKey))
      throw new Error(
        `Duplicate interlinear data for language "${file.GlossLanguage}" book "${file.BookId}"`,
      );
    seenFiles.add(fileKey);
  });

  const languageGroups: LanguageGroup[] = [];
  const groupByRaw = new Map<string, LanguageGroup>();
  data.interlinear.forEach((file) => {
    let group = groupByRaw.get(file.GlossLanguage);
    if (group === undefined) {
      const resolved = resolveGlossLanguageTag(file.GlossLanguage);
      group = {
        raw: file.GlossLanguage,
        tag: resolved.tag,
        files: [],
        report: {
          rawLanguage: file.GlossLanguage,
          tag: resolved.tag,
          tagIsFallback: resolved.isFallback,
          books: [],
        },
      };
      languageGroups.push(group);
      groupByRaw.set(file.GlossLanguage, group);
      report.languages.push(group.report);
    }
    group.files.push(file);
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
    group.files.forEach((file) => {
      const build = buildLanguageBookAnalyses({
        file,
        tag: group.tag,
        book: booksByRef.get(file.BookId),
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

  const scrTextName = data.interlinear.find((file) => file.ScrTextName !== undefined)?.ScrTextName;
  const suggestedName = `${scrTextName ?? 'Paratext 9'} interlinear (${analysisLanguages.join(', ')})`;

  const setupNotes = languageGroups.flatMap((group) => {
    const setup = data.setups?.Setups.find((s) => s.LanguageId === group.raw);
    if (setup === undefined) return [];
    const model = setup.MdlScrTextName !== undefined ? ` (model ${setup.MdlScrTextName})` : '';
    const exportTo = setup.ExportScrTextName !== undefined ? ` -> ${setup.ExportScrTextName}` : '';
    return [`${group.raw}: ${setup.Type ?? 'unknown type'}${model}${exportTo}`];
  });
  const suggestedDescription = `Imported from Paratext 9 interlinear data.${
    setupNotes.length > 0 ? ` Setups: ${setupNotes.join('; ')}.` : ''
  }`;

  const analysis: TextAnalysis = {
    segmentAnalyses: [],
    segmentAnalysisLinks: [],
    tokenAnalyses: [...merged.tokenAnalyses, ...barePayloads],
    tokenAnalysisLinks: merged.tokenAnalysisLinks,
    phraseAnalyses: merged.phraseAnalyses,
    phraseAnalysisLinks: merged.phraseAnalysisLinks,
  };

  return { analysis, analysisLanguages, report, suggestedName, suggestedDescription };
}
