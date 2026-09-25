import type { FrontMatterParagraph, Segment, Token } from 'interlinearizer';
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
  /** Position of the paragraph or segment holding the token, which no phrase may straddle. */
  block: number;
  /** Offset of the token in the laid-out verse. */
  offset: number;
  /** Whether the token lies in the book's front matter, which the text layer leaves out. */
  inFrontMatter: boolean;
}

/** Word tokens of one verse in document order, placed as PT9 indexes them. */
interface VerseLayout {
  words: PlacedWord[];
  /** Length of the laid-out verse. */
  length: number;
}

/**
 * The marker PT9's string for a verse opens on: the chapter's for the text ahead of its first
 * verse, the verse's own otherwise, and none for a verse with no segments.
 */
function scopeMarker(segments: readonly Segment[]): string {
  const scope = segments.at(0)?.startRef;
  if (scope === undefined) return '';
  if (scope.verse === 0) return `\\c ${scope.chapter} `;
  const verse = segments.find((segment) => !segment.heading);
  /* v8 ignore next -- a numbered verse always has a segment of its own text */
  return `\\v ${verse?.verseStarts[0].number ?? scope.verse} `;
}

/**
 * Lays a verse's word tokens out the way PT9 indexes its clusters: any front matter filed under the
 * verse, each paragraph behind its marker, then the verse text behind its chapter or verse marker,
 * with each heading at its place behind its own marker, spaced from any text or heading before it.
 * Paragraph and character markers inside the verse, and notes, are not reproduced, so the layout
 * approximates PT9's string rather than matching it.
 *
 * @param segments - The verse's own text, in one piece or split by the headings within it, and the
 *   headings filed under it, in document order.
 * @param frontMatter - The book's front matter when PT9 files it under this verse, else empty.
 */
function layOutVerse(
  segments: readonly Segment[],
  frontMatter: readonly FrontMatterParagraph[],
): VerseLayout {
  const words: PlacedWord[] = [];
  let frontLength = 0;
  frontMatter.forEach((paragraph, block) => {
    const start = frontLength + (block > 0 ? 1 : 0) + `\\${paragraph.marker} `.length;
    paragraph.tokens.forEach((token) => {
      if (token.type === 'word')
        words.push({ token, block, offset: start + token.charStart, inFrontMatter: true });
    });
    frontLength = start + paragraph.baselineText.length;
  });

  const prefix = frontLength + (frontLength > 0 ? 1 : 0) + scopeMarker(segments).length;
  const headings = segments.flatMap((segment, i) => {
    if (!segment.heading) return [];
    /* v8 ignore next -- a heading segment always carries its place in the verse */
    const charIndex = segment.startRef.charIndex ?? 0;
    const followsScopeMarker = charIndex === 0 && !segments.slice(0, i).some((s) => s.heading);
    const markerLength = `${followsScopeMarker ? '' : ' '}\\${segment.heading.marker} `.length;
    return [{ segment, block: frontMatter.length + i, charIndex, markerLength }];
  });

  let spliced = 0;
  headings.forEach(({ segment, block, charIndex, markerLength }) => {
    const start = prefix + charIndex + spliced + markerLength;
    segment.tokens.forEach((token) => {
      if (token.type === 'word')
        words.push({ token, block, offset: start + token.charStart, inFrontMatter: false });
    });
    spliced += markerLength + segment.baselineText.length;
  });
  let verseLength = 0;
  segments.forEach((piece, i) => {
    if (piece.heading) return;
    const pieceStart = piece.startRef.charIndex ?? 0;
    verseLength = pieceStart + piece.baselineText.length;
    piece.tokens.forEach((token) => {
      if (token.type !== 'word') return;
      const charStart = pieceStart + token.charStart;
      const splicedBefore = headings
        .filter(({ charIndex }) => charIndex <= charStart)
        .reduce(
          (sum, { segment, markerLength }) => sum + markerLength + segment.baselineText.length,
          0,
        );
      words.push({
        token,
        block: frontMatter.length + i,
        offset: prefix + charStart + splicedBefore,
        inFrontMatter: false,
      });
    });
  });
  words.sort((a, b) => a.offset - b.offset);
  return { words, length: Math.max(1, prefix + verseLength + spliced) };
}

type AlignMove = 'place' | 'skipPosition' | 'skipItem';

