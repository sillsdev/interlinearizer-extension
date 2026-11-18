import type { IndexDifference, RecordChanges } from '../types/analysis-repository';

/** The keys a derived index files a record under. */
export type KeysOf<T> = (record: T) => readonly string[];

/** Ids filed under keys. */
export type IdsByKey = Map<string, Set<string>>;

/** Files `id` under `key`. */
export function fileId(index: IdsByKey, key: string, id: string): void {
  const ids = index.get(key);
  if (ids) ids.add(id);
  else index.set(key, new Set([id]));
}

/** Removes `id` from under `key`, dropping a key left with no ids. */
export function unfileId(index: IdsByKey, key: string, id: string): void {
  const ids = index.get(key);
  /* v8 ignore next -- an id is unfiled only from a key it was filed under */
  if (!ids) return;
  ids.delete(id);
  if (ids.size === 0) index.delete(key);
}

/** The ids in `a` that `b` lacks. */
export function idsLacking(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined) {
  return [...(a ?? [])].filter((id) => !b?.has(id));
}

/**
 * Ids filed under keys. A key that files one id holds it bare, because a set for every such key
 * made building the larger indexes half again as slow.
 */
type FiledIds = Map<string, string | Set<string>>;

function fileOne(filed: FiledIds, key: string, id: string): void {
  const held = filed.get(key);
  if (held === undefined) filed.set(key, id);
  else if (typeof held !== 'string') held.add(id);
  else if (held !== id) filed.set(key, new Set([held, id]));
}

function unfileOne(filed: FiledIds, key: string, id: string): void {
  const held = filed.get(key);
  if (held === id) {
    filed.delete(key);
    return;
  }
  /* v8 ignore next -- an id is unfiled only from a key it was filed under */
  if (held === undefined || typeof held === 'string') return;
  held.delete(id);
  if (held.size !== 1) return;
  const [remaining] = held;
  filed.set(key, remaining);
}

/** The ids `held` names, as a set. */
function idSet(held: string | Set<string> | undefined): ReadonlySet<string> | undefined {
  return typeof held === 'string' ? new Set([held]) : held;
}

/** One record kind's records by id, with the derived indexes kept over them. */
export class RecordTable<T extends { id: string }, Index extends string> {
  private readonly kind: string;

  private readonly keyers: Record<Index, KeysOf<T>>;

  private readonly records = new Map<string, T>();

  private readonly indexes = new Map<Index, FiledIds>();

  /** Each index's keyer, paired with the map it files ids in. */
  private readonly filings: readonly (readonly [KeysOf<T>, FiledIds])[];

  /** What {@link RecordTable.all} last returned, until a record is put or removed. */
  private allHeld: T[] | undefined;

  constructor(kind: string, keyers: Record<Index, KeysOf<T>>, records: readonly T[]) {
    this.kind = kind;
    this.keyers = keyers;
    this.indexNames().forEach((index) => this.indexes.set(index, new Map()));
    this.filings = this.indexNames().map((index) => [keyers[index], this.filed(index)]);
    records.forEach((record) => this.put(record));
  }

  /** Whether a record is stored under `id`. */
  hasRecord(id: string): boolean {
    return this.records.has(id);
  }

  /** The records stored under `ids`, each once. */
  get(ids: readonly string[]): T[] {
    return this.recordsOf(new Set(ids));
  }

  /** The records `index` files under any of `keys`, each once. */
  find(index: Index, keys: readonly string[]): T[] {
    const filed = this.filed(index);
    if (keys.length === 1) {
      const held = filed.get(keys[0]);
      return this.recordsOf(typeof held === 'string' ? [held] : (held ?? []));
    }
    const ids = new Set<string>();
    keys.forEach((key) => {
      const held = filed.get(key);
      if (typeof held === 'string') ids.add(held);
      else held?.forEach((id) => ids.add(id));
    });
    return this.recordsOf(ids);
  }

  /** Every record in stored order, as one array kept until a record is put or removed. */
  all(): T[] {
    this.allHeld ??= [...this.records.values()];
    return this.allHeld;
  }

