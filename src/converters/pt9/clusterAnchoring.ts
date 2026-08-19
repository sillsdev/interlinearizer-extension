import type { Segment, Token } from 'interlinearizer';
import type { ClusterData } from 'parsers/pt9/interlinearXmlParser';
import { LexemeKeyData, parseLexemeKeyId } from 'parsers/pt9/lexemeKey';
import { normalizeSurfaceForm } from '../../utils/analysis-identity';
import { emptyClusterDrops, Pt9ClusterDropReason } from './report';

/** One lexeme of a classified cluster: its parsed key and the cluster's sense selection for it. */
export interface ClassifiedLexeme {
  key: LexemeKeyData;
  senseId?: string;
}

/**
 * A cluster sorted into the kind that decides its conversion, mirroring how PT9 derives cluster
 * type from lexeme types: any stem/suffix/prefix makes a word parse; a single Word or Phrase lexeme
 * makes those kinds; everything else (Lemma clusters, empty clusters, unknown types) is dropped.
 */
export type ClassifiedCluster =
  | { kind: 'word'; cluster: ClusterData; lexeme: ClassifiedLexeme }
  | { kind: 'wordParse'; cluster: ClusterData; lexemes: ClassifiedLexeme[] }
  | { kind: 'phrase'; cluster: ClusterData; lexeme: ClassifiedLexeme }
  | { kind: 'drop'; cluster: ClusterData; reason: 'lemmaOrOther' | 'unparseableLexemeId' };

/** Lexeme types whose presence makes a cluster a word parse in PT9's derivation. */
const PARSE_TYPES = new Set(['Stem', 'Suffix', 'Prefix']);

/** Classifies one cluster by its lexeme-id prefixes (the type is never persisted in the XML). */
export function classifyCluster(cluster: ClusterData): ClassifiedCluster {
  const lexemes = cluster.Lexemes.flatMap((lexeme): ClassifiedLexeme[] => {
    const key = parseLexemeKeyId(lexeme.LexemeId);
    if (key === undefined) return [];
    return [{ key, ...(lexeme.SenseId !== undefined && { senseId: lexeme.SenseId }) }];
  });
  if (lexemes.length !== cluster.Lexemes.length)
    return { kind: 'drop', cluster, reason: 'unparseableLexemeId' };

  if (lexemes.some((l) => PARSE_TYPES.has(l.key.Type)))
    return { kind: 'wordParse', cluster, lexemes };
  if (lexemes.length === 1 && lexemes[0].key.Type === 'Word')
    return { kind: 'word', cluster, lexeme: lexemes[0] };
  if (lexemes.length === 1 && lexemes[0].key.Type === 'Phrase')
    return { kind: 'phrase', cluster, lexeme: lexemes[0] };
  return { kind: 'drop', cluster, reason: 'lemmaOrOther' };
}

/** A token with the word and/or parse cluster that anchored to it. */
export interface AnchoredTokenGroup {
  token: Token;
  /** The word cluster that landed on this token, carrying its Excluded flag. */
  word?: { lexeme: ClassifiedLexeme; excluded: boolean };
  /** The parse cluster that landed on this token, carrying its Excluded flag. */
  parse?: { lexemes: ClassifiedLexeme[]; excluded: boolean };
  /** True when several tokens folded to the cluster's form, so the choice among them is a guess. */
  ambiguous: boolean;
}

/** A phrase cluster anchored to a consecutive run of word tokens. */
export interface AnchoredPhrase {
  lexeme: ClassifiedLexeme;
  excluded: boolean;
  tokens: Token[];
  ambiguous: boolean;
}

/** The anchoring outcome for one verse. */
export interface VerseAnchorResult {
  groups: AnchoredTokenGroup[];
  phrases: AnchoredPhrase[];
  dropCounts: Record<Pt9ClusterDropReason, number>;
  /** Anchors (token groups and phrases) placed ambiguously. */
  ambiguousCount: number;
}

/**
 * Picks the candidate whose relative text position best matches the cluster's relative range
 * position, which is what separates repeated surface forms. Offsets index different strings (plain
 * baseline vs. PT9's marker-bearing USFM), so only the proportion is meaningful, never the absolute
 * values themselves.
 */
function pickByProportionalPrior(
  candidates: number[],
  wordTokens: Token[],
  clusterIndex: number,
  baselineLength: number,
  verseExtent: number,
): number {
  const target = clusterIndex / verseExtent;
  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate) => {
    const distance = Math.abs(wordTokens[candidate].charStart / baselineLength - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  });
  return best;
}

/** A word and parse cluster paired by their identical text range, the way PT9 pairs them. */
interface RangeGroup {
  index: number;
  length: number;
  word?: { classified: Extract<ClassifiedCluster, { kind: 'word' }> };
  parse?: { classified: Extract<ClassifiedCluster, { kind: 'wordParse' }> };
}

/**
 * Anchors one verse's clusters onto its segment's word tokens.
 *
 * Lexeme forms are the ground truth: they are matched case- and normalization-folded, in order,
 * because PT9's stored offsets index a different string than the segment's baseline text and cannot
 * be applied to it. The range index therefore serves only as ordering and, among equal-folding
 * candidates, as a position prior. Word and parse clusters covering the identical range anchor
 * together onto one token, while phrases anchor to consecutive runs of word tokens. Clusters that
 * match nothing are counted by reason rather than silently lost.
 */