/**
 * Places as many items as an in-order matching allows, each at one of its own candidate positions,
 * with positions strictly increasing from item to item. Among the matchings placing the most items,
 * the one with the least total `cost` wins, ties going to the earliest placement.
 *
 * @returns Each item's position, or `undefined` for an item left unplaced.
 */
function alignInOrder(
  candidates: readonly ReadonlySet<number>[],
  positionCount: number,
  cost: (item: number, position: number) => number,
): (number | undefined)[] {
  const width = positionCount + 1;
  const cell = (item: number, position: number): number => item * width + position;
  const size = (candidates.length + 1) * width;
  const placedCounts = new Array<number>(size).fill(0);
  const totalCosts = new Array<number>(size).fill(0);
  const moves = new Array<AlignMove>(size).fill('skipItem');

  for (let item = candidates.length - 1; item >= 0; item -= 1) {
    for (let position = positionCount - 1; position >= 0; position -= 1) {
      const options: [AlignMove, number, number][] = [];
      if (candidates[item].has(position)) {
        const next = cell(item + 1, position + 1);
        options.push(['place', placedCounts[next] + 1, totalCosts[next] + cost(item, position)]);
      }
      const passPosition = cell(item, position + 1);
      options.push(['skipPosition', placedCounts[passPosition], totalCosts[passPosition]]);
      const passItem = cell(item + 1, position);
      options.push(['skipItem', placedCounts[passItem], totalCosts[passItem]]);
      const [move, placed, total] = options.reduce((best, option) =>
        option[1] > best[1] || (option[1] === best[1] && option[2] < best[2]) ? option : best,
      );
      const here = cell(item, position);
      moves[here] = move;
      placedCounts[here] = placed;
      totalCosts[here] = total;
    }
  }

  const placements = new Array<number | undefined>(candidates.length).fill(undefined);
  let item = 0;
  let position = 0;
  while (item < candidates.length && position < positionCount) {
    const move = moves[cell(item, position)];
    if (move === 'place') {
      placements[item] = position;
      item += 1;
      position += 1;
    } else if (move === 'skipPosition') position += 1;
    else item += 1;
  }
  return placements;
}

/**
 * How far a word sits, relative to the laid-out verse, from where a cluster's range falls relative
 * to the verse PT9 saved, which is what separates repeated surface forms. That verse's extent is
 * unknown, so each of the candidate `verseExtents` is tried and the closest fit counts. The layout
 * only approximates PT9's marker-bearing USFM, so only the proportion is meaningful, never the
 * absolute values themselves.
 */
function priorDistance(
  layout: VerseLayout,
  position: number,
  clusterIndex: number,
  verseExtents: readonly number[],
): number {
  const at = layout.words[position].offset / layout.length;
  return Math.min(...verseExtents.map((extent) => Math.abs(at - clusterIndex / extent)));
}

/** The folded surface a range group's word facet names, or else its parse's forms joined. */
function expectedForm({ word, parse }: RangeGroup): string {
  if (word !== undefined) return normalizeSurfaceForm(word.classified.lexeme.key.Form);
  /* v8 ignore next -- a range group is only ever created with at least one facet */
  if (parse === undefined) return '';
  return normalizeSurfaceForm(parse.classified.lexemes.map((l) => l.key.Form).join(''));
}

function countFrom(candidates: ReadonlySet<number>, cursor: number): number {
  return [...candidates].filter((candidate) => candidate >= cursor).length;
}

/** A word and parse cluster paired by their identical text range, the way PT9 pairs them. */
interface RangeGroup {
  index: number;
  length: number;
  word?: { classified: Extract<ClassifiedCluster, { kind: 'word' }> };
  parse?: { classified: Extract<ClassifiedCluster, { kind: 'wordParse' }> };
}

/**
 * Anchors one verse's clusters onto the word tokens of the segments PT9 files under that verse. A
 * cluster landing on the book's front matter, which the text layer leaves out, is counted as a
 * front-matter drop rather than converted.
 *
 * Lexeme forms are the ground truth: they are matched case- and normalization-folded, in order,
 * because PT9's stored offsets index a different string than the segments' baseline text and cannot
 * be applied to it. The range index therefore serves only as ordering and, among equal-folding
 * candidates, as a position prior. As many clusters anchor as that order allows, so a cluster over
 * text the layer leaves out, such as a footnote, cannot take a later token at the cost of the
 * clusters before that token. Word and parse clusters covering the identical range anchor together
 * onto one token, while phrases anchor to consecutive runs of word tokens within one segment.
 * Clusters that match nothing are counted by reason rather than silently lost.
 *
 * @param segments - The verse's own text, when it has any, and the headings within it, in document
 *   order.
 * @param clusters - Everything PT9 saved for the verse, of any cluster kind.
 * @param frontMatter - The book's front matter when the verse is chapter 1's verse 0, where PT9
 *   files it; else empty.
 */
