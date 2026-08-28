import type { Pt9InterlinearCluster } from 'platform-scripture';

/** Builds a cluster literal the way the platform serves one. */
export function mkCluster(
  index: number,
  length: number,
  lexemes: [id: string | undefined, senseId?: string][],
  excluded = false,
): Pt9InterlinearCluster {
  return {
    index,
    length,
    excluded,
    lexemes: lexemes.map(([lexemeId, senseId]) => ({
      ...(lexemeId !== undefined && { lexemeId }),
      ...(senseId !== undefined && { senseId }),
    })),
  };
}
