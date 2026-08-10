/// <reference types="jest" />

import { foldForSearch } from '../../utils/search-fold';

describe('foldForSearch', () => {
  it('folds Greek accents and the iota subscript away', () => {
    expect(foldForSearch('ἀρχῇ')).toBe(foldForSearch('αρχη'));
  });

  it('folds Hebrew points away', () => {
    expect(foldForSearch('שָׁלוֹם')).toBe(foldForSearch('שלום'));
  });

  it('strips a Latin diacritic rather than transliterating it', () => {
    expect(foldForSearch('šālôm')).toBe('salom');
  });

  it('lowercases so a query matches a capitalized form', () => {
    expect(foldForSearch('Ἀρχή')).toBe(foldForSearch('αρχη'));
  });

  it('keeps a spacing combining mark, which spells a vowel rather than decorating one', () => {
    expect(foldForSearch('कि')).not.toBe(foldForSearch('क'));
  });
});