export function anchorVerseClusters(
  segments: readonly Segment[],
  clusters: Pt9InterlinearCluster[],
  frontMatter: readonly FrontMatterParagraph[] = [],
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

  const layout = layOutVerse(segments, frontMatter);
  const wordTokens = layout.words.map((w) => w.token);
  const foldedWords = wordTokens.map((token) => normalizeSurfaceForm(token.surfaceText));
  // The saved verse spans the current layout when its text is unchanged, and only as far as its
  // clusters reach when PT9 kept ranges from a verse since lengthened.
  const clusterExtent = Math.max(1, ...clusters.map((c) => c.index + c.length));
  const verseExtents = [Math.max(layout.length, clusterExtent), clusterExtent];

  const sortedGroups = [...rangeGroups.values()].sort(
    (a, b) => a.index - b.index || a.length - b.length,
  );
  const groupCandidates = sortedGroups.map((group) => {
    const expected = expectedForm(group);
    return new Set(foldedWords.flatMap((form, j) => (form === expected ? [j] : [])));
  });
  const groupPlacements = alignInOrder(groupCandidates, wordTokens.length, (item, position) =>
    priorDistance(layout, position, sortedGroups[item].index, verseExtents),
  );

  const groups: AnchoredTokenGroup[] = [];
  let ambiguousCount = 0;
  let cursor = 0;
  sortedGroups.forEach((group, item) => {
    const { word, parse } = group;
    const chosen = groupPlacements[item];
    const facetCount = [word, parse].filter((facet) => facet !== undefined).length;
    if (chosen === undefined) {
      dropCounts.formMismatch += facetCount;
      return;
    }
    const ambiguous = countFrom(groupCandidates[item], cursor) > 1;
    cursor = chosen + 1;
    if (layout.words[chosen].inFrontMatter) {
      dropCounts.frontMatter += facetCount;
      return;
    }
    if (ambiguous) ambiguousCount += 1;
    groups.push({
      token: wordTokens[chosen],
      ...(word !== undefined && {
        word: { lexeme: word.classified.lexeme, excluded: word.classified.cluster.excluded },
      }),
      ...(parse !== undefined && {
        parse: { lexemes: parse.classified.lexemes, excluded: parse.classified.cluster.excluded },
      }),
      ambiguous,
    });
  });

  const sortedPhrases = [...phraseClassified].sort((a, b) => a.cluster.index - b.cluster.index);
  const phraseWords = sortedPhrases.map((classified) =>
    normalizeSurfaceForm(classified.lexeme.key.Form)
      .split(' ')
      .filter((w) => w !== ''),
  );
  const phraseCandidates = phraseWords.map((words) => {
    const starts = new Set<number>();
    if (words.length === 0) return starts;
    for (let s = 0; s + words.length <= wordTokens.length; s += 1) {
      const { block } = layout.words[s];
      if (words.every((w, i) => layout.words[s + i].block === block && foldedWords[s + i] === w))
        starts.add(s);
    }
    return starts;
  });
  const phrasePlacements = alignInOrder(phraseCandidates, wordTokens.length, (item, position) =>
    priorDistance(layout, position, sortedPhrases[item].cluster.index, verseExtents),
  );

  const phrases: AnchoredPhrase[] = [];
  let phraseCursor = 0;
  sortedPhrases.forEach((classified, item) => {
    const start = phrasePlacements[item];
    if (start === undefined) {
      dropCounts.formMismatch += 1;
      return;
    }
    const ambiguous = countFrom(phraseCandidates[item], phraseCursor) > 1;
    phraseCursor = start + 1;
    if (layout.words[start].inFrontMatter) {
      dropCounts.frontMatter += 1;
      return;
    }
    if (ambiguous) ambiguousCount += 1;
    phrases.push({
      lexeme: classified.lexeme,
      excluded: classified.cluster.excluded,
      tokens: wordTokens.slice(start, start + phraseWords[item].length),
      ambiguous,
    });
  });

  return { groups, phrases, dropCounts, ambiguousCount };
}