  /** The keys `index` files any record under. */
  keys(index: Index): string[] {
    return [...this.filed(index).keys()];
  }

  /** How many records `index` files under `key`. */
  count(index: Index, key: string): number {
    const held = this.filed(index).get(key);
    return typeof held === 'string' ? 1 : (held?.size ?? 0);
  }

  /** Whether `index` files any record under `key`. */
  has(index: Index, key: string): boolean {
    return this.filed(index).has(key);
  }

  /** Applies one record kind's puts and deletes; absent changes apply nothing. */
  apply(changes: RecordChanges<T> | undefined): void {
    changes?.puts.forEach((record) => this.put(record));
    changes?.deletes.forEach((id) => this.remove(id));
  }

  /**
   * Where this table differs from `rebuilt`, a table of the same kind built afresh. A record whose
   * kept copy differs from the rebuilt one is both missing and extra.
   */
  differencesFrom(rebuilt: RecordTable<T, Index>): IndexDifference[] {
    const ids = new Set([...this.records.keys(), ...rebuilt.records.keys()]);
    const recordDifferences = [...ids].flatMap((id): IndexDifference[] => {
      const kept = this.records.get(id);
      const stored = rebuilt.records.get(id);
      if (JSON.stringify(kept) === JSON.stringify(stored)) return [];
      return [{ index: this.kind, key: id, missing: stored ? [id] : [], extra: kept ? [id] : [] }];
    });
    const indexDifferences = this.indexNames().flatMap((index) => {
      const kept = this.filed(index);
      const fresh = rebuilt.filed(index);
      const keys = new Set([...kept.keys(), ...fresh.keys()]);
      return [...keys].flatMap((key): IndexDifference[] => {
        const missing = idsLacking(idSet(fresh.get(key)), idSet(kept.get(key)));
        const extra = idsLacking(idSet(kept.get(key)), idSet(fresh.get(key)));
        if (missing.length === 0 && extra.length === 0) return [];
        return [{ index: `${this.kind} by ${index}`, key, missing, extra }];
      });
    });
    return [...recordDifferences, ...indexDifferences];
  }

  /** Stores `record` in place of any record with the same id, and files `record` under its keys. */
  put(record: T): void {
    const prior = this.records.get(record.id);
    this.records.set(record.id, record);
    this.allHeld = undefined;
    this.filings.forEach(([keysOf, filed]) => {
      if (!prior) {
        keysOf(record).forEach((key) => fileOne(filed, key, record.id));
        return;
      }
      const before = new Set(keysOf(prior));
      const after = new Set(keysOf(record));
      before.forEach((key) => {
        if (!after.has(key)) unfileOne(filed, key, record.id);
      });
      after.forEach((key) => {
        if (!before.has(key)) fileOne(filed, key, record.id);
      });
    });
  }

  /** Removes the record stored under `id`, if there is one. */
  remove(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    this.allHeld = undefined;
    this.indexNames().forEach((index) =>
      this.keysOf(index, record).forEach((key) => unfileOne(this.filed(index), key, id)),
    );
  }

  /** The records stored under `ids`, which must be distinct, skipping an id with none stored. */
  private recordsOf(ids: Iterable<string>): T[] {
    const found: T[] = [];
    // eslint-disable-next-line no-restricted-syntax -- iterates a Set without copying it to an array
    for (const id of ids) {
      const record = this.records.get(id);
      if (record) found.push(record);
    }
    return found;
  }

  private indexNames(): Index[] {
    // Object.keys widens to string[]; the keys are exactly the keyers' index names.
    return Object.keys(this.keyers).filter((name): name is Index => name in this.keyers);
  }

  private filed(index: Index): FiledIds {
    const filed = this.indexes.get(index);
    /* v8 ignore next -- the constructor gives every index its map */
    if (!filed) throw new Error(`Interlinearizer: ${this.kind} has no index by ${index}`);
    return filed;
  }

  /** The keys `index` files `record` under, each once. */
  private keysOf(index: Index, record: T): Set<string> {
    return new Set(this.keyers[index](record));
  }
}