export function anchorVerseClusters(segment: Segment, clusters: ClusterData[]): VerseAnchorResult {
  const dropCounts = emptyClusterDrops();
  const wordClassified: Extract<ClassifiedCluster, { kind: 'word' }>[] = [];
  const parseClassified: Extract<ClassifiedCluster, { kind: 'wordParse' }>[] = [];
  const phraseClassified: Extract<ClassifiedCluster, { kind: 'phrase' }>[] = [];

  clusters.forEach((cluster) => {
    const classified = classifyCluster(cluster);
    if (classified.kind === 'drop') dropCounts[classified.reason] += 1;
    else if (classified.kind === 'word') wordClassified.push(classified);
    else if (classified.kind === 'wordParse') parseClassified.push(classified);
    else phraseClassified.push(classified);
  });

  // Pair word and parse clusters by exact range; a second cluster of the same kind at the same
  // range is corrupt by PT9's own selection rules, so only the first converts.
  const rangeGroups = new Map<string, RangeGroup>();
  const groupFor = (cluster: ClusterData): RangeGroup => {
    const rangeKey = `${cluster.TextRange.Index}-${cluster.TextRange.Length}`;
    let group = rangeGroups.get(rangeKey);
    if (group === undefined) {
      group = { index: cluster.TextRange.Index, length: cluster.TextRange.Length };
      rangeGroups.set(rangeKey, group);
    }
    return group;
  };
  wordClassified.forEach((classified) => {
    const group = groupFor(classified.cluster);
    if (group.word !== undefined) dropCounts.duplicateCluster += 1;
    else group.word = { classified };
  });
  parseClassified.forEach((classified) => {
    const group = groupFor(classified.cluster);
    if (group.parse !== undefined) dropCounts.duplicateCluster += 1;
    else group.parse = { classified };
  });

  const wordTokens = segment.tokens.filter((t) => t.type === 'word');
  const baselineLength = Math.max(1, segment.baselineText.length);
  const verseExtent = Math.max(1, ...clusters.map((c) => c.TextRange.Index + c.TextRange.Length));

  const groups: AnchoredTokenGroup[] = [];
  let ambiguousCount = 0;
  let cursor = 0;
  [...rangeGroups.values()]
    .sort((a, b) => a.index - b.index || a.length - b.length)
    .forEach((group) => {
      const { word, parse } = group;
      const facetCount = (word === undefined ? 0 : 1) + (parse === undefined ? 0 : 1);
      let expected: string;
      if (word !== undefined) expected = normalizeSurfaceForm(word.classified.lexeme.key.Form);
      else if (parse !== undefined)
        expected = normalizeSurfaceForm(parse.classified.lexemes.map((l) => l.key.Form).join(''));
      /* v8 ignore next 2 -- a range group is only ever created with at least one facet */
      else return;

      const candidates: number[] = [];
      for (let j = cursor; j < wordTokens.length; j += 1) {
        if (normalizeSurfaceForm(wordTokens[j].surfaceText) === expected) candidates.push(j);
      }
      if (candidates.length === 0) {
        dropCounts.formMismatch += facetCount;
        return;
      }
      const ambiguous = candidates.length > 1;
      const chosen = ambiguous
        ? pickByProportionalPrior(candidates, wordTokens, group.index, baselineLength, verseExtent)
        : candidates[0];
      if (ambiguous) ambiguousCount += 1;
      groups.push({
        token: wordTokens[chosen],
        ...(group.word !== undefined && {
          word: {
            lexeme: group.word.classified.lexeme,
            excluded: group.word.classified.cluster.Excluded,
          },
        }),
        ...(group.parse !== undefined && {
          parse: {
            lexemes: group.parse.classified.lexemes,
            excluded: group.parse.classified.cluster.Excluded,
          },
        }),
        ambiguous,
      });
      cursor = chosen + 1;
    });

  const phrases: AnchoredPhrase[] = [];
  let phraseCursor = 0;
  [...phraseClassified]
    .sort((a, b) => a.cluster.TextRange.Index - b.cluster.TextRange.Index)
    .forEach((classified) => {
      const words = normalizeSurfaceForm(classified.lexeme.key.Form)
        .split(' ')
        .filter((w) => w !== '');
      if (words.length === 0) {
        dropCounts.formMismatch += 1;
        return;
      }
      const starts: number[] = [];
      for (let s = phraseCursor; s + words.length <= wordTokens.length; s += 1) {
        if (words.every((w, i) => normalizeSurfaceForm(wordTokens[s + i].surfaceText) === w))
          starts.push(s);
      }
      if (starts.length === 0) {
        dropCounts.formMismatch += 1;
        return;
      }
      const ambiguous = starts.length > 1;
      const start = ambiguous
        ? pickByProportionalPrior(
            starts,
            wordTokens,
            classified.cluster.TextRange.Index,
            baselineLength,
            verseExtent,
          )
        : starts[0];
      if (ambiguous) ambiguousCount += 1;
      phrases.push({
        lexeme: classified.lexeme,
        excluded: classified.cluster.Excluded,
        tokens: wordTokens.slice(start, start + words.length),
        ambiguous,
      });
      phraseCursor = start + 1;
    });

  return { groups, phrases, dropCounts, ambiguousCount };
}
