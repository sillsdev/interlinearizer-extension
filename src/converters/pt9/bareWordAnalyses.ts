import type { MorphemeAnalysis, TokenAnalysis } from 'interlinearizer';
import type { Pt9Lexicon, Pt9WordParse } from 'platform-scripture';
import { composeLexemeKeyId, LexemeKeyData, parseLexemeKeyId } from 'parsers/pt9/lexemeKey';
import { normalizeSurfaceForm } from '../../utils/analysis-identity';
import type { Pt9LexiconResolver } from './lexiconResolver';
import type { Pt9GlossSource } from './pt9GlossSource';
import type { Pt9ImportReport } from './report';

/** One deduplicated wordform analysis from the inventories, keys parsed and signature composed. */
interface InventoryAnalysis {
  word: string;
  keys: LexemeKeyData[];
  signature: string;
}

/**
 * Builds the unlinked token-analysis payloads from PT9's wordform-to-parse inventories: the stored
 * word analyses first, then the lexicon's legacy analyses for the wordforms and parses the newer
 * inventory lacks. These payloads describe a spelling rather than any one occurrence of it, so they
 * carry no links. An analysis identical to one already converted from a cluster is skipped rather
 * than duplicated.
 */
export function buildBareWordAnalyses(args: {
  wordAnalyses: Pt9WordParse[];
  lexicon: Pt9Lexicon | undefined;
  /** Gloss languages in discovery order, raw value paired with its resolved tag. */
  languages: { raw: string; tag: string }[];
  glossSource: Pt9GlossSource;
  resolver: Pt9LexiconResolver;
  /** Parse identities already converted from clusters, which are skipped here. */
  clusterParseIdentities: ReadonlySet<string>;
  /** Writing system stamped on morpheme forms (bare payloads have no token to inherit from). */
  writingSystem: string;
  /** Stamp applied to every payload's createdAt / updatedAt. */
  importedAt: string;
  /** Bare-payload and lexicon-ref counters are incremented in place. */
  report: Pt9ImportReport;
}): TokenAnalysis[] {
  const {
    wordAnalyses,
    lexicon,
    languages,
    glossSource,
    resolver,
    clusterParseIdentities,
    writingSystem,
    importedAt,
    report,
  } = args;

  const inventory: InventoryAnalysis[] = [];
  const seenByWord = new Map<string, Set<string>>();

  const addAnalysis = (word: string, keys: LexemeKeyData[]): void => {
    if (keys.length === 0) {
      report.barePayloads.droppedEmpty += 1;
      return;
    }
    const signature = keys.map(composeLexemeKeyId).join('/');
    let seen = seenByWord.get(word);
    if (seen === undefined) {
      seen = new Set();
      seenByWord.set(word, seen);
    }
    if (seen.has(signature)) return;
    seen.add(signature);
    inventory.push({ word, keys, signature });
  };

  const addParses = ({ word, analyses }: Pt9WordParse): void => {
    analyses.forEach((ids) => {
      const keys = ids.flatMap((id) => {
        const key = parseLexemeKeyId(id);
        return key === undefined ? [] : [key];
      });
      if (keys.length !== ids.length) {
        report.barePayloads.droppedUnparseable += 1;
        return;
      }
      addAnalysis(word, keys);
    });
  };
  wordAnalyses.forEach(addParses);
  (lexicon?.legacyAnalyses ?? []).forEach(addParses);

  const payloads: TokenAnalysis[] = [];
  const idCounters = new Map<string, number>();

  inventory.forEach(({ word, keys, signature }) => {
    if (clusterParseIdentities.has(`${normalizeSurfaceForm(word)}|${signature}`)) {
      report.barePayloads.skippedExistingIdentical += 1;
      return;
    }

    const morphemes: MorphemeAnalysis[] = keys.map((key, i) => {
      const entryRef = resolver.resolveEntry(key);
      if (entryRef === undefined) report.senses.entryRefsUnresolved += 1;
      else report.senses.entryRefsResolved += 1;

      const glossEntries: [string, string][] = [];
      const defaultSenseIds = new Set<string>();
      languages.forEach((language) => {
        const outcome = glossSource.resolve(key, undefined, language.raw);
        if (outcome.kind !== 'defaultSingle') return;
        if (glossEntries.every(([tag]) => tag !== language.tag))
          glossEntries.push([language.tag, outcome.text]);
        if (outcome.senseId !== undefined) defaultSenseIds.add(outcome.senseId);
      });

      // A ref is attempted only when the defaults found across languages carry exactly one
      // distinct sense id; a default without an id adds nothing to the set.
      let senseRef;
      if (defaultSenseIds.size === 1) {
        const [senseId] = defaultSenseIds;
        senseRef = resolver.resolveSense(key, senseId);
        if (senseRef === undefined) report.senses.senseRefsUnresolved += 1;
        else report.senses.senseRefsResolved += 1;
      }

      return {
        id: `m${i}`,
        form: key.Form,
        writingSystem,
        ...(glossEntries.length > 0 && { gloss: Object.fromEntries(glossEntries) }),
        ...(entryRef !== undefined && { entryRef }),
        ...(senseRef !== undefined && { senseRef }),
      };
    });

    const count = idCounters.get(word) ?? 0;
    idCounters.set(word, count + 1);
    report.barePayloads.added += 1;
    payloads.push({
      id: `pt9:wa:${word}:${count}`,
      createdAt: importedAt,
      updatedAt: importedAt,
      surfaceText: word,
      producer: 'pt9-import:word-analyses',
      morphemes,
    });
  });

  return payloads;
}
