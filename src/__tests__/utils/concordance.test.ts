/// <reference types="jest" />

import type { TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { Collator } from 'platform-bible-utils';
import { FIXTURE_STAMPS, makeVerseBook } from '../test-helpers';
import {
  CONTEXT_RADIUS,
  approvedAnalysisByToken,
  approvedAnalysisOf,
  buildConcordanceEntries,
  contextLine,
  deriveConcordanceRows,
  indexBook,
  tallyAnalyses,
  type ConcordanceOccurrence,
} from '../../utils/concordance';

const collator = new Collator('en');

/**
 * Builds a link from `tokenRef`, recorded as reading `surfaceText`, to the analysis, approved
 * unless another status is given.
 */
function link(
  analysisId: string,
  tokenRef: string,
  surfaceText = 'word',
  status: TokenAnalysisLink['status'] = 'approved',
): TokenAnalysisLink {
  return { ...FIXTURE_STAMPS, analysisId, status, token: { tokenRef, surfaceText } };
}

/** Builds a token analysis glossed in English. */
function analysis(id: string, gloss?: string): TokenAnalysis {
  return { ...FIXTURE_STAMPS, id, surfaceText: 'word', gloss: gloss ? { en: gloss } : undefined };
}

/** Builds an occurrence of the form at `charStart` in `contextText`. */
function occurrenceIn(contextText: string, form: string): ConcordanceOccurrence {
  const charStart = contextText.indexOf(form);
  return {
    tokenRef: `GEN 1:1:${charStart}`,
    book: 'GEN',
    chapter: 1,
    verse: 1,
    surfaceText: form,
    contextText,
    charStart,
    charEnd: charStart + form.length,
  };
}

describe('indexBook', () => {
  it('files words under the form they match under, dropping punctuation', () => {
    const index = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'The man, the dog.' }]));

    expect([...index.occurrencesByForm.keys()]).toEqual(['the', 'man', 'dog']);
    expect(index.occurrencesByForm.get('the')?.map((o) => o.surfaceText)).toEqual(['The', 'the']);
  });

  it('carries each occurrence with its verse text and location', () => {
    const index = indexBook(makeVerseBook([{ sid: 'GEN 2:3', text: 'God rested' }]));

    expect(index.occurrencesByForm.get('rested')).toEqual([
      {
        tokenRef: 'GEN 2:3:4',
        book: 'GEN',
        chapter: 2,
        verse: 3,
        surfaceText: 'rested',
        contextText: 'God rested',
        charStart: 4,
        charEnd: 10,
      },
    ]);
  });

  it('stamps the index with the book and the text version it was read from', () => {
    const book = makeVerseBook([{ sid: 'EXO 1:1', text: 'names' }]);

    expect(indexBook(book)).toMatchObject({ book: 'EXO', textVersion: book.textVersion });
  });
});

describe('buildConcordanceEntries', () => {
  it('merges books into document order whatever order they arrive in', () => {
    const genesis = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'light' }]));
    const exodus = indexBook(makeVerseBook([{ sid: 'EXO 1:1', text: 'light' }]));

    const [entry] = buildConcordanceEntries([exodus, genesis], collator);

    expect(entry.occurrences.map((o) => o.book)).toEqual(['GEN', 'EXO']);
  });

  it('counts occurrences per book', () => {
    const genesis = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'light light' }]));
    const exodus = indexBook(makeVerseBook([{ sid: 'EXO 1:1', text: 'light' }]));

    const [entry] = buildConcordanceEntries([genesis, exodus], collator);

    expect(Object.fromEntries(entry.countByBook)).toEqual({ GEN: 2, EXO: 1 });
  });

  it('orders the most-occurring form first', () => {
    const book = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'a b b' }]));

    expect(buildConcordanceEntries([book], collator).map((e) => e.form)).toEqual(['b', 'a']);
  });

  it('orders equally frequent forms by their collated spelling', () => {
    const book = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'zeal Ábel apple' }]));

    expect(buildConcordanceEntries([book], collator).map((e) => e.displayText)).toEqual([
      'Ábel',
      'apple',
      'zeal',
    ]);
  });

  it('breaks a collation tie by form, so the order never depends on arrival', () => {
    const accentBlind = new Collator('en', { sensitivity: 'base' });
    const book = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'resume résumé' }]));

    expect(buildConcordanceEntries([book], accentBlind).map((e) => e.form)).toEqual([
      'resume',
      'résumé',
    ]);
    const reversed = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'résumé resume' }]));
    expect(buildConcordanceEntries([reversed], accentBlind).map((e) => e.form)).toEqual([
      'resume',
      'résumé',
    ]);
  });

  it('shows an entry by its most frequent spelling', () => {
    const book = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'The the the' }]));

    expect(buildConcordanceEntries([book], collator)[0].displayText).toBe('the');
  });

  it('shows an entry by the earliest spelling when spellings are equally frequent', () => {
    const book = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'Abraham abraham' }]));

    expect(buildConcordanceEntries([book], collator)[0].displayText).toBe('Abraham');
  });
});

