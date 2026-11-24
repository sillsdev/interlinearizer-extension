import type { DraftProject, TextAnalysis } from 'interlinearizer';
import type {
  AppliedChangeSet,
  AppliedRecords,
  ChangeSet,
  RecordChanges,
  RecordUpdate,
  ScopeRecord,
} from '../types/analysis-repository';
import { deepEqual } from './analysis-identity';

/** A draft with a {@link ChangeSet} applied, and what the changes changed, as an apply reports it. */
export type AppliedChanges = {
  draft: DraftProject;
  applied: AppliedChangeSet;
};

/** The fields of each record kind that an update writes key by key rather than whole. */
const KEYED_FIELDS: { [Kind in keyof TextAnalysis]: readonly string[] } = {
  segmentAnalyses: ['freeTranslation', 'literalTranslation'],
  segmentAnalysisLinks: [],
  tokenAnalyses: ['gloss', 'features'],
  tokenAnalysisLinks: [],
  phraseAnalyses: ['gloss'],
  phraseAnalysisLinks: [],
};

/**
 * Each record that a kind's applied changes left stored, and each that `inverse` would store again
 * as it was before them.
 */
export function touched<T>(
  applied: AppliedRecords<T> | undefined,
  inverse: RecordChanges<T> | undefined,
): T[] {
  return [
    ...(applied?.puts ?? []),
    ...(inverse?.creates ?? []),
    ...(inverse?.updates ?? []).map(({ after }) => after),
  ];
}

/** Whether `changes` change no record, the scope's record included. */
export function isEmptyChangeSet(changes: ChangeSet | AppliedChangeSet): boolean {
  return Object.keys(changes).every((key) => key === 'intent');
}

/**
 * The keys of `stored` with each key whose value differs between `before` and `after` set as
 * `after` holds it, or removed where `after` lacks it.
 */
