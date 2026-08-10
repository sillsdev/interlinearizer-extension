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

  it('folds a Greek final sigma to the shape the letter takes mid-word', () => {
    expect(foldForSearch('λόγος')).toBe(foldForSearch('λογοσ'));
  });

  it('folds a Hebrew final form to the shape the letter takes mid-word', () => {
    expect(foldForSearch('שָׁלוֹם')).toBe(foldForSearch('שלומ'));
  });

  it('folds a final sigma reached by lowercasing a capitalized form', () => {
    expect(foldForSearch('ΛΌΓΟΣ')).toBe(foldForSearch('λογοσ'));
  });

  // Arabic shapes its letters as it renders, so plain text needs no folding; text carrying the
  // presentation forms an older encoding spelled out does.
  it('folds Arabic presentation forms to the letters typed for them', () => {
    expect(foldForSearch('ﺑﻴﺖ')).toBe(foldForSearch('بيت'));
  });

  it('folds a lunate sigma, which stands for the letter at either position', () => {
    expect(foldForSearch('ϲοφία')).toBe(foldForSearch('σοφια'));
  });

  it('folds a long s, the word-medial shape an older Latin typography wrote', () => {
    expect(foldForSearch('ſanctus')).toBe(foldForSearch('sanctus'));
  });

  it('keeps a stroked letter, which its script counts as a letter of its own', () => {
    expect(foldForSearch('łuk')).not.toBe(foldForSearch('luk'));
  });
});
