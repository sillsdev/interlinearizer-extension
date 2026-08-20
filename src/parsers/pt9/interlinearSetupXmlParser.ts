import { X2jOptions, XMLParser } from 'fast-xml-parser';

/**
 * One per-gloss-language interlinear configuration. Every field is optional and preserved as
 * written; nothing here is validated against PT9's enums so files from future PT9 versions parse.
 */
export interface InterlinearSetupData {
  /**
   * Interlinear type name (XML attribute type) — e.g. `"BackTranslation"`, `"Glossing"`,
   * `"Adaptation"`. Kept as the raw string; PT9's list of names may grow.
   */
  Type?: string;
  /** Gloss language id (XML attribute language); keys the `Interlinear_{language}` directory. */
  LanguageId?: string;
  LanguageName?: string;
  FontName?: string;
  /** Kept as the raw element text rather than a number. */
  FontSize?: string;
  RightToLeft?: boolean;
  /** Whether PT9's related-language gloss guessing is enabled for this setup. */
  RelatedLanguages?: boolean;
  /** Whether approving a verse also exports it to the export project. */
  ExportOnApprove?: boolean;
  /** Name of the model text this setup glosses against. */
  MdlScrTextName?: string;
  /** Hex id of the model text, kept as the raw string. */
  MdlScrTextId?: string;
  /**
   * Whether the model text is a Paratext resource, a read-only published text distributed for
   * reference (e.g. a major-language translation), rather than a locally editable project.
   */
  MdlIsResource?: boolean;
  /** Name of the project the interlinearization exports into. */
  ExportScrTextName?: string;
  /** Hex id of the export project, kept as the raw string. */
  ExportScrTextId?: string;
}

/** Root setups data: one entry per configured gloss language. */
export interface InterlinearSetupsData {
  /** Setups in document order. */
  Setups: InterlinearSetupData[];
}

/** InterlinearSetup: type/language attributes plus text elements; empty parses as a bare string. */
type ParsedSetup =
  | string
  | {
      ['@_type']?: string;
      ['@_language']?: string;
      LanguageName?: string;
      FontName?: string;
      FontSize?: string;
      RightToLeft?: string;
      RelatedLanguages?: string;
      ExportOnApprove?: string;
      MdlScrTextName?: string;
      MdlScrTextId?: string;
      MdlIsResource?: string;
      ExportScrTextName?: string;
      ExportScrTextId?: string;
    };

/**
 * Root InterlinearSetupList element; an empty element parses as a bare string. The string carries
 * no data; it marks the root as present so a file with no configured setups parses as valid rather
 * than erroring as a missing root.
 */
type ParsedSetupListRoot = string | { InterlinearSetup?: ParsedSetup[] };

/** Root document: InterlinearSetupList. */
interface ParsedSetupXml {
  InterlinearSetupList?: ParsedSetupListRoot;
}

/**
 * Parses a serialized boolean element's text, treating any value other than `"true"` as false. An
 * absent element stays absent.
 */
function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  return raw === 'true';
}

/** Maps a parsed InterlinearSetup to {@link InterlinearSetupData}; a bare string is an empty setup. */
function extractSetup(setup: ParsedSetup): InterlinearSetupData {
  if (typeof setup === 'string') return {};
  const rightToLeft = parseBool(setup.RightToLeft);
  const relatedLanguages = parseBool(setup.RelatedLanguages);
  const exportOnApprove = parseBool(setup.ExportOnApprove);
  const mdlIsResource = parseBool(setup.MdlIsResource);
  return {
    ...(setup['@_type'] !== undefined && { Type: setup['@_type'] }),
    ...(setup['@_language'] !== undefined && { LanguageId: setup['@_language'] }),
    ...(setup.LanguageName !== undefined && { LanguageName: setup.LanguageName }),
    ...(setup.FontName !== undefined && { FontName: setup.FontName }),
    ...(setup.FontSize !== undefined && { FontSize: setup.FontSize }),
    ...(rightToLeft !== undefined && { RightToLeft: rightToLeft }),
    ...(relatedLanguages !== undefined && { RelatedLanguages: relatedLanguages }),
    ...(exportOnApprove !== undefined && { ExportOnApprove: exportOnApprove }),
    ...(setup.MdlScrTextName !== undefined && { MdlScrTextName: setup.MdlScrTextName }),
    ...(setup.MdlScrTextId !== undefined && { MdlScrTextId: setup.MdlScrTextId }),
    ...(mdlIsResource !== undefined && { MdlIsResource: mdlIsResource }),
    ...(setup.ExportScrTextName !== undefined && { ExportScrTextName: setup.ExportScrTextName }),
    ...(setup.ExportScrTextId !== undefined && { ExportScrTextId: setup.ExportScrTextId }),
  };
}

/**
 * Parses PT9 `InterlinearSetup.xml` strings into {@link InterlinearSetupsData}.
 *
 * Setups carry configuration only, so parsing is fully lenient: every field is optional and unknown
 * enum names survive as raw strings. Expects the schema described in [pt9-xml.md](pt9-xml.md).
 *
 * Each instance holds a configured `XMLParser`; create one parser and reuse it across multiple
 * `parse()` calls rather than constructing a new instance per file.
 */
export class InterlinearSetupXmlParser {
  private readonly parser: XMLParser;

  constructor() {
    const arrayPaths = new Set(['InterlinearSetupList.InterlinearSetup']);

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
   * Parses an `InterlinearSetup.xml` string into {@link InterlinearSetupsData}.
   *
   * @throws {SyntaxError} If the `InterlinearSetupList` root element is absent.
   */
  parse(xml: string): InterlinearSetupsData {
    const parsed: ParsedSetupXml = this.parser.parse(xml);
    const root = parsed.InterlinearSetupList;
    if (root === undefined) {
      throw new SyntaxError('Invalid XML: Missing InterlinearSetupList root element');
    }
    if (typeof root === 'string') return { Setups: [] };

    return { Setups: (root.InterlinearSetup ?? []).map(extractSetup) };
  }
}
