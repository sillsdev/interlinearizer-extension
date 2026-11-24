import type { DraftProject } from 'interlinearizer';
import type { ChangeSet, RecordChanges, ScopeRecord } from '../types/analysis-repository';

/**
 * A draft with a {@link ChangeSet} applied, the change set that restores what it replaced, and what
 * the changes changed, as an apply reports it.
 */
export type AppliedChanges = {
  draft: DraftProject;
  inverse: ChangeSet;
  applied: ChangeSet;
};

/** Each record that a kind's changes put, and each that the changes' inverse restores. */
export function touched<T>(
  changes: RecordChanges<T> | undefined,
  inverse: RecordChanges<T> | undefined,
): T[] {
  return [...(changes?.puts ?? []), ...(inverse?.puts ?? [])];
}

/** Whether `changes` change no record, the scope's record included. */
export function isEmptyChangeSet(changes: ChangeSet): boolean {
  return Object.keys(changes).every((key) => key === 'intent');
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
 *   when the changes replaced nothing and added nothing. Also the changes less each delete of a
 *   record not stored, absent when that leaves none.
 * @throws {Error} If an id appears more than once in the changes.
 */
function applyRecordChanges<T extends { id: string }>(
  records: T[],
  changes: RecordChanges<T> | undefined,
  kind: string,
): { records: T[]; inverse?: RecordChanges<T>; applied?: RecordChanges<T> } {
  if (!changes) return { records };
  const named = new Set<string>();
  [...changes.puts.map(({ id }) => id), ...changes.deletes].forEach((id) => {
    if (named.has(id)) {
      throw new Error(`Interlinearizer: a change set names ${kind} record ${id} more than once`);
    }
    named.add(id);
  });

  const puts = new Map(changes.puts.map((record) => [record.id, record]));
  // Holds only the records the changes name, so a long record list is walked once and never mapped
  // whole.
  const stored = new Map<string, T>();
  // A replaced record keeps its place, so records nearby are left as they were.
  const next: T[] = [];
  records.forEach((record) => {
    if (!named.has(record.id)) {
      next.push(record);
      return;
    }
    stored.set(record.id, record);
    const put = puts.get(record.id);
    if (put) next.push(put);
  });

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
  puts.forEach((record, id) => {
    if (!stored.has(id)) next.push(record);
  });
  const applied: RecordChanges<T> = {
    puts: changes.puts,
    deletes: changes.deletes.filter((id) => stored.has(id)),
  };
  return {
    records: next,
    ...((inverse.puts.length > 0 || inverse.deletes.length > 0) && { inverse }),
    ...((applied.puts.length > 0 || applied.deletes.length > 0) && { applied }),
  };
}

/**
 * `changes` to one link kind, with a delete added for each of `links` that names one of
 * `deletedAnalyses` and that `changes` leave alone.
 */
function withCascade<T extends { id: string; analysisId: string }>(
  links: T[],
  changes: RecordChanges<T> | undefined,
  deletedAnalyses: RecordChanges<{ id: string }> | undefined,
): RecordChanges<T> | undefined {
  if (!deletedAnalyses || deletedAnalyses.deletes.length === 0) return changes;
  const deleted = new Set(deletedAnalyses.deletes);
  const named = new Set([
    ...(changes?.puts ?? []).map(({ id }) => id),
    ...(changes?.deletes ?? []),
  ]);
  const taken = links
    .filter(({ id, analysisId }) => deleted.has(analysisId) && !named.has(id))
    .map(({ id }) => id);
  if (taken.length === 0) return changes;
  return { puts: changes?.puts ?? [], deletes: [...(changes?.deletes ?? []), ...taken] };
}

/**
 * Applies `changes` to `draft`, leaving `draft` as it was. Deleting an analysis also deletes each
 * link that names it and that `changes` leave alone; the inverse restores such links. The result is
 * marked unsaved. It shares the put records and any scope record with `changes`, and everything
 * else with `draft`, including the records the inverse restores.
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
  const tokenAnalyses = applyRecordChanges(
    analysis.tokenAnalyses,
    changes.tokenAnalyses,
    'token analysis',
  );
  const phraseAnalyses = applyRecordChanges(
    analysis.phraseAnalyses,
    changes.phraseAnalyses,
    'phrase analysis',
  );
  const segmentAnalysisLinks = applyRecordChanges(
    analysis.segmentAnalysisLinks,
    withCascade(
      analysis.segmentAnalysisLinks,
      changes.segmentAnalysisLinks,
      segmentAnalyses.applied,
    ),
    'segment analysis link',
  );
  const tokenAnalysisLinks = applyRecordChanges(
    analysis.tokenAnalysisLinks,
    withCascade(analysis.tokenAnalysisLinks, changes.tokenAnalysisLinks, tokenAnalyses.applied),
    'token analysis link',
  );
  const phraseAnalysisLinks = applyRecordChanges(
    analysis.phraseAnalysisLinks,
    withCascade(analysis.phraseAnalysisLinks, changes.phraseAnalysisLinks, phraseAnalyses.applied),
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
  const applied: ChangeSet = {
    intent: changes.intent,
    ...(changes.scope && { scope: changes.scope }),
    ...(segmentAnalyses.applied && { segmentAnalyses: segmentAnalyses.applied }),
    ...(segmentAnalysisLinks.applied && { segmentAnalysisLinks: segmentAnalysisLinks.applied }),
    ...(tokenAnalyses.applied && { tokenAnalyses: tokenAnalyses.applied }),
    ...(tokenAnalysisLinks.applied && { tokenAnalysisLinks: tokenAnalysisLinks.applied }),
    ...(phraseAnalyses.applied && { phraseAnalyses: phraseAnalyses.applied }),
    ...(phraseAnalysisLinks.applied && { phraseAnalysisLinks: phraseAnalysisLinks.applied }),
  };
  return {
    draft: {
      ...(changes.scope ?? scopeRecordOf(draft)),
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
    applied,
  };
}

/** One record kind's `first` then `then`, as one; `then` wins wherever both name a record. */
function mergeRecordChanges<T extends { id: string }>(
  first: RecordChanges<T> | undefined,
  then: RecordChanges<T> | undefined,
): RecordChanges<T> | undefined {
  if (!first || !then) return first ?? then;
  const named = new Set([...then.puts.map(({ id }) => id), ...then.deletes]);
  return {
    puts: [...first.puts.filter(({ id }) => !named.has(id)), ...then.puts],
    deletes: [...first.deletes.filter((id) => !named.has(id)), ...then.deletes],
  };
}

/**
 * Throws if `then` puts an analysis that `first` deletes, because merged changes would keep the
 * links that the delete takes with it.
 */
function assertNoAnalysisRestored(
  first: RecordChanges<{ id: string }> | undefined,
  then: RecordChanges<{ id: string }> | undefined,
  kind: string,
): void {
  if (!first || !then) return;
  const deleted = new Set(first.deletes);
  const restored = then.puts.find(({ id }) => deleted.has(id));
  if (restored) {
    throw new Error(
      `Interlinearizer: cannot merge change sets that delete and then put ${kind} ${restored.id}`,
    );
  }
}

/**
 * Changes that apply as `first` and then `then` do, named by `first`'s intent. Where both name a
 * record, or both carry the scope's record, `then`'s stands.
 *
 * @throws {Error} If `then` puts an analysis that `first` deletes.
 */
export function mergeChangeSets(first: ChangeSet, then: ChangeSet): ChangeSet {
  assertNoAnalysisRestored(first.segmentAnalyses, then.segmentAnalyses, 'segment analysis');
  assertNoAnalysisRestored(first.tokenAnalyses, then.tokenAnalyses, 'token analysis');
  assertNoAnalysisRestored(first.phraseAnalyses, then.phraseAnalyses, 'phrase analysis');
  const scope = then.scope ?? first.scope;
  const segmentAnalyses = mergeRecordChanges(first.segmentAnalyses, then.segmentAnalyses);
  const segmentAnalysisLinks = mergeRecordChanges(
    first.segmentAnalysisLinks,
    then.segmentAnalysisLinks,
  );
  const tokenAnalyses = mergeRecordChanges(first.tokenAnalyses, then.tokenAnalyses);
  const tokenAnalysisLinks = mergeRecordChanges(first.tokenAnalysisLinks, then.tokenAnalysisLinks);
  const phraseAnalyses = mergeRecordChanges(first.phraseAnalyses, then.phraseAnalyses);
  const phraseAnalysisLinks = mergeRecordChanges(
    first.phraseAnalysisLinks,
    then.phraseAnalysisLinks,
  );
  return {
    intent: first.intent,
    ...(scope && { scope }),
    ...(segmentAnalyses && { segmentAnalyses }),
    ...(segmentAnalysisLinks && { segmentAnalysisLinks }),
    ...(tokenAnalyses && { tokenAnalyses }),
    ...(tokenAnalysisLinks && { tokenAnalysisLinks }),
    ...(phraseAnalyses && { phraseAnalyses }),
    ...(phraseAnalysisLinks && { phraseAnalysisLinks }),
  };
}
