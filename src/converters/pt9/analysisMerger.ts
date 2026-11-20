import type {
  AssignmentStatus,
  EntryRef,
  MorphemeAnalysis,
  MultiString,
  PhraseAnalysis,
  PhraseAnalysisLink,
  SenseRef,
  TokenAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import type { LexemeKeyData } from 'parsers/pt9/lexemeKey';
import { normalizeSurfaceForm } from '../../utils/analysis-identity';
import type {
  LangPhraseRecord,
  LangRecordStatus,
  LangTokenRecord,
} from './languageAnalysisBuilder';
import type { Pt9LexiconResolver } from './lexiconResolver';
import type { Pt9ImportReport } from './report';

/**
 * The analysis layer after every gloss language's records are merged - one record per token and
 * parse, one per phrase occurrence - plus the identity of every parse converted into it.
 */
export interface MergedAnalyses {
  tokenAnalyses: TokenAnalysis[];
  tokenAnalysisLinks: TokenAnalysisLink[];
  phraseAnalyses: PhraseAnalysis[];
  phraseAnalysisLinks: PhraseAnalysisLink[];
  /**
   * `foldedSurface|keyId/keyId` for every parse converted here, so the same analysis arriving from
   * another source can be recognized as a duplicate.
   */
  clusterParseIdentities: Set<string>;
}

/**
 * One language's per-morpheme sense and gloss columns, merged positionally onto the shared parse so
 * each morpheme carries every language's gloss.
 */
interface ParseColumns {
  senses: (string | undefined)[];
  glosses: (string | undefined)[];
}

/**
 * One morphological breakdown with the columns of every language that contributed it, keyed by tag:
 * languages agreeing on the same lexeme sequence merge here instead of forming competing records.
 */
interface MergedParse {
  signature: string;
  keys: LexemeKeyData[];
  columns: Map<string, ParseColumns>;
}

/**
 * Every language's contributions for one token that share one parse (or none) and one status,
 * merged so the token gets a single record with MultiString glosses. A conflicting parse or status
 * starts a separate competing record instead.
 */
interface MergedToken {
  tokenRef: string;
  surface: string;
  writingSystem: string;
  wordKey?: LexemeKeyData;
  /** Tag -> word-level gloss text (first contribution per tag wins). */
  glosses: Map<string, string>;
  /** Tag -> the word facet's effective sense id (first contribution per tag wins). */
  wordSenses: Map<string, string | undefined>;
  parse?: MergedParse;
  status: LangRecordStatus;
  ambiguous: boolean;
  tags: Set<string>;
}

/**
 * Every language's contributions for one phrase occurrence that share one status, merged so the
 * phrase gets a single record with MultiString glosses. An occurrence is one phrase lexeme on one
 * token run.
 */
interface MergedPhrase {
  key: LexemeKeyData;
  tokens: { ref: string; surface: string }[];
  glosses: Map<string, string>;
  senses: Map<string, string | undefined>;
  status: LangRecordStatus;
  ambiguous: boolean;
}

/**
 * Adds one language's columns to a parse; a tag already present keeps its glossed morphemes and
 * takes the sense and gloss of the later contribution only where it had no gloss.
 */
function addParseColumns(parse: MergedParse, tag: string, incoming: ParseColumns): void {
  const existing = parse.columns.get(tag);
  if (existing === undefined) {
    parse.columns.set(tag, incoming);
    return;
  }
  incoming.glosses.forEach((gloss, i) => {
    if (gloss === undefined || existing.glosses[i] !== undefined) return;
    existing.glosses[i] = gloss;
    existing.senses[i] = incoming.senses[i];
  });
}

/** A MultiString built from per-tag texts, or `undefined` when no tag has one. */
function toMultiString(entries: Iterable<[string, string | undefined]>): MultiString | undefined {
  const result: MultiString = {};
  [...entries].forEach(([tag, text]) => {
    if (text !== undefined) result[tag] = text;
  });
  return Object.keys(result).length === 0 ? undefined : result;
}

/** The single value all contributions agree on, or `undefined` when absent or contested. */
function unanimous(values: Iterable<string | undefined>): string | undefined {
  const list = [...values];
  /* v8 ignore next -- no caller passes an empty collection; the guard keeps the contract total */
  if (list.length === 0) return undefined;
  const [agreed] = list;
  if (agreed === undefined) return undefined;
  return list.every((value) => value === agreed) ? agreed : undefined;
}

/** Lexicon lookups that count every resolved and unresolved reference in the import report. */
interface ReportingResolver {
  resolveEntry(key: LexemeKeyData): EntryRef | undefined;
  /** An absent `senseId` resolves to nothing and is not counted. */
  resolveSense(key: LexemeKeyData, senseId: string | undefined): SenseRef | undefined;
}

function makeReportingResolver(
  resolver: Pt9LexiconResolver,
  report: Pt9ImportReport,
): ReportingResolver {
  return {
    resolveEntry: (key) => {
      const ref = resolver.resolveEntry(key);
      if (ref === undefined) report.senses.entryRefsUnresolved += 1;
      else report.senses.entryRefsResolved += 1;
      return ref;
    },
    resolveSense: (key, senseId) => {
      if (senseId === undefined) return undefined;
      const ref = resolver.resolveSense(key, senseId);
      if (ref === undefined) report.senses.senseRefsUnresolved += 1;
      else report.senses.senseRefsResolved += 1;
      return ref;
    },
  };
}

/**
 * The status a record takes, given the tokens that already hold an approved record. At most one
 * record per token may be approved. An approval touching any of those tokens demotes to candidate
 * and is counted in the report. A kept approval claims its tokens in `approvedTokens`.
 */
function demoteRepeatedApproval(
  status: LangRecordStatus,
  tokenRefs: string[],
  approvedTokens: Set<string>,
  report: Pt9ImportReport,
): AssignmentStatus {
  if (status !== 'approved') return status;
  if (tokenRefs.some((ref) => approvedTokens.has(ref))) {
    report.merge.approvedDemotedToCandidate += 1;
    return 'candidate';
  }
  tokenRefs.forEach((ref) => approvedTokens.add(ref));
  return status;
}

/** Takes the next ordinal for `key`, counting from zero. */
function nextOrdinal(counters: Map<string, number>, key: string): number {
  const ordinal = counters.get(key) ?? 0;
  counters.set(key, ordinal + 1);
  return ordinal;
}

function addTokenContribution(entry: MergedToken, record: LangTokenRecord): void {
  entry.ambiguous = entry.ambiguous || record.ambiguous;
  entry.tags.add(record.tag);
  if (record.word !== undefined) {
    entry.wordKey = entry.wordKey ?? record.word.key;
    if (!entry.wordSenses.has(record.tag)) entry.wordSenses.set(record.tag, record.word.senseId);
    if (record.word.glossText !== undefined && !entry.glosses.has(record.tag))
      entry.glosses.set(record.tag, record.word.glossText);
  }
  if (record.parse !== undefined) {
    if (entry.parse === undefined) {
      entry.parse = {
        signature: record.parse.signature,
        keys: record.parse.lexemes.map((l) => l.key),
        columns: new Map(),
      };
    }
    addParseColumns(entry.parse, record.tag, {
      senses: record.parse.lexemes.map((l) => l.senseId),
      glosses: record.parse.lexemes.map((l) => l.glossText),
    });
  }
}

/**
 * Merges every language's token records into one record per token, status, and word lexeme, in
 * first-seen order. A word record whose parse conflicts with the merged one starts a competing
 * record. Parse-only records merge with others of the same parse.
 */
function mergeTokenRecords(records: LangTokenRecord[], report: Pt9ImportReport): MergedToken[] {
  const merged: MergedToken[] = [];
  const mergedByKey = new Map<string, MergedToken>();

  const createMerged = (key: string, record: LangTokenRecord): MergedToken => {
    const entry: MergedToken = {
      tokenRef: record.tokenRef,
      surface: record.tokenSurface,
      writingSystem: record.tokenWritingSystem,
      glosses: new Map(),
      wordSenses: new Map(),
      status: record.status,
      ambiguous: false,
      tags: new Set(),
    };
    merged.push(entry);
    mergedByKey.set(key, entry);
    return entry;
  };

  records.forEach((record) => {
    if (record.word !== undefined) {
      const baseKey = `${record.tokenRef}|${record.status}|w|${record.word.keyId}`;
      const existing = mergedByKey.get(baseKey);
      if (existing === undefined) {
        addTokenContribution(createMerged(baseKey, record), record);
        return;
      }
      const recordParse = record.parse;
      if (
        recordParse === undefined ||
        existing.parse === undefined ||
        existing.parse.signature === recordParse.signature
      ) {
        addTokenContribution(existing, record);
        return;
      }
      const conflictKey = `${baseKey}|p|${recordParse.signature}`;
      const conflictEntry = mergedByKey.get(conflictKey);
      if (conflictEntry !== undefined) {
        addTokenContribution(conflictEntry, record);
        return;
      }
      report.merge.parseConflicts += 1;
      addTokenContribution(createMerged(conflictKey, record), record);
      return;
    }
    // Parse-only contribution: keyed by its status and signature, and fused onto word records
    // afterward.
    const parseKey = `${record.tokenRef}|${record.status}|p|${record.parse?.signature}`;
    const existing = mergedByKey.get(parseKey);
    addTokenContribution(existing ?? createMerged(parseKey, record), record);
  });

  return merged;
}

/**
 * Fuses each parse-only record onto the same-status word record it completes: the one sharing its
 * parse, or the sole one still lacking a parse. A parse-only record with no single such target
 * stays standalone.
 *
 * @returns The records that remain after fusing, in their original order.
 */
function fuseParseOnlyRecords(merged: MergedToken[]): MergedToken[] {
  const byTokenAndStatus = new Map<string, MergedToken[]>();
  merged.forEach((entry) => {
    const group = `${entry.tokenRef}|${entry.status}`;
    const list = byTokenAndStatus.get(group);
    if (list === undefined) byTokenAndStatus.set(group, [entry]);
    else list.push(entry);
  });

  const removed = new Set<MergedToken>();
  byTokenAndStatus.forEach((list) => {
    list
      .filter((entry) => entry.wordKey === undefined && entry.parse !== undefined)
      .forEach((standalone) => {
        const standaloneParse = standalone.parse;
        /* v8 ignore next 2 -- the filter above guarantees a parse facet */
        if (standaloneParse === undefined) return;
        const sameParseTarget = list.find(
          (entry) =>
            entry !== standalone &&
            !removed.has(entry) &&
            entry.parse?.signature === standaloneParse.signature,
        );
        const wordsWithoutParse = list.filter(
          (entry) =>
            entry !== standalone &&
            !removed.has(entry) &&
            entry.wordKey !== undefined &&
            entry.parse === undefined,
        );
        const target =
          sameParseTarget ?? (wordsWithoutParse.length === 1 ? wordsWithoutParse[0] : undefined);
        if (target === undefined) return;
        const targetParse = target.parse;
        if (targetParse === undefined) target.parse = standaloneParse;
        else {
          standaloneParse.columns.forEach((columns, tag) =>
            addParseColumns(targetParse, tag, columns),
          );
        }
        target.ambiguous = target.ambiguous || standalone.ambiguous;
        standalone.tags.forEach((tag) => target.tags.add(tag));
        removed.add(standalone);
      });
  });

  return merged.filter((entry) => !removed.has(entry));
}

function buildMorphemes(
  parse: MergedParse,
  writingSystem: string,
  resolver: ReportingResolver,
): MorphemeAnalysis[] {
  return parse.keys.map((key, i) => {
    const entryRef = resolver.resolveEntry(key);
    const senseColumns = [...parse.columns.values()].map((column) => column.senses[i]);
    const senseRef = resolver.resolveSense(key, unanimous(senseColumns));
    const gloss = toMultiString(
      [...parse.columns.entries()].map(([tag, column]) => [tag, column.glosses[i]]),
    );
    return {
      id: `m${i}`,
      form: key.Form,
      writingSystem,
      ...(gloss !== undefined && { gloss }),
      ...(entryRef !== undefined && { entryRef }),
      ...(senseRef !== undefined && { senseRef }),
    };
  });
}

/** Builds each merged token record's analysis and link, numbering their ids per token. */
function emitTokenAnalyses(
  tokens: MergedToken[],
  resolver: ReportingResolver,
  importedAt: string,
  report: Pt9ImportReport,
): Pick<MergedAnalyses, 'tokenAnalyses' | 'tokenAnalysisLinks' | 'clusterParseIdentities'> {
  const tokenAnalyses: TokenAnalysis[] = [];
  const tokenAnalysisLinks: TokenAnalysisLink[] = [];
  const clusterParseIdentities = new Set<string>();
  const approvedTokens = new Set<string>();
  const idCounters = new Map<string, number>();

  tokens.forEach((entry) => {
    if (entry.tags.size > 1) report.merge.mergedTokenRecords += 1;

    const status = demoteRepeatedApproval(entry.status, [entry.tokenRef], approvedTokens, report);

    const { parse } = entry;
    const morphemes =
      parse === undefined ? undefined : buildMorphemes(parse, entry.writingSystem, resolver);

    const gloss = toMultiString(entry.glosses.entries());
    const { wordKey } = entry;
    const glossSenseRef =
      wordKey === undefined
        ? undefined
        : resolver.resolveSense(wordKey, unanimous(entry.wordSenses.values()));

    const count = nextOrdinal(idCounters, entry.tokenRef);
    const id = `pt9:ta:${entry.tokenRef}:${count}`;

    if (parse !== undefined)
      clusterParseIdentities.add(`${normalizeSurfaceForm(entry.surface)}|${parse.signature}`);

    tokenAnalyses.push({
      id,
      createdAt: importedAt,
      updatedAt: importedAt,
      surfaceText: entry.surface,
      producer: 'pt9-import',
      ...(gloss !== undefined && { gloss }),
      ...(glossSenseRef !== undefined && { glossSenseRef }),
      ...(morphemes !== undefined && { morphemes }),
    });
    tokenAnalysisLinks.push({
      id: `pt9:tl:${entry.tokenRef}:${count}`,
      analysisId: id,
      createdAt: importedAt,
      updatedAt: importedAt,
      status,
      ...(entry.ambiguous && { confidence: 'low' }),
      token: { tokenRef: entry.tokenRef, surfaceText: entry.surface },
    });
  });

  return { tokenAnalyses, tokenAnalysisLinks, clusterParseIdentities };
}

/** Merges every language's phrase records into one record per token run, status, and lexeme. */
function mergePhraseRecords(phrases: LangPhraseRecord[]): MergedPhrase[] {
  const mergedPhrases: MergedPhrase[] = [];
  const phrasesByKey = new Map<string, MergedPhrase>();
  phrases.forEach((record) => {
    // Token refs contain spaces, so the joiner must be a character no ref can carry.
    const key = `${record.tokens.map((t) => t.ref).join('\n')}|${record.status}|${record.phrase.keyId}`;
    let entry = phrasesByKey.get(key);
    if (entry === undefined) {
      entry = {
        key: record.phrase.key,
        tokens: record.tokens,
        glosses: new Map(),
        senses: new Map(),
        status: record.status,
        ambiguous: false,
      };
      mergedPhrases.push(entry);
      phrasesByKey.set(key, entry);
    }
    entry.ambiguous = entry.ambiguous || record.ambiguous;
    if (!entry.senses.has(record.tag)) entry.senses.set(record.tag, record.phrase.senseId);
    if (record.phrase.glossText !== undefined && !entry.glosses.has(record.tag))
      entry.glosses.set(record.tag, record.phrase.glossText);
  });
  return mergedPhrases;
}

/**
 * Builds each merged phrase record's analysis and link, numbering their ids per first token. When
 * approved phrases share a token, the first in record order keeps its approval.
 */
function emitPhraseAnalyses(
  mergedPhrases: MergedPhrase[],
  resolver: ReportingResolver,
  importedAt: string,
  report: Pt9ImportReport,
): Pick<MergedAnalyses, 'phraseAnalyses' | 'phraseAnalysisLinks'> {
  const phraseAnalyses: PhraseAnalysis[] = [];
  const phraseAnalysisLinks: PhraseAnalysisLink[] = [];
  const approvedPhraseTokens = new Set<string>();
  const idCounters = new Map<string, number>();

  mergedPhrases.forEach((entry) => {
    const status = demoteRepeatedApproval(
      entry.status,
      entry.tokens.map((t) => t.ref),
      approvedPhraseTokens,
      report,
    );

    const gloss = toMultiString(entry.glosses.entries());
    const senseRef = resolver.resolveSense(entry.key, unanimous(entry.senses.values()));

    const firstRef = entry.tokens[0].ref;
    const count = nextOrdinal(idCounters, firstRef);
    const id = `pt9:pa:${firstRef}:${count}`;

    phraseAnalyses.push({
      id,
      createdAt: importedAt,
      updatedAt: importedAt,
      surfaceText: entry.tokens.map((t) => t.surface).join(' '),
      producer: 'pt9-import',
      ...(gloss !== undefined && { gloss }),
      ...(senseRef !== undefined && { senseRef }),
    });
    phraseAnalysisLinks.push({
      id: `pt9:pl:${firstRef}:${count}`,
      analysisId: id,
      createdAt: importedAt,
      updatedAt: importedAt,
      status,
      ...(entry.ambiguous && { confidence: 'low' }),
      tokens: entry.tokens.map((t) => ({ tokenRef: t.ref, surfaceText: t.surface })),
    });
  });

  return { phraseAnalyses, phraseAnalysisLinks };
}

/**
 * Merges per-language contributions into the final analysis layer.
 *
 * Contributions sharing a token, word lexeme, and status become one record whose glosses are keyed
 * by language tag. A parse from any language of that status fills a record that lacks one. A
 * genuinely different parse on the same token becomes a separate competing record.
 *
 * Each language's status stands alone, as it does in Paratext 9. Where languages disagree on a
 * token's or phrase's status, each status gets its own record. Two such records that carry
 * identical payloads still fold into one link when the import dedupes payloads; a link's status
 * names no language.
 *
 * A sense reference is kept only where every contributing language agrees on the sense. At most one
 * record per token may be approved. Later approvals on an approved token are demoted to candidate.
 */
export function mergeLanguageAnalyses(args: {
  records: LangTokenRecord[];
  phrases: LangPhraseRecord[];
  resolver: Pt9LexiconResolver;
  /** Stamp applied to every record and link's createdAt / updatedAt. */
  importedAt: string;
  /** Merge and sense counters are incremented in place. */
  report: Pt9ImportReport;
}): MergedAnalyses {
  const { records, phrases, importedAt, report } = args;
  const resolver = makeReportingResolver(args.resolver, report);
  const tokens = fuseParseOnlyRecords(mergeTokenRecords(records, report));
  return {
    ...emitTokenAnalyses(tokens, resolver, importedAt, report),
    ...emitPhraseAnalyses(mergePhraseRecords(phrases), resolver, importedAt, report),
  };
}