describe('approvedAnalysisOf', () => {
  const book = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'dark dark' }]));
  const [entry] = buildConcordanceEntries([book], collator);
  const [first, second] = entry.occurrences;

  it('finds the analysis an occurrence is approved to', () => {
    const approved = approvedAnalysisByToken([link('a1', 'GEN 1:1:0', 'dark')]);

    expect(approvedAnalysisOf(approved, entry, first)).toBe('a1');
    expect(approvedAnalysisOf(approved, entry, second)).toBeUndefined();
  });

  it('skips links of other statuses', () => {
    const approved = approvedAnalysisByToken([link('a1', 'GEN 1:1:0', 'dark', 'suggested')]);

    expect(approvedAnalysisOf(approved, entry, first)).toBeUndefined();
  });

  it('ignores an approval recorded against a different word at the same place', () => {
    const approved = approvedAnalysisByToken([link('a1', 'GEN 1:1:0', 'light')]);

    expect(approvedAnalysisOf(approved, entry, first)).toBeUndefined();
  });

  it('accepts an approval recorded against the word in another case', () => {
    const approved = approvedAnalysisByToken([link('a1', 'GEN 1:1:0', 'Dark')]);

    expect(approvedAnalysisOf(approved, entry, first)).toBe('a1');
  });

  it('keeps the first approval for a token approved twice', () => {
    const approved = approvedAnalysisByToken([
      link('a1', 'GEN 1:1:0', 'dark'),
      link('a2', 'GEN 1:1:0', 'dark'),
    ]);

    expect(approvedAnalysisOf(approved, entry, first)).toBe('a1');
  });
});

describe('deriveConcordanceRows', () => {
  const genesis = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'light light' }]));
  const exodus = indexBook(makeVerseBook([{ sid: 'EXO 1:1', text: 'light' }]));
  const entries = buildConcordanceEntries([genesis, exodus], collator);

  it('marks a form with every occurrence approved as analyzed', () => {
    const approved = approvedAnalysisByToken([
      link('a1', 'GEN 1:1:0', 'light'),
      link('a1', 'GEN 1:1:6', 'light'),
      link('a1', 'EXO 1:1:0', 'light'),
    ]);

    expect(deriveConcordanceRows(entries, approved, 'GEN')[0]).toMatchObject({
      analyzedCount: 3,
      status: 'analyzed',
    });
  });

  it('marks a form with some occurrences approved as partly analyzed', () => {
    const approved = approvedAnalysisByToken([link('a1', 'GEN 1:1:0', 'light')]);

    expect(deriveConcordanceRows(entries, approved, 'GEN')[0]).toMatchObject({
      analyzedCount: 1,
      status: 'partlyAnalyzed',
    });
  });

  it('marks a form with no occurrence approved as unanalyzed', () => {
    expect(deriveConcordanceRows(entries, new Map(), 'GEN')[0]).toMatchObject({
      analyzedCount: 0,
      status: 'unanalyzed',
    });
  });

  it('does not count an occurrence whose token was approved as a different word', () => {
    const approved = approvedAnalysisByToken([link('a1', 'GEN 1:1:0', 'dark')]);

    expect(deriveConcordanceRows(entries, approved, 'GEN')[0]).toMatchObject({
      analyzedCount: 0,
      status: 'unanalyzed',
    });
  });

  it('counts the occurrences in the current book', () => {
    expect(deriveConcordanceRows(entries, new Map(), 'EXO')[0].occurrenceCountInBook).toBe(1);
  });

  it('counts none in a current book the form does not occur in', () => {
    expect(deriveConcordanceRows(entries, new Map(), 'LEV')[0].occurrenceCountInBook).toBe(0);
  });
});

