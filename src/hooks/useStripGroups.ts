import type { PhraseAnalysisLink, Segment, Token } from 'interlinearizer';
import { useMemo, useState } from 'react';
import type { TokenGroup } from '../types/token-layout';
import { groupTokens } from '../utils/token-layout';

/** The continuous strip's phrase groups, numbered so a group keeps its index while it is held. */
export interface StripGroups {
  /** Every token of the segments, in book order. */
  tokens: readonly Token[];
  /** The phrase groups of the segments, in book order. */
  groups: readonly TokenGroup[];
  /** Index of `groups[0]`. */
  first: number;
  /** Word token ref → index of the group holding it. */
  indexByTokenRef: ReadonlyMap<string, number>;
  /** The group at `index`, if held. */
  at: (index: number) => TokenGroup | undefined;
  /** Where in {@link StripGroups.tokens} the first token of the group at `index` sits. */
  tokenIndexOf: (index: number) => number;
}

/** Groups last numbered, kept to number the next ones against. */
type Numbered = Readonly<{
  groups: readonly TokenGroup[];
  first: number;
  localIndexByTokenRef: ReadonlyMap<string, number>;
}>;

/**
 * Index the first of `groups` takes, so groups `prev` held keep their indexes and groups sharing no
 * token with it take indexes it never used.
 */
function firstIndexOf(groups: readonly TokenGroup[], prev: Numbered | undefined): number {
  if (!prev) return 0;
  if (prev.groups === groups) return prev.first;
  for (let local = 0; local < groups.length; local += 1) {
    const prevLocal = prev.localIndexByTokenRef.get(groups[local].tokens[0].ref);
    if (prevLocal !== undefined) return prev.first + prevLocal - local;
  }
  return prev.first + prev.groups.length + 1;
}

/**
 * Flattens and groups the strip's segments, numbering groups so a change of the segments held
 * around them does not renumber them, and a segment held across the change keeps its group
 * objects.
 */
export default function useStripGroups(
  segments: readonly Segment[],
  phraseLinkByRef: Map<string, PhraseAnalysisLink>,
): StripGroups {
  const groupsBySegment = useMemo(
    () => new WeakMap<Segment, TokenGroup[]>(),
    // Emptied whenever the phrase links change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phraseLinkByRef],
  );

  const flat = useMemo(() => {
    const tokens: Token[] = [];
    const groups: TokenGroup[] = [];
    const tokenStarts: number[] = [];
    segments.forEach((segment) => {
      // No phrase spans two segments, so each groups alone.
      let segmentGroups = groupsBySegment.get(segment);
      if (!segmentGroups) {
        segmentGroups = groupTokens(segment.tokens, phraseLinkByRef);
        groupsBySegment.set(segment, segmentGroups);
      }
      segmentGroups.forEach((group) => {
        groups.push(group);
        tokenStarts.push(tokens.length + group.firstIndex);
      });
      tokens.push(...segment.tokens);
    });
    const localIndexByTokenRef = new Map<string, number>();
    groups.forEach((group, local) =>
      group.tokens.forEach((token) => localIndexByTokenRef.set(token.ref, local)),
    );
    return { tokens, groups, tokenStarts, localIndexByTokenRef };
  }, [segments, groupsBySegment, phraseLinkByRef]);

  const [numbered, setNumbered] = useState<Numbered>();
  const first = firstIndexOf(flat.groups, numbered);
  if (numbered?.groups !== flat.groups) {
    setNumbered({
      groups: flat.groups,
      first,
      localIndexByTokenRef: flat.localIndexByTokenRef,
    });
  }

  return useMemo(() => {
    const indexByTokenRef = new Map<string, number>();
    flat.localIndexByTokenRef.forEach((local, ref) => indexByTokenRef.set(ref, first + local));
    return {
      tokens: flat.tokens,
      groups: flat.groups,
      first,
      indexByTokenRef,
      at: (index: number) => flat.groups[index - first],
      tokenIndexOf: (index: number) => flat.tokenStarts[index - first] ?? flat.tokens.length,
    };
  }, [flat, first]);
}