function patchedKeys(stored: unknown, before: unknown, after: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(isObject(stored) ? stored : {}) };
  const beforeKeys = isObject(before) ? before : {};
  const afterKeys = isObject(after) ? after : {};
  new Set([...Object.keys(beforeKeys), ...Object.keys(afterKeys)]).forEach((key) => {
    const now = Object.hasOwn(afterKeys, key) ? afterKeys[key] : undefined;
    if ((Object.hasOwn(beforeKeys, key) ? beforeKeys[key] : undefined) === now) return;
    // Defined rather than assigned, so that a key such as `__proto__` stays an own key.
    if (Object.hasOwn(afterKeys, key))
      Object.defineProperty(result, key, {
        value: now,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else delete result[key];
  });
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && !!value && !Array.isArray(value);
}

/**
 * `stored` with each field that differs between `before` and `after` written as `after` holds it. A
 * field named in `keyed` is written key by key. A field that `after` lacks is removed, and so is a
 * keyed field left with no keys that `after` lacks.
 */
export function patchRecord<T extends object>(
  stored: T,
  { before, after }: RecordUpdate<T>,
  keyed: readonly string[] = [],
): T {
  const result = { ...stored };
  new Set([...Object.keys(before), ...Object.keys(after)]).forEach((field) => {
    const was: unknown = Reflect.get(before, field);
    const now: unknown = Reflect.get(after, field);
    if (deepEqual(was, now)) return;
    if (keyed.includes(field)) {
      const keys = patchedKeys(Reflect.get(stored, field), was, now);
      if (now === undefined && Object.keys(keys).length === 0)
        Reflect.deleteProperty(result, field);
      else Reflect.set(result, field, keys);
    } else if (now === undefined) Reflect.deleteProperty(result, field);
    else Reflect.set(result, field, now);
  });
  return result;
}

/** Every id that one record kind's changes name. */
function idsOf<T extends { id: string }>(changes: RecordChanges<T>): string[] {
  return [
    ...changes.creates.map(({ id }) => id),
    ...changes.updates.map(({ after }) => after.id),
    ...changes.deletes.map(({ id }) => id),
  ];
}

/** The draft's record, without its analysis or its `dirty` flag. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only to leave them out
export function scopeRecordOf({ analysis, dirty, ...scope }: DraftProject): ScopeRecord {
  return scope;
}

/**
 * Applies one record kind's changes to `records`.
 *
 * @returns The records the changes leave, and what the changes changed, absent when they changed
 *   nothing.
 * @throws {Error} If an id appears more than once in the changes, an update's `before` and `after`
 *   name different ids, or a create names a stored record's id.
 */
function applyRecordChanges<T extends { id: string }>(
  records: T[],
  changes: RecordChanges<T> | undefined,
  kind: string,
  keyed: readonly string[],
): { records: T[]; applied?: AppliedRecords<T> } {
  if (!changes) return { records };
  const named = new Set<string>();
  idsOf(changes).forEach((id) => {
    if (named.has(id)) {
      throw new Error(`Interlinearizer: a change set names ${kind} record ${id} more than once`);
    }
    named.add(id);
  });
  changes.updates.forEach(({ before, after }) => {
    if (before.id !== after.id) {
      throw new Error(
        `Interlinearizer: an update of ${kind} record ${after.id} reads as record ${before.id}`,
      );
    }
  });

  // Holds only the records the changes name, so a long record list is walked once and never mapped
  // whole.
  const stored = new Map<string, T>();
  records.forEach((record) => {
    if (named.has(record.id)) stored.set(record.id, record);
  });
  const created = changes.creates.find(({ id }) => stored.has(id));
  if (created) {
    throw new Error(
      `Interlinearizer: a change set creates ${kind} record ${created.id}, which is stored`,
    );
  }

  const replaced = new Map<string, T>();
  changes.updates.forEach((update) => {
    const prior = stored.get(update.after.id);
    if (!prior) return;
    const patched = patchRecord(prior, update, keyed);
    if (!deepEqual(patched, prior)) replaced.set(prior.id, patched);
  });
  const deleted = new Set(changes.deletes.map(({ id }) => id).filter((id) => stored.has(id)));
  // A replaced record keeps its place, so records nearby are left as they were.
  const next: T[] = [];
  records.forEach((record) => {
    if (deleted.has(record.id)) return;
    next.push(replaced.get(record.id) ?? record);
  });
  changes.creates.forEach((record) => next.push(record));

  const applied: AppliedRecords<T> = {
    puts: [...replaced.values(), ...changes.creates],
    deletes: [...deleted],
  };
  return {
    records: next,
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
  deletedAnalyses: AppliedRecords<{ id: string }> | undefined,
): RecordChanges<T> | undefined {
  if (!deletedAnalyses || deletedAnalyses.deletes.length === 0) return changes;
  const deleted = new Set(deletedAnalyses.deletes);
  const named = new Set(changes ? idsOf(changes) : []);
  const taken = links.filter(({ id, analysisId }) => deleted.has(analysisId) && !named.has(id));
  if (taken.length === 0) return changes;
  return {
    creates: changes?.creates ?? [],
    updates: changes?.updates ?? [],
    deletes: [...(changes?.deletes ?? []), ...taken],
  };
}

/**
 * Applies `changes` to `draft`, leaving `draft` as it was. An update writes only the fields that
 * differ between its `before` and its `after`, so a field it leaves alone keeps the draft's value.
 * Deleting an analysis also deletes each link that names it and that `changes` leave alone. The
 * result is marked unsaved. It shares created records with `changes`, and every record that the
 * changes leave alone with `draft`.
 *
 * @throws {Error} If an id appears more than once in one record kind's changes, an update's
 *   `before` and `after` name different ids, a create names a stored record's id, or the scope's
 *   record names another source project.
 */
export function applyChangeSet(draft: DraftProject, changes: ChangeSet): AppliedChanges {
  if (changes.scope && changes.scope.after.sourceProjectId !== draft.sourceProjectId) {
    throw new Error(
      `Interlinearizer: a change set for source project ${changes.scope.after.sourceProjectId} cannot apply to the draft of ${draft.sourceProjectId}`,
    );
  }
  const { analysis } = draft;
  const segmentAnalyses = applyRecordChanges(
    analysis.segmentAnalyses,
    changes.segmentAnalyses,
    'segment analysis',
    KEYED_FIELDS.segmentAnalyses,
  );
  const tokenAnalyses = applyRecordChanges(
    analysis.tokenAnalyses,
    changes.tokenAnalyses,
    'token analysis',
    KEYED_FIELDS.tokenAnalyses,
  );
  const phraseAnalyses = applyRecordChanges(
    analysis.phraseAnalyses,
    changes.phraseAnalyses,
    'phrase analysis',
    KEYED_FIELDS.phraseAnalyses,
  );
  const segmentAnalysisLinks = applyRecordChanges(
    analysis.segmentAnalysisLinks,
    withCascade(
      analysis.segmentAnalysisLinks,
      changes.segmentAnalysisLinks,
      segmentAnalyses.applied,
    ),
    'segment analysis link',
    KEYED_FIELDS.segmentAnalysisLinks,
  );
  const tokenAnalysisLinks = applyRecordChanges(
    analysis.tokenAnalysisLinks,
    withCascade(analysis.tokenAnalysisLinks, changes.tokenAnalysisLinks, tokenAnalyses.applied),
    'token analysis link',
    KEYED_FIELDS.tokenAnalysisLinks,
  );
  const phraseAnalysisLinks = applyRecordChanges(
    analysis.phraseAnalysisLinks,
    withCascade(analysis.phraseAnalysisLinks, changes.phraseAnalysisLinks, phraseAnalyses.applied),
    'phrase analysis link',
    KEYED_FIELDS.phraseAnalysisLinks,
  );

  const storedScope = scopeRecordOf(draft);
  const scope = changes.scope ? patchRecord(storedScope, changes.scope) : storedScope;
  const applied: AppliedChangeSet = {
    intent: changes.intent,
    ...(changes.scope && { scope }),
    ...(segmentAnalyses.applied && { segmentAnalyses: segmentAnalyses.applied }),
    ...(segmentAnalysisLinks.applied && { segmentAnalysisLinks: segmentAnalysisLinks.applied }),
    ...(tokenAnalyses.applied && { tokenAnalyses: tokenAnalyses.applied }),
    ...(tokenAnalysisLinks.applied && { tokenAnalysisLinks: tokenAnalysisLinks.applied }),
    ...(phraseAnalyses.applied && { phraseAnalyses: phraseAnalyses.applied }),
    ...(phraseAnalysisLinks.applied && { phraseAnalysisLinks: phraseAnalysisLinks.applied }),
  };
  return {
    draft: {
      ...scope,
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
    applied,
  };
}

/**
 * The changes that undo one record kind's `changes`, as far as `applied` reports them applied: each
 * create applied becomes a delete, each delete applied a create, and each update applied the
 * reverse update.
 */
function invertRecordChanges<T extends { id: string }>(
  changes: RecordChanges<T> | undefined,
  applied: AppliedRecords<T> | undefined,
): RecordChanges<T> | undefined {
  if (!changes || !applied) return undefined;
  const put = new Set(applied.puts.map(({ id }) => id));
  const deleted = new Set(applied.deletes);
  const inverse: RecordChanges<T> = {
    creates: changes.deletes.filter(({ id }) => deleted.has(id)),
    updates: changes.updates
      .filter(({ after }) => put.has(after.id))
      .map(({ before, after }) => ({ before: after, after: before })),
    deletes: changes.creates.filter(({ id }) => put.has(id)),
  };
  return inverse.creates.length > 0 || inverse.updates.length > 0 || inverse.deletes.length > 0
    ? inverse
    : undefined;
}

/**
 * The changes that undo `changes`, as far as `applied` reports them applied. A link that a deleted
 * analysis took with it is not restored.
 */
export function invertChangeSet(changes: ChangeSet, applied: AppliedChangeSet): ChangeSet {
  const segmentAnalyses = invertRecordChanges(changes.segmentAnalyses, applied.segmentAnalyses);
  const segmentAnalysisLinks = invertRecordChanges(
    changes.segmentAnalysisLinks,
    applied.segmentAnalysisLinks,
  );
  const tokenAnalyses = invertRecordChanges(changes.tokenAnalyses, applied.tokenAnalyses);
  const tokenAnalysisLinks = invertRecordChanges(
    changes.tokenAnalysisLinks,
    applied.tokenAnalysisLinks,
  );
  const phraseAnalyses = invertRecordChanges(changes.phraseAnalyses, applied.phraseAnalyses);
  const phraseAnalysisLinks = invertRecordChanges(
    changes.phraseAnalysisLinks,
    applied.phraseAnalysisLinks,
  );
  return {
    intent: changes.intent,
    ...(changes.scope && {
      scope: { before: changes.scope.after, after: changes.scope.before },
    }),
    ...(segmentAnalyses && { segmentAnalyses }),
    ...(segmentAnalysisLinks && { segmentAnalysisLinks }),
    ...(tokenAnalyses && { tokenAnalyses }),
    ...(tokenAnalysisLinks && { tokenAnalysisLinks }),
    ...(phraseAnalyses && { phraseAnalyses }),
    ...(phraseAnalysisLinks && { phraseAnalysisLinks }),
  };
}

/** One change to a record, as a kind's changes make it. */
type RecordChange<T> =
  | { op: 'create'; record: T }
  | { op: 'update'; update: RecordUpdate<T> }
  | { op: 'delete'; record: T };

/** Each change that one record kind's changes make, by record id. */
function changesById<T extends { id: string }>(
  changes: RecordChanges<T> | undefined,
): Map<string, RecordChange<T>> {
  const byRecord = new Map<string, RecordChange<T>>();
  changes?.creates.forEach((record) => byRecord.set(record.id, { op: 'create', record }));
  changes?.updates.forEach((update) => byRecord.set(update.after.id, { op: 'update', update }));
  changes?.deletes.forEach((record) => byRecord.set(record.id, { op: 'delete', record }));
  return byRecord;
}

/**
 * The single change to a record that equals `first` followed by `then`, or `undefined` when
 * together they change nothing.
 *
 * @throws {Error} If `then` creates a record that `first` leaves stored, which no apply allows.
 */
function mergeRecordChange<T extends { id: string }>(
  first: RecordChange<T>,
  then: RecordChange<T>,
  kind: string,
): RecordChange<T> | undefined {
  if (first.op === 'delete') {
    // An update or delete after a delete finds nothing stored, so it is skipped.
    if (then.op !== 'create') return first;
    return { op: 'update', update: { before: first.record, after: then.record } };
  }
  if (then.op === 'create') {
    throw new Error(
      `Interlinearizer: cannot merge change sets that create ${kind} ${then.record.id} while it is stored`,
    );
  }
  if (first.op === 'create') {
    return then.op === 'update' ? { op: 'create', record: then.update.after } : undefined;
  }
  return then.op === 'update'
    ? { op: 'update', update: { before: first.update.before, after: then.update.after } }
    : { op: 'delete', record: first.update.before };
}

/** One record kind's `first` then `then`, as one. */
function mergeRecordChanges<T extends { id: string }>(
  first: RecordChanges<T> | undefined,
  then: RecordChanges<T> | undefined,
  kind: string,
): RecordChanges<T> | undefined {
  if (!first || !then) return first ?? then;
  const merged = changesById(first);
  changesById(then).forEach((change, id) => {
    const earlier = merged.get(id);
    const combined = earlier ? mergeRecordChange(earlier, change, kind) : change;
    if (combined) merged.set(id, combined);
    else merged.delete(id);
  });
  const result: RecordChanges<T> = { creates: [], updates: [], deletes: [] };
  merged.forEach((change) => {
    if (change.op === 'create') result.creates.push(change.record);
    else if (change.op === 'update') result.updates.push(change.update);
    else result.deletes.push(change.record);
  });
  return result;
}

/**
 * Throws if `then` creates an analysis that `first` deletes, because merged changes would keep the
 * links that the delete takes with it.
 */
function assertNoAnalysisRestored(
  first: RecordChanges<{ id: string }> | undefined,
  then: RecordChanges<{ id: string }> | undefined,
  kind: string,
): void {
  if (!first || !then) return;
  const deleted = new Set(first.deletes.map(({ id }) => id));
  const restored = then.creates.find(({ id }) => deleted.has(id));
  if (restored) {
    throw new Error(
      `Interlinearizer: cannot merge change sets that delete and then create ${kind} ${restored.id}`,
    );
  }
}

/**
 * Changes that apply as `first` and then `then` do, named by `first`'s intent. Where both change a
 * record, the merged change reads the record as `first` did and leaves it as `then` does.
 *
 * @throws {Error} If `then` creates an analysis that `first` deletes, or a record that `first`
 *   leaves stored.
 */
export function mergeChangeSets(first: ChangeSet, then: ChangeSet): ChangeSet {
  assertNoAnalysisRestored(first.segmentAnalyses, then.segmentAnalyses, 'segment analysis');
  assertNoAnalysisRestored(first.tokenAnalyses, then.tokenAnalyses, 'token analysis');
  assertNoAnalysisRestored(first.phraseAnalyses, then.phraseAnalyses, 'phrase analysis');
  const scope =
    first.scope && then.scope
      ? { before: first.scope.before, after: then.scope.after }
      : (then.scope ?? first.scope);
  const segmentAnalyses = mergeRecordChanges(
    first.segmentAnalyses,
    then.segmentAnalyses,
    'segment analysis',
  );
  const segmentAnalysisLinks = mergeRecordChanges(
    first.segmentAnalysisLinks,
    then.segmentAnalysisLinks,
    'segment analysis link',
  );
  const tokenAnalyses = mergeRecordChanges(
    first.tokenAnalyses,
    then.tokenAnalyses,
    'token analysis',
  );
  const tokenAnalysisLinks = mergeRecordChanges(
    first.tokenAnalysisLinks,
    then.tokenAnalysisLinks,
    'token analysis link',
  );
  const phraseAnalyses = mergeRecordChanges(
    first.phraseAnalyses,
    then.phraseAnalyses,
    'phrase analysis',
  );
  const phraseAnalysisLinks = mergeRecordChanges(
    first.phraseAnalysisLinks,
    then.phraseAnalysisLinks,
    'phrase analysis link',
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