describe('tallyAnalyses', () => {
  const book = indexBook(makeVerseBook([{ sid: 'GEN 1:1', text: 'word word word word' }]));
  const [entry] = buildConcordanceEntries([book], collator);

  it('counts the occurrences each analysis covers, most-used first', () => {
    const approved = approvedAnalysisByToken([
      link('rare', 'GEN 1:1:0'),
      link('common', 'GEN 1:1:5'),
      link('common', 'GEN 1:1:10'),
    ]);
    const records = new Map([
      ['rare', analysis('rare', 'utterance')],
      ['common', analysis('common', 'word')],
    ]);

    expect(tallyAnalyses(entry, approved, records, 'en')).toEqual([
      { analysisId: 'common', gloss: 'word', count: 2 },
      { analysisId: 'rare', gloss: 'utterance', count: 1 },
    ]);
  });

  it('orders equally used analyses by first use', () => {
    const approved = approvedAnalysisByToken([
      link('second', 'GEN 1:1:5'),
      link('first', 'GEN 1:1:0'),
    ]);
    const records = new Map([
      ['first', analysis('first', 'one')],
      ['second', analysis('second', 'two')],
    ]);

    expect(tallyAnalyses(entry, approved, records, 'en').map((t) => t.analysisId)).toEqual([
      'first',
      'second',
    ]);
  });

  it('leaves out an approval recorded against a different word', () => {
    const approved = approvedAnalysisByToken([link('a1', 'GEN 1:1:0', 'light')]);

    expect(tallyAnalyses(entry, approved, new Map(), 'en')).toEqual([]);
  });

  it('reads an analysis with no gloss in the language as unglossed', () => {
    const approved = approvedAnalysisByToken([link('a1', 'GEN 1:1:0')]);
    const records = new Map([['a1', analysis('a1', 'word')]]);

    expect(tallyAnalyses(entry, approved, records, 'fr')[0].gloss).toBe('');
  });

  it('reads an approval naming a missing record as unglossed', () => {
    const approved = approvedAnalysisByToken([link('gone', 'GEN 1:1:0')]);

    expect(tallyAnalyses(entry, approved, new Map(), 'en')).toEqual([
      { analysisId: 'gone', gloss: '', count: 1 },
    ]);
  });
});

describe('contextLine', () => {
  it('keeps a short verse whole', () => {
    expect(contextLine(occurrenceIn('In the beginning God', 'beginning'))).toEqual({
      before: 'In the ',
      form: 'beginning',
      after: ' God',
      clippedBefore: false,
      clippedAfter: false,
    });
  });

  it('trims a long verse back to word breaks on both sides', () => {
    const filler = 'lorem ipsum dolor sit amet consectetur sed do eiusmod tempor';
    const text = `${filler} adipiscing ${filler} elit`;

    const line = contextLine(occurrenceIn(text, 'adipiscing'));

    expect(line).toMatchObject({ form: 'adipiscing', clippedBefore: true, clippedAfter: true });
    expect(text).toContain(`${line.before}adipiscing${line.after}`);
    expect(line.before.length).toBeLessThanOrEqual(CONTEXT_RADIUS);
    expect(line.after.length).toBeLessThanOrEqual(CONTEXT_RADIUS);
    expect(filler.split(' ')).toContain(line.before.trim().split(' ')[0]);
    expect(filler.split(' ')).toContain(line.after.trim().split(' ').at(-1));
  });

  it('cuts text written without spaces at the radius', () => {
    const run = '天'.repeat(CONTEXT_RADIUS + 5);
    const line = contextLine(occurrenceIn(`${run}地${run}`, '地'));

    expect(line.before).toBe('天'.repeat(CONTEXT_RADIUS));
    expect(line.after).toBe('天'.repeat(CONTEXT_RADIUS));
  });

  it('never splits a character outside the basic plane at a cut', () => {
    const run = '𠀀'.repeat(CONTEXT_RADIUS);
    const line = contextLine(occurrenceIn(`${run}x地x${run}`, '地'));

    expect(line.before).toBe(`${'𠀀'.repeat(CONTEXT_RADIUS / 2 - 1)}x`);
    expect(line.after).toBe(`x${'𠀀'.repeat(CONTEXT_RADIUS / 2 - 1)}`);
  });
});
