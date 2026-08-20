import { X2jOptions, XMLParser } from 'fast-xml-parser';

/** One analysis of a wordform: its ordered morpheme lexeme ids. */
export interface WordAnalysisData {
  /** Composed lexeme-key id strings (e.g. `"Stem:exauc"`), in morpheme order. */
  LexemeIds: string[];
}

/** All analyses recorded for one wordform. */
export interface WordAnalysesEntryData {
  /** Surface wordform the analyses apply to (XML attribute Word). */
  Word: string;
  /** Analyses in document order; a wordform may carry more than one. */
  Analyses: WordAnalysisData[];
}

/** Root word-analyses data: the confirmed wordform-to-parse inventory. */
export interface WordAnalysesData {
  /** Entries in document order. */
  Entries: WordAnalysesEntryData[];
}

/** Analysis: Lexeme id children; an empty element parses as a bare string. */
type ParsedAnalysis = string | { Lexeme?: string[] };

/** Entry: Word attribute plus Analysis children. */
interface ParsedEntry {
  ['@_Word']?: string;
  Analysis?: ParsedAnalysis[];
}

/**
 * Root WordAnalyses element; an empty element parses as a bare string. The string carries no data;
 * it marks the root as present so an empty inventory (no parses confirmed yet) parses as valid
 * rather than erroring as a missing root.
 */
type ParsedWordAnalysesRoot = string | { Entry?: ParsedEntry[] };

/** Root document: WordAnalyses. */
interface ParsedWordAnalysesXml {
  WordAnalyses?: ParsedWordAnalysesRoot;
}

/** Maps a parsed Analysis to {@link WordAnalysisData}; a bare string is an analysis with no lexemes. */
function extractAnalysis(analysis: ParsedAnalysis): WordAnalysisData {
  if (typeof analysis === 'string') return { LexemeIds: [] };
  return { LexemeIds: analysis.Lexeme ?? [] };
}

/**
 * Parses PT9 `WordAnalyses.xml` strings into {@link WordAnalysesData}.
 *
 * Lexeme ids are kept as the raw composed strings from the file. Expects the schema described in
 * [pt9-xml.md](pt9-xml.md).
 *
 * Each instance holds a configured `XMLParser`; create one parser and reuse it across multiple
 * `parse()` calls rather than constructing a new instance per file.
 */
export class WordAnalysesXmlParser {
  private readonly parser: XMLParser;

  constructor() {
    const arrayPaths = new Set([
      'WordAnalyses.Entry',
      'WordAnalyses.Entry.Analysis',
      'WordAnalyses.Entry.Analysis.Lexeme',
    ]);

    const options: Partial<X2jOptions> = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      ignoreDeclaration: true,
      ignorePiTags: true,
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
      isArray: (_tagName, jPath) => arrayPaths.has(`${jPath}`),
    };
    this.parser = new XMLParser(options);
  }

  /**
   * Parses a `WordAnalyses.xml` string into {@link WordAnalysesData}.
   *
   * @throws {SyntaxError} If the `WordAnalyses` root element is absent.
   * @throws {SyntaxError} If an `Entry` is missing its `Word` attribute or the attribute is empty.
   * @throws {SyntaxError} If two entries share a wordform.
   */
  parse(xml: string): WordAnalysesData {
    const parsed: ParsedWordAnalysesXml = this.parser.parse(xml);
    const root = parsed.WordAnalyses;
    if (root === undefined) {
      throw new SyntaxError('Invalid XML: Missing WordAnalyses root element');
    }
    if (typeof root === 'string') return { Entries: [] };

    const seen = new Set<string>();
    const entries = (root.Entry ?? []).map((entry) => {
      const word = entry['@_Word'];
      if (!word) {
        throw new SyntaxError('Invalid XML: Entry missing its Word attribute');
      }
      if (seen.has(word)) {
        throw new SyntaxError(`Invalid XML: Duplicate word analyses entry "${word}"`);
      }
      seen.add(word);
      return { Word: word, Analyses: (entry.Analysis ?? []).map(extractAnalysis) };
    });

    return { Entries: entries };
  }
}
