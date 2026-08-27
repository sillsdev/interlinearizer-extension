import type {
  AssignmentStatus,
  MorphemeAnalysis,
  MultiString,
  PhraseAnalysis,
  PhraseAnalysisLink,
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

/** The merged analysis layer, plus the identity of every parse converted into it. */
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

/** One language's per-morpheme sense and gloss columns for a parse. */
interface ParseColumns {
  senses: (string | undefined)[];
  glosses: (string | undefined)[];
}

/** The parse facet of a merged token record, with per-language columns keyed by tag. */
interface MergedParse {
  signature: string;
  keys: LexemeKeyData[];
  columns: Map<string, ParseColumns>;
}

/** One token record accumulating contributions across languages. */
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
  statuses: LangRecordStatus[];
  ambiguous: boolean;
  tags: Set<string>;
}

/** One phrase record accumulating contributions across languages. */
interface MergedPhrase {
  key: LexemeKeyData;
  tokens: { ref: string; surface: string }[];
  glosses: Map<string, string>;
  senses: Map<string, string | undefined>;
  statuses: LangRecordStatus[];
  ambiguous: boolean;
}

/** Merged review status: approved or rejected only when every contribution agrees. */
function mergeStatus(statuses: LangRecordStatus[]): LangRecordStatus {
  if (statuses.every((s) => s === 'approved')) return 'approved';
  if (statuses.every((s) => s === 'rejected')) return 'rejected';
  return 'suggested';
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

/**
 * Merges per-language contributions into the final analysis layer.
 *
 * Contributions sharing a token and word lexeme become one record whose glosses are keyed by
 * language tag; a parse from any language fills a record that lacks one, while a genuinely
 * different parse on the same token becomes a separate competing record. A sense reference is kept
 * only where every contributing language agrees on the sense. At most one record per token may be
 * approved, so later would-be-approved records are demoted to candidate.
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
  const { records, phrases, resolver, importedAt, report } = args;

  const merged: MergedToken[] = [];
  const mergedByKey = new Map<string, MergedToken>();
  const byToken = new Map<string, MergedToken[]>();

  const createMerged = (key: string, record: LangTokenRecord): MergedToken => {
    const entry: MergedToken = {
      tokenRef: record.tokenRef,
      surface: record.tokenSurface,
      writingSystem: record.tokenWritingSystem,
      glosses: new Map(),
      wordSenses: new Map(),
      statuses: [],
      ambiguous: false,
      tags: new Set(),
    };
    merged.push(entry);
    mergedByKey.set(key, entry);
    let list = byToken.get(record.tokenRef);
    if (list === undefined) {
      list = [];
      byToken.set(record.tokenRef, list);
    }
    list.push(entry);
    return entry;
  };

  const contribute = (entry: MergedToken, record: LangTokenRecord): void => {
    entry.statuses.push(record.status);
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
      if (!entry.parse.columns.has(record.tag)) {
        entry.parse.columns.set(record.tag, {
          senses: record.parse.lexemes.map((l) => l.senseId),
          glosses: record.parse.lexemes.map((l) => l.glossText),
        });
      }
    }
  };

  records.forEach((record) => {
    if (record.word !== undefined) {
      const baseKey = `${record.tokenRef}|w|${record.word.keyId}`;
      const existing = mergedByKey.get(baseKey);
      if (existing === undefined) {
        contribute(createMerged(baseKey, record), record);
        return;
      }
      const recordParse = record.parse;
      if (
        recordParse === undefined ||
        existing.parse === undefined ||
        existing.parse.signature === recordParse.signature
      ) {
        contribute(existing, record);
        return;
      }
      const conflictKey = `${baseKey}|p|${recordParse.signature}`;
      const conflictEntry = mergedByKey.get(conflictKey);
      if (conflictEntry !== undefined) {
        contribute(conflictEntry, record);
        return;
      }
      report.merge.parseConflicts += 1;
      contribute(createMerged(conflictKey, record), record);
      return;
    }
    // Parse-only contribution: keyed by its signature; fused onto word records afterward.
    const parseKey = `${record.tokenRef}|p|${record.parse?.signature}`;
    const existing = mergedByKey.get(parseKey);
    contribute(existing ?? createMerged(parseKey, record), record);
  });

  // Fuse parse-only records onto the word record they complete: the one sharing their parse, or
  // the sole word record still lacking a parse. An ambiguous target leaves them standalone.
  const removed = new Set<MergedToken>();
  byToken.forEach((list) => {
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
          standaloneParse.columns.forEach((columns, tag) => {
            if (!targetParse.columns.has(tag)) targetParse.columns.set(tag, columns);
          });
        }
        target.statuses.push(...standalone.statuses);
        target.ambiguous = target.ambiguous || standalone.ambiguous;
        standalone.tags.forEach((tag) => target.tags.add(tag));
        removed.add(standalone);
      });
  });

  const resolveSenseRef = (key: LexemeKeyData, senseId: string | undefined) => {
    if (senseId === undefined) return undefined;
    const ref = resolver.resolveSense(key, senseId);
    if (ref === undefined) report.senses.senseRefsUnresolved += 1;
    else report.senses.senseRefsResolved += 1;
    return ref;
  };

  const tokenAnalyses: TokenAnalysis[] = [];
  const tokenAnalysisLinks: TokenAnalysisLink[] = [];
  const clusterParseIdentities = new Set<string>();
  const approvedTokenSeen = new Set<string>();
  const idCounters = new Map<string, number>();

  merged
    .filter((entry) => !removed.has(entry))
    .forEach((entry) => {
      if (entry.tags.size > 1) report.merge.mergedTokenRecords += 1;

      let status: AssignmentStatus = mergeStatus(entry.statuses);
      if (status === 'approved') {
        if (approvedTokenSeen.has(entry.tokenRef)) {
          status = 'candidate';
          report.merge.approvedDemotedToCandidate += 1;
        } else approvedTokenSeen.add(entry.tokenRef);
      }

      const { parse } = entry;
      const morphemes: MorphemeAnalysis[] | undefined =
        parse === undefined
          ? undefined
          : parse.keys.map((key, i) => {
              const entryRef = resolver.resolveEntry(key);
              if (entryRef === undefined) report.senses.entryRefsUnresolved += 1;
              else report.senses.entryRefsResolved += 1;
              const senseColumns = [...parse.columns.values()].map((column) => column.senses[i]);
              const senseRef = resolveSenseRef(key, unanimous(senseColumns));
              const gloss = toMultiString(
                [...parse.columns.entries()].map(([tag, column]) => [tag, column.glosses[i]]),
              );
              return {
                id: `m${i}`,
                form: key.Form,
                writingSystem: entry.writingSystem,
                ...(gloss !== undefined && { gloss }),
                ...(entryRef !== undefined && { entryRef }),
                ...(senseRef !== undefined && { senseRef }),
              };
            });

      const gloss = toMultiString(entry.glosses.entries());
      const { wordKey } = entry;
      const glossSenseRef =
        wordKey === undefined
          ? undefined
          : resolveSenseRef(wordKey, unanimous(entry.wordSenses.values()));

      const count = idCounters.get(entry.tokenRef) ?? 0;
      idCounters.set(entry.tokenRef, count + 1);
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
        analysisId: id,
        createdAt: importedAt,
        updatedAt: importedAt,
        status,
        ...(entry.ambiguous && { confidence: 'low' }),
        token: { tokenRef: entry.tokenRef, surfaceText: entry.surface },
      });
    });

  // Phrases merge on their token run plus phrase lexeme, then honor the one-approved-phrase-per-
  // token invariant in insertion order.
  const mergedPhrases: MergedPhrase[] = [];
  const phrasesByKey = new Map<string, MergedPhrase>();
  phrases.forEach((record) => {
    // Token refs contain spaces, so the joiner must be a character no ref can carry.
    const key = `${record.tokens.map((t) => t.ref).join('\n')}|${record.phrase.keyId}`;
    let entry = phrasesByKey.get(key);
    if (entry === undefined) {
      entry = {
        key: record.phrase.key,
        tokens: record.tokens,
        glosses: new Map(),
        senses: new Map(),
        statuses: [],
        ambiguous: false,
      };
      mergedPhrases.push(entry);
      phrasesByKey.set(key, entry);
    }
    entry.statuses.push(record.status);
    entry.ambiguous = entry.ambiguous || record.ambiguous;
    if (!entry.senses.has(record.tag)) entry.senses.set(record.tag, record.phrase.senseId);
    if (record.phrase.glossText !== undefined && !entry.glosses.has(record.tag))
      entry.glosses.set(record.tag, record.phrase.glossText);
  });

  const phraseAnalyses: PhraseAnalysis[] = [];
  const phraseAnalysisLinks: PhraseAnalysisLink[] = [];
  const approvedPhraseTokens = new Set<string>();
  const phraseIdCounters = new Map<string, number>();
  mergedPhrases.forEach((entry) => {
    let status: AssignmentStatus = mergeStatus(entry.statuses);
    if (status === 'approved') {
      if (entry.tokens.some((t) => approvedPhraseTokens.has(t.ref))) {
        status = 'candidate';
        report.merge.approvedDemotedToCandidate += 1;
      } else entry.tokens.forEach((t) => approvedPhraseTokens.add(t.ref));
    }

    const gloss = toMultiString(entry.glosses.entries());
    const senseRef = resolveSenseRef(entry.key, unanimous(entry.senses.values()));

    const firstRef = entry.tokens[0].ref;
    const count = phraseIdCounters.get(firstRef) ?? 0;
    phraseIdCounters.set(firstRef, count + 1);
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
      analysisId: id,
      createdAt: importedAt,
      updatedAt: importedAt,
      status,
      ...(entry.ambiguous && { confidence: 'low' }),
      tokens: entry.tokens.map((t) => ({ tokenRef: t.ref, surfaceText: t.surface })),
    });
  });

  return {
    tokenAnalyses,
    tokenAnalysisLinks,
    phraseAnalyses,
    phraseAnalysisLinks,
    clusterParseIdentities,
  };
}
