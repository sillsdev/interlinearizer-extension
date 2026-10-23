import type { DraftProject } from 'interlinearizer';
import type { ChangeSet, RecordChanges, ScopeRecord } from '../types/analysis-repository';

/** A draft with a {@link ChangeSet} applied, and the change set that restores what it replaced. */
export type AppliedChanges = {
  draft: DraftProject;
  inverse: ChangeSet;
};

/** A copy of a JSON-plain value that shares nothing with it. */
function copyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** The draft's record, without its analysis or its `dirty` flag. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to leave them out
export function scopeRecordOf({ analysis, dirty, ...scope }: DraftProject): ScopeRecord {
  return scope;
}

/**
 * Applies one record kind's changes to `records`.
 *
 * @returns The records the changes leave, and the changes that restore what they replaced, absent
 *   when the changes replaced nothing and added nothing.
 * @throws {Error} If an id appears more than once in the changes.
 */
function applyRecordChanges<T extends { id: string }>(
  records: T[],
  changes: RecordChanges<T> | undefined,
  kind: string,
): { records: T[]; inverse?: RecordChanges<T> } {
  if (!changes) return { records };
  const named = new Set<string>();
  [...changes.puts.map(({ id }) => id), ...changes.deletes].forEach((id) => {
    if (named.has(id)) {
      throw new Error(`Interlinearizer: a change set names ${kind} record ${id} more than once`);
    }
    named.add(id);
  });

  const stored = new Map(records.map((record) => [record.id, record]));
  const deleted = new Set(changes.deletes);
  const puts = new Map(changes.puts.map((record) => [record.id, copyOf(record)]));
  const inverse: RecordChanges<T> = { puts: [], deletes: [] };
  changes.puts.forEach(({ id }) => {
    const prior = stored.get(id);
    if (prior) inverse.puts.push(prior);
    else inverse.deletes.push(id);
  });
  changes.deletes.forEach((id) => {
    const prior = stored.get(id);
    if (prior) inverse.puts.push(prior);
  });

  // A replaced record keeps its place, so records nearby are left as they were.
  const next = records.flatMap((record) => {
    if (deleted.has(record.id)) return [];
    return [puts.get(record.id) ?? record];
  });
  puts.forEach((record, id) => {
    if (!stored.has(id)) next.push(record);
  });
  return {
    records: next,
    ...((inverse.puts.length > 0 || inverse.deletes.length > 0) && { inverse }),
  };
}

/**
 * Applies `changes` to `draft`, leaving `draft` as it was. The result is marked unsaved. It holds
 * copies of the records the changes put, and shares everything else with `draft`, the records the
 * inverse restores included.
 *
 * @throws {Error} If an id appears more than once in one record kind's changes, or the scope's
 *   record names another source project.
 */
export function applyChangeSet(draft: DraftProject, changes: ChangeSet): AppliedChanges {
  if (changes.scope && changes.scope.sourceProjectId !== draft.sourceProjectId) {
    throw new Error(
      `Interlinearizer: a change set for source project ${changes.scope.sourceProjectId} cannot apply to the draft of ${draft.sourceProjectId}`,
    );
  }
  const { analysis } = draft;
  const segmentAnalyses = applyRecordChanges(
    analysis.segmentAnalyses,
    changes.segmentAnalyses,
    'segment analysis',
  );
  const segmentAnalysisLinks = applyRecordChanges(
    analysis.segmentAnalysisLinks,
    changes.segmentAnalysisLinks,
    'segment analysis link',
  );
  const tokenAnalyses = applyRecordChanges(
    analysis.tokenAnalyses,
    changes.tokenAnalyses,
    'token analysis',
  );
  const tokenAnalysisLinks = applyRecordChanges(
    analysis.tokenAnalysisLinks,
    changes.tokenAnalysisLinks,
    'token analysis link',
  );
  const phraseAnalyses = applyRecordChanges(
    analysis.phraseAnalyses,
    changes.phraseAnalyses,
    'phrase analysis',
  );
  const phraseAnalysisLinks = applyRecordChanges(
    analysis.phraseAnalysisLinks,
    changes.phraseAnalysisLinks,
    'phrase analysis link',
  );

  const inverse: ChangeSet = {
    intent: changes.intent,
    ...(changes.scope && { scope: scopeRecordOf(draft) }),
    ...(segmentAnalyses.inverse && { segmentAnalyses: segmentAnalyses.inverse }),
    ...(segmentAnalysisLinks.inverse && { segmentAnalysisLinks: segmentAnalysisLinks.inverse }),
    ...(tokenAnalyses.inverse && { tokenAnalyses: tokenAnalyses.inverse }),
    ...(tokenAnalysisLinks.inverse && { tokenAnalysisLinks: tokenAnalysisLinks.inverse }),
    ...(phraseAnalyses.inverse && { phraseAnalyses: phraseAnalyses.inverse }),
    ...(phraseAnalysisLinks.inverse && { phraseAnalysisLinks: phraseAnalysisLinks.inverse }),
  };
  return {
    draft: {
      ...(changes.scope ? copyOf(changes.scope) : scopeRecordOf(draft)),
      dirty: true,
      analysis: {
        segmentAnalyses: segmentAnalyses.records,
        segmentAnalysisLinks: segmentAnalysisLinks.records,
        tokenAnalyses: tokenAnalyses.records,
        tokenAnalysisLinks: tokenAnalysisLinks.records,
        phraseAnalyses: phraseAnalyses.records,
        phraseAnalysisLinks: phraseAnalysisLinks.records,
      },
    },
    inverse,
  };
}
