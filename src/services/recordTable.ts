import type { IndexDifference, RecordChanges } from '../types/analysis-repository';

/** The keys a derived index files a record under. */
export type KeysOf<T> = (record: T) => readonly string[];

/** Ids filed under keys. */
type IdsByKey = Map<string, Set<string>>;

function fileId(index: IdsByKey, key: string, id: string): void {
  const ids = index.get(key);
  if (ids) ids.add(id);
  else index.set(key, new Set([id]));
}

function unfileId(index: IdsByKey, key: string, id: string): void {
  const ids = index.get(key);
  /* v8 ignore next -- a record's keys were filed when it was put */
  if (!ids) return;
  ids.delete(id);
  if (ids.size === 0) index.delete(key);
}

/** The ids in `a` that `b` lacks. */
function idsLacking(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined) {
  return [...(a ?? [])].filter((id) => !b?.has(id));
}

/** One record kind's records by id, with the derived indexes kept over them. */
export class RecordTable<T extends { id: string }, Index extends string> {
  private readonly kind: string;

  private readonly keyers: Record<Index, KeysOf<T>>;

  private readonly records = new Map<string, T>();

  private readonly indexes = new Map<Index, IdsByKey>();

  constructor(kind: string, keyers: Record<Index, KeysOf<T>>, records: readonly T[]) {
    this.kind = kind;
    this.keyers = keyers;
    this.indexNames().forEach((index) => this.indexes.set(index, new Map()));
    records.forEach((record) => this.put(record));
  }

  /** The records stored under `ids`, each once. */
  get(ids: readonly string[]): T[] {
    return this.recordsOf(new Set(ids));
  }

  /** The records `index` files under any of `keys`, each once. */
  find(index: Index, keys: readonly string[]): T[] {
    const filed = this.filed(index);
    if (keys.length === 1) return this.recordsOf(filed.get(keys[0]) ?? []);
    const ids = new Set<string>();
    keys.forEach((key) => filed.get(key)?.forEach((id) => ids.add(id)));
    return this.recordsOf(ids);
  }

  /** Every record, in stored order. */
  all(): T[] {
    return [...this.records.values()];
  }

  /** The keys `index` files any record under. */
  keys(index: Index): string[] {
    return [...this.filed(index).keys()];
  }

  /** How many records `index` files under `key`. */
  count(index: Index, key: string): number {
    return this.filed(index).get(key)?.size ?? 0;
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
        const missing = idsLacking(fresh.get(key), kept.get(key));
        const extra = idsLacking(kept.get(key), fresh.get(key));
        if (missing.length === 0 && extra.length === 0) return [];
        return [{ index: `${this.kind} by ${index}`, key, missing, extra }];
      });
    });
    return [...recordDifferences, ...indexDifferences];
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

  private filed(index: Index): IdsByKey {
    const filed = this.indexes.get(index);
    /* v8 ignore next -- the constructor gives every index its map */
    if (!filed) throw new Error(`Interlinearizer: ${this.kind} has no index by ${index}`);
    return filed;
  }

  /** The keys `index` files `record` under, each once. */
  private keysOf(index: Index, record: T): Set<string> {
    return new Set(this.keyers[index](record));
  }

  /** Stores `record`, keeping a replaced record's place under every key it keeps. */
  private put(record: T): void {
    const prior = this.records.get(record.id);
    this.records.set(record.id, record);
    this.indexNames().forEach((index) => {
      const filed = this.filed(index);
      const before = prior ? this.keysOf(index, prior) : new Set<string>();
      const after = this.keysOf(index, record);
      before.forEach((key) => {
        if (!after.has(key)) unfileId(filed, key, record.id);
      });
      after.forEach((key) => {
        if (!before.has(key)) fileId(filed, key, record.id);
      });
    });
  }

  private remove(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    this.indexNames().forEach((index) =>
      this.keysOf(index, record).forEach((key) => unfileId(this.filed(index), key, id)),
    );
  }
}
