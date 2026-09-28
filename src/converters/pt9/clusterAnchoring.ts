import type { Segment, Token } from 'interlinearizer';
import type { Pt9InterlinearCluster } from 'platform-scripture';
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
 * makes those kinds; everything else (Lemma clusters, empty clusters, unknown types) is dropped, as
 * is any cluster carrying an unparseable lexeme id.
 */
export type ClassifiedCluster =
  | { kind: 'word'; cluster: Pt9InterlinearCluster; lexeme: ClassifiedLexeme }
  | { kind: 'wordParse'; cluster: Pt9InterlinearCluster; lexemes: ClassifiedLexeme[] }
  | { kind: 'phrase'; cluster: Pt9InterlinearCluster; lexeme: ClassifiedLexeme }
  | {
      kind: 'drop';
      cluster: Pt9InterlinearCluster;
      reason: 'lemmaOrOther' | 'unparseableLexemeId';
    };

/** Lexeme types whose presence makes a cluster a word parse in PT9's derivation. */
const PARSE_TYPES = new Set(['Stem', 'Suffix', 'Prefix']);

/**
 * Classifies one cluster by its lexeme-id prefixes (PT9 persists no cluster type; only the lexeme
 * ids carry it).
 */
export function classifyCluster(cluster: Pt9InterlinearCluster): ClassifiedCluster {
  const lexemes = cluster.lexemes.flatMap((lexeme): ClassifiedLexeme[] => {
    const key = lexeme.lexemeId === undefined ? undefined : parseLexemeKeyId(lexeme.lexemeId);
    if (key === undefined) return [];
    return [{ key, ...(lexeme.senseId !== undefined && { senseId: lexeme.senseId }) }];
  });
  if (lexemes.length !== cluster.lexemes.length)
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

/** A word token placed in the layout PT9 indexes a verse's clusters against. */
interface PlacedWord {
  token: Token;
  segmentId: string;
  /** Offset of the token in the laid-out verse. */
  offset: number;
}

/** Word tokens of one verse in document order, placed as PT9 indexes them. */
interface VerseLayout {
  words: PlacedWord[];
  /** Length of the laid-out verse. */
  length: number;
}

/**
 * Lays a verse's word tokens out the way PT9 indexes its clusters: the verse text behind its verse
 * marker, with each heading at its place behind a line break and its own marker. Paragraph and
 * character markers inside the verse, and notes, are not reproduced, so the layout approximates
 * PT9's string rather than matching it.
 *
 * @param segments - The verse's own segment, if it has one, and the headings filed under it, in
 *   document order.
 */
function layOutVerse(segments: readonly Segment[]): VerseLayout {
  const verse = segments.find((segment) => !segment.heading);
  // Verse 0 is the text ahead of a chapter's first verse marker, so it has no marker of its own.
  const prefix =
    verse === undefined || verse.startRef.verse === 0
      ? 0
      : `\\v ${verse.verseStarts[0].number} `.length;
  const headings = segments.flatMap((segment) => {
    if (!segment.heading) return [];
    /* v8 ignore next -- a heading segment always carries its place in the verse */
    const charIndex = segment.startRef.charIndex ?? 0;
    return [{ segment, charIndex, markerLength: `\n\\${segment.heading.marker} `.length }];
  });

  const words: PlacedWord[] = [];
  let spliced = 0;
  headings.forEach(({ segment, charIndex, markerLength }) => {
    const start = prefix + charIndex + spliced + markerLength;
    segment.tokens.forEach((token) => {
      if (token.type === 'word')
        words.push({ token, segmentId: segment.id, offset: start + token.charStart });
    });
    spliced += markerLength + segment.baselineText.length;
  });
  verse?.tokens.forEach((token) => {
    if (token.type !== 'word') return;
    const splicedBefore = headings
      .filter(({ charIndex }) => charIndex <= token.charStart)
      .reduce(
        (sum, { segment, markerLength }) => sum + markerLength + segment.baselineText.length,
        0,
      );
    words.push({ token, segmentId: verse.id, offset: prefix + token.charStart + splicedBefore });
  });
  words.sort((a, b) => a.offset - b.offset);
  return { words, length: Math.max(1, prefix + (verse?.baselineText.length ?? 0) + spliced) };
}

/**
 * Picks the candidate whose relative position in the laid-out verse best matches the cluster's
 * relative range position, which is what separates repeated surface forms. The layout only
 * approximates PT9's marker-bearing USFM, so only the proportion is meaningful, never the absolute
 * values themselves.
 */
function pickByProportionalPrior(
  candidates: number[],
  layout: VerseLayout,
  clusterIndex: number,
  verseExtent: number,
): number {
  const target = clusterIndex / verseExtent;
  let best = candidates[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate) => {
    const distance = Math.abs(layout.words[candidate].offset / layout.length - target);
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
 * Anchors one verse's clusters onto the word tokens of the segments PT9 files under that verse: its
 * own text and the headings within it.
 *
 * Lexeme forms are the ground truth: they are matched case- and normalization-folded, in order,
 * because PT9's stored offsets index a different string than the segments' baseline text and cannot
 * be applied to it. The range index therefore serves only as ordering and, among equal-folding
 * candidates, as a position prior. Word and parse clusters covering the identical range anchor
 * together onto one token, while phrases anchor to consecutive runs of word tokens within one
 * segment. Clusters that match nothing are counted by reason rather than silently lost.
 *
 * @param segments - The verse's own segment, if it has one, and the headings filed under it, in
 *   document order.
 */
export function anchorVerseClusters(
  segments: readonly Segment[],
  clusters: Pt9InterlinearCluster[],
): VerseAnchorResult {
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
  const groupFor = (cluster: Pt9InterlinearCluster): RangeGroup => {
    const rangeKey = `${cluster.index}-${cluster.length}`;
    let group = rangeGroups.get(rangeKey);
    if (group === undefined) {
      group = { index: cluster.index, length: cluster.length };
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

  const layout = layOutVerse(segments);
  const wordTokens = layout.words.map((w) => w.token);
  const verseExtent = Math.max(1, ...clusters.map((c) => c.index + c.length));

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
        ? pickByProportionalPrior(candidates, layout, group.index, verseExtent)
        : candidates[0];
      if (ambiguous) ambiguousCount += 1;
      groups.push({
        token: wordTokens[chosen],
        ...(group.word !== undefined && {
          word: {
            lexeme: group.word.classified.lexeme,
            excluded: group.word.classified.cluster.excluded,
          },
        }),
        ...(group.parse !== undefined && {
          parse: {
            lexemes: group.parse.classified.lexemes,
            excluded: group.parse.classified.cluster.excluded,
          },
        }),
        ambiguous,
      });
      cursor = chosen + 1;
    });

  const phrases: AnchoredPhrase[] = [];
  let phraseCursor = 0;
  [...phraseClassified]
    .sort((a, b) => a.cluster.index - b.cluster.index)
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
        const { segmentId } = layout.words[s];
        if (
          words.every(
            (w, i) =>
              layout.words[s + i].segmentId === segmentId &&
              normalizeSurfaceForm(wordTokens[s + i].surfaceText) === w,
          )
        )
          starts.push(s);
      }
      if (starts.length === 0) {
        dropCounts.formMismatch += 1;
        return;
      }
      const ambiguous = starts.length > 1;
      const start = ambiguous
        ? pickByProportionalPrior(starts, layout, classified.cluster.index, verseExtent)
        : starts[0];
      if (ambiguous) ambiguousCount += 1;
      phrases.push({
        lexeme: classified.lexeme,
        excluded: classified.cluster.excluded,
        tokens: wordTokens.slice(start, start + words.length),
        ambiguous,
      });
      phraseCursor = start + 1;
    });

  return { groups, phrases, dropCounts, ambiguousCount };
}
