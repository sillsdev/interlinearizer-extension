/// <reference types="jest" />

import { RecordTable } from '../../services/recordTable';

type Item = { id: string; tags: string[]; note?: string };

const keyers = { tag: (item: Item) => item.tags };

function tableOf(...items: Item[]) {
  return new RecordTable('items', keyers, items);
}

describe('RecordTable', () => {
  it('gets records by id, once per id, skipping ids with nothing stored', () => {
    const a = { id: 'a', tags: [] };

    expect(tableOf(a).get(['a', 'missing', 'a'])).toStrictEqual([a]);
  });

  it('finds the records filed under any of the keys, each once', () => {
    const a = { id: 'a', tags: ['x', 'y'] };
    const b = { id: 'b', tags: ['y'] };
    const c = { id: 'c', tags: ['z'] };

    expect(tableOf(a, b, c).find('tag', ['x', 'y', 'missing'])).toStrictEqual([a, b]);
  });

  it('lists every record in stored order', () => {
    const a = { id: 'a', tags: [] };
    const b = { id: 'b', tags: [] };

    expect(tableOf(a, b).all()).toStrictEqual([a, b]);
  });

  it('drops a key once its last record is deleted or moved off it', () => {
    const table = tableOf({ id: 'a', tags: ['x'] }, { id: 'b', tags: ['y'] });

    table.apply({ puts: [{ id: 'b', tags: ['z'] }], deletes: ['a'] });

    expect(table.keys('tag')).toStrictEqual(['z']);
    expect(table.has('tag', 'x')).toBe(false);
    expect(table.has('tag', 'y')).toBe(false);
    expect(table.has('tag', 'z')).toBe(true);
  });

  it('files a record once under a key its keyer returns twice', () => {
    const table = tableOf({ id: 'a', tags: ['x', 'x'] });

    table.apply({ puts: [], deletes: ['a'] });

    expect(table.find('tag', ['x'])).toStrictEqual([]);
    expect(table.differencesFrom(tableOf())).toStrictEqual([]);
  });

  it('files a put record under its new keys only', () => {
    const table = tableOf({ id: 'a', tags: ['x'] });
    const moved = { id: 'a', tags: ['y'] };

    table.apply({ puts: [moved], deletes: [] });

    expect(table.find('tag', ['x'])).toStrictEqual([]);
    expect(table.find('tag', ['y'])).toStrictEqual([moved]);
  });

  it('keeps a replaced record in its place under the keys it keeps', () => {
    const b = { id: 'b', tags: ['x'] };
    const table = tableOf({ id: 'a', tags: ['x'] }, b);
    const replaced = { id: 'a', tags: ['x', 'y'], note: 'changed' };

    table.apply({ puts: [replaced], deletes: [] });

    expect(table.find('tag', ['x'])).toStrictEqual([replaced, b]);
    expect(table.find('tag', ['y'])).toStrictEqual([replaced]);
  });

  it('unfiles a deleted record, skipping an id with nothing stored', () => {
    const table = tableOf({ id: 'a', tags: ['x'] });

    table.apply({ puts: [], deletes: ['a', 'missing'] });

    expect(table.get(['a'])).toStrictEqual([]);
    expect(table.find('tag', ['x'])).toStrictEqual([]);
  });

  it('applies nothing for absent changes', () => {
    const table = tableOf({ id: 'a', tags: ['x'] });

    table.apply(undefined);

    expect(table.differencesFrom(tableOf({ id: 'a', tags: ['x'] }))).toStrictEqual([]);
  });

  describe('differencesFrom', () => {
    it('reports none against a table holding the same records', () => {
      const items = [
        { id: 'a', tags: ['x'] },
        { id: 'b', tags: ['x', 'y'] },
      ];

      expect(tableOf(...items).differencesFrom(tableOf(...items))).toStrictEqual([]);
    });

    it('reports a record the kept table lacks, and the entries filing it', () => {
      expect(tableOf().differencesFrom(tableOf({ id: 'a', tags: ['x'] }))).toStrictEqual([
        { index: 'items', key: 'a', missing: ['a'], extra: [] },
        { index: 'items by tag', key: 'x', missing: ['a'], extra: [] },
      ]);
    });

    it('reports a record only the kept table holds, and the entries filing it', () => {
      expect(tableOf({ id: 'a', tags: ['x'] }).differencesFrom(tableOf())).toStrictEqual([
        { index: 'items', key: 'a', missing: [], extra: ['a'] },
        { index: 'items by tag', key: 'x', missing: [], extra: ['a'] },
      ]);
    });

    it('reports a record whose kept copy differs as both missing and extra', () => {
      const kept = tableOf({ id: 'a', tags: [], note: 'old' });

      expect(kept.differencesFrom(tableOf({ id: 'a', tags: [], note: 'new' }))).toStrictEqual([
        { index: 'items', key: 'a', missing: ['a'], extra: ['a'] },
      ]);
    });
  });
});
