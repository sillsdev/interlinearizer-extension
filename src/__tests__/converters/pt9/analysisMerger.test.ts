/// <reference types="jest" />

import type { LexemeKeyData } from 'parsers/pt9/lexemeKey';
import { mergeLanguageAnalyses } from '../../../converters/pt9/analysisMerger';
import type {
  LangPhraseRecord,
  LangTokenRecord,
} from '../../../converters/pt9/languageAnalysisBuilder';
import {
  Pt9LexiconResolver,
  unresolvedPt9LexiconResolver,
} from '../../../converters/pt9/lexiconResolver';
import { emptyPt9ImportReport } from '../../../converters/pt9/report';

const STAMP = '2026-08-01T00:00:00.000Z';

/** A resolver that answers from literal maps, keyed by composed key id and sense id. */
function fakeResolver(
  entries: Record<string, string>,
  senses: Record<string, string>,
): Pt9LexiconResolver {
  return {
    resolveEntry: (key) => {
      const id = entries[`${key.Type}:${key.Form}`];
      return id === undefined ? undefined : { entryId: id };
    },
    resolveSense: (key, senseId) => {
      const id = senses[`${key.Type}:${key.Form}#${senseId}`];
      return id === undefined ? undefined : { senseId: id };
    },
  };
}

const HELLO_KEY: LexemeKeyData = { Type: 'Word', Form: 'hello' };

/** A word-facet contribution with overridable fields. */
function wordRecord(overrides: Partial<LangTokenRecord> = {}): LangTokenRecord {
  return {
    tag: 'en',
    tokenRef: 'GEN 1:1:0',
    tokenSurface: 'hello',
    tokenWritingSystem: 'en',
    status: 'approved',
    ambiguous: false,
    word: { key: HELLO_KEY, keyId: 'Word:hello', senseId: 'S1', glossText: 'greeting' },
    ...overrides,
  };
}

/** A parse facet for hello = hell + o. */
function helloParse(senseIds: (string | undefined)[] = [undefined, undefined]) {
  return {
    lexemes: [
      { key: { Type: 'Stem', Form: 'hell' }, keyId: 'Stem:hell', senseId: senseIds[0] },
      { key: { Type: 'Suffix', Form: 'o' }, keyId: 'Suffix:o', senseId: senseIds[1] },
    ],
    signature: 'Stem:hell/Suffix:o',
  };
}

function merge(
  records: LangTokenRecord[],
  phrases: LangPhraseRecord[] = [],
  resolver = unresolvedPt9LexiconResolver,
) {
  const report = emptyPt9ImportReport();
  const result = mergeLanguageAnalyses({ records, phrases, resolver, importedAt: STAMP, report });
  return { result, report };
}

describe('mergeLanguageAnalyses - token records', () => {
  it('emits one payload and link per contribution with stamps, producer, and snapshot', () => {
    const { result } = merge([wordRecord()]);

    expect(result.tokenAnalyses).toStrictEqual([
      {
        id: 'pt9:ta:GEN 1:1:0:0',
        createdAt: STAMP,
        updatedAt: STAMP,
        surfaceText: 'hello',
        producer: 'pt9-import',
        gloss: { en: 'greeting' },
      },
    ]);
    expect(result.tokenAnalysisLinks).toStrictEqual([
      {
        analysisId: 'pt9:ta:GEN 1:1:0:0',
        createdAt: STAMP,
        updatedAt: STAMP,
        status: 'approved',
        token: { tokenRef: 'GEN 1:1:0', surfaceText: 'hello' },
      },
    ]);
  });

  describe('gloss merging', () => {
    it('merges same-word contributions across languages into MultiString glosses', () => {
      const { result, report } = merge([
        wordRecord(),
        wordRecord({
          tag: 'fr',
          word: { key: HELLO_KEY, keyId: 'Word:hello', senseId: 'S1', glossText: 'salut' },
        }),
      ]);

      expect(result.tokenAnalyses).toHaveLength(1);
      expect(result.tokenAnalyses[0].gloss).toStrictEqual({ en: 'greeting', fr: 'salut' });
      expect(report.merge.mergedTokenRecords).toBe(1);
    });

    it('keeps the first gloss per tag when the same tag contributes twice', () => {
      const { result } = merge([
        wordRecord(),
        wordRecord({
          word: { key: HELLO_KEY, keyId: 'Word:hello', senseId: 'S1', glossText: 'other' },
        }),
      ]);

      expect(result.tokenAnalyses[0].gloss).toStrictEqual({ en: 'greeting' });
    });
  });

  describe('status agreement', () => {
    it('approves a merged record only when every contribution is approved', () => {
      const { result } = merge([wordRecord(), wordRecord({ tag: 'fr', status: 'suggested' })]);
      expect(result.tokenAnalysisLinks[0].status).toBe('suggested');
    });

    it('rejects a merged record only when every contribution is rejected', () => {
      const rejected = merge([
        wordRecord({ status: 'rejected' }),
        wordRecord({ tag: 'fr', status: 'rejected' }),
      ]);
      expect(rejected.result.tokenAnalysisLinks[0].status).toBe('rejected');

      const mixed = merge([
        wordRecord({ status: 'rejected' }),
        wordRecord({ tag: 'fr', status: 'approved' }),
      ]);
      expect(mixed.result.tokenAnalysisLinks[0].status).toBe('suggested');
    });
  });

  describe('parse merging and conflicts', () => {
    it('merges two languages carrying the identical parse into one record', () => {
      const { result, report } = merge([
        wordRecord({ parse: helloParse() }),
        wordRecord({ tag: 'fr', parse: helloParse() }),
      ]);

      expect(result.tokenAnalyses).toHaveLength(1);
      expect(report.merge.parseConflicts).toBe(0);
    });

    it('keeps the first parse columns when the same tag contributes a parse-only record too', () => {
      const resolver = fakeResolver({}, { 'Stem:hell#P1': 'would-resolve' });
      const { result } = merge(
        [
          wordRecord({ parse: helloParse() }),
          wordRecord({ word: undefined, parse: helloParse(['P1', undefined]) }),
        ],
        [],
        resolver,
      );

      expect(result.tokenAnalyses).toHaveLength(1);
      // The word record's en columns (no senses) win, so the standalone's P1 never resolves.
      expect(result.tokenAnalyses[0].morphemes?.[0].senseRef).toBeUndefined();
    });

    it('adopts a parse from the language that has one', () => {
      const { result } = merge([wordRecord(), wordRecord({ tag: 'fr', parse: helloParse() })]);

      expect(result.tokenAnalyses).toHaveLength(1);
      expect(result.tokenAnalyses[0].morphemes?.map((m) => m.form)).toStrictEqual(['hell', 'o']);
      expect(result.tokenAnalyses[0].morphemes?.map((m) => m.id)).toStrictEqual(['m0', 'm1']);
    });

    it('splits genuinely conflicting parses into competing records and demotes the later approved one', () => {
      const otherParse = {
        lexemes: [
          { key: { Type: 'Stem', Form: 'he' }, keyId: 'Stem:he', senseId: undefined },
          { key: { Type: 'Suffix', Form: 'llo' }, keyId: 'Suffix:llo', senseId: undefined },
        ],
        signature: 'Stem:he/Suffix:llo',
      };
      const { result, report } = merge([
        wordRecord({ parse: helloParse() }),
        wordRecord({ tag: 'fr', parse: otherParse }),
        wordRecord({ tag: 'de', parse: otherParse }),
      ]);

      expect(result.tokenAnalyses).toHaveLength(2);
      expect(result.tokenAnalyses[1].morphemes?.map((m) => m.form)).toStrictEqual(['he', 'llo']);
      expect(report.merge.parseConflicts).toBe(1);
      expect(result.tokenAnalysisLinks.map((l) => l.status)).toStrictEqual([
        'approved',
        'candidate',
      ]);
      expect(report.merge.approvedDemotedToCandidate).toBe(1);
    });

    it('demotes a second would-be-approved record on one token to candidate', () => {
      const { result, report } = merge([
        wordRecord(),
        wordRecord({
          word: {
            key: { Type: 'Word', Form: 'other' },
            keyId: 'Word:other',
            senseId: 'S9',
            glossText: 'x',
          },
        }),
      ]);

      expect(result.tokenAnalysisLinks.map((l) => l.status)).toStrictEqual([
        'approved',
        'candidate',
      ]);
      expect(result.tokenAnalyses.map((a) => a.id)).toStrictEqual([
        'pt9:ta:GEN 1:1:0:0',
        'pt9:ta:GEN 1:1:0:1',
      ]);
      expect(report.merge.approvedDemotedToCandidate).toBe(1);
    });
  });

  describe('parse-only fusion', () => {
    it('fuses a parse-only contribution onto the word record sharing its parse', () => {
      const { result } = merge([
        wordRecord({ parse: helloParse() }),
        wordRecord({ tag: 'fr', word: undefined, parse: helloParse(['P1', undefined]) }),
      ]);

      expect(result.tokenAnalyses).toHaveLength(1);
      expect(result.tokenAnalyses[0].morphemes).toHaveLength(2);
    });

    it('fuses a parse-only contribution onto the sole word record lacking a parse', () => {
      const { result } = merge([
        wordRecord(),
        wordRecord({ tag: 'fr', word: undefined, parse: helloParse() }),
      ]);

      expect(result.tokenAnalyses).toHaveLength(1);
      expect(result.tokenAnalyses[0].gloss).toStrictEqual({ en: 'greeting' });
      expect(result.tokenAnalyses[0].morphemes?.map((m) => m.form)).toStrictEqual(['hell', 'o']);
    });

    it('keeps a parse-only record standalone when the fuse target is ambiguous', () => {
      const { result } = merge([
        wordRecord(),
        wordRecord({
          word: { key: { Type: 'Word', Form: 'other' }, keyId: 'Word:other', senseId: undefined },
        }),
        wordRecord({ tag: 'fr', word: undefined, parse: helloParse() }),
      ]);

      expect(result.tokenAnalyses).toHaveLength(3);
      const standalone = result.tokenAnalyses[2];
      expect(standalone.gloss).toBeUndefined();
      expect(standalone.morphemes).toHaveLength(2);
    });

    it('merges two parse-only contributions with the same signature', () => {
      const { result } = merge([
        wordRecord({ word: undefined, parse: helloParse() }),
        wordRecord({ tag: 'fr', word: undefined, parse: helloParse() }),
      ]);

      expect(result.tokenAnalyses).toHaveLength(1);
    });
  });

  describe('sense and gloss resolution', () => {
    it('sets glossSenseRef only for a unanimous sense the resolver can resolve', () => {
      const resolver = fakeResolver({}, { 'Word:hello#S1': 'sense-guid' });
      const unanimousMerge = merge([wordRecord(), wordRecord({ tag: 'fr' })], [], resolver);
      expect(unanimousMerge.result.tokenAnalyses[0].glossSenseRef).toStrictEqual({
        senseId: 'sense-guid',
      });
      expect(unanimousMerge.report.senses.senseRefsResolved).toBe(1);

      const contested = merge(
        [
          wordRecord(),
          wordRecord({
            tag: 'fr',
            word: { key: HELLO_KEY, keyId: 'Word:hello', senseId: 'S2', glossText: 'salut' },
          }),
        ],
        [],
        resolver,
      );
      expect(contested.result.tokenAnalyses[0].glossSenseRef).toBeUndefined();
      expect(contested.report.senses.senseRefsResolved).toBe(0);
      expect(contested.report.senses.senseRefsUnresolved).toBe(0);
    });

    it('counts an attempted but unresolved sense ref', () => {
      const { result, report } = merge([wordRecord()]);
      expect(result.tokenAnalyses[0].glossSenseRef).toBeUndefined();
      expect(report.senses.senseRefsUnresolved).toBe(1);
    });

    it('resolves morpheme entry and sense refs through the resolver and counts outcomes', () => {
      const resolver = fakeResolver(
        { 'Stem:hell': 'entry-guid' },
        { 'Stem:hell#P1': 'morph-sense-guid' },
      );
      const { result, report } = merge(
        [wordRecord({ word: undefined, parse: helloParse(['P1', undefined]) })],
        [],
        resolver,
      );

      const { morphemes } = result.tokenAnalyses[0];
      expect(morphemes?.[0].entryRef).toStrictEqual({ entryId: 'entry-guid' });
      expect(morphemes?.[0].senseRef).toStrictEqual({ senseId: 'morph-sense-guid' });
      expect(morphemes?.[1].entryRef).toBeUndefined();
      expect(morphemes?.[1].senseRef).toBeUndefined();
      expect(report.senses.entryRefsResolved).toBe(1);
      expect(report.senses.entryRefsUnresolved).toBe(1);
    });

    it('builds morpheme glosses per language and marks ambiguous anchors low confidence', () => {
      const withGlosses = {
        lexemes: [
          {
            key: { Type: 'Stem', Form: 'hell' },
            keyId: 'Stem:hell',
            senseId: undefined,
            glossText: 'inferno',
          },
          { key: { Type: 'Suffix', Form: 'o' }, keyId: 'Suffix:o', senseId: undefined },
        ],
        signature: 'Stem:hell/Suffix:o',
      };
      const { result } = merge([
        wordRecord({ word: undefined, parse: withGlosses, ambiguous: true }),
      ]);

      expect(result.tokenAnalyses[0].morphemes?.[0].gloss).toStrictEqual({ en: 'inferno' });
      expect(result.tokenAnalyses[0].morphemes?.[1].gloss).toBeUndefined();
      expect(result.tokenAnalysisLinks[0].confidence).toBe('low');
    });
  });

  it('collects converted parse identities for bare-payload dedupe', () => {
    const { result } = merge([wordRecord({ tokenSurface: 'Hello', parse: helloParse() })]);
    expect(result.clusterParseIdentities).toStrictEqual(new Set(['hello|Stem:hell/Suffix:o']));
  });
});

describe('mergeLanguageAnalyses - phrases', () => {
  const phraseRecord = (overrides: Partial<LangPhraseRecord> = {}): LangPhraseRecord => ({
    tag: 'en',
    phrase: {
      key: { Type: 'Phrase', Form: 'in the' },
      keyId: 'Phrase:in the',
      senseId: 'S5',
      glossText: 'in',
    },
    tokens: [
      { ref: 'GEN 1:1:0', surface: 'in' },
      { ref: 'GEN 1:1:3', surface: 'the' },
    ],
    status: 'approved',
    ambiguous: false,
    ...overrides,
  });

  it('emits a phrase payload and link with joined surface and snapshots', () => {
    const { result } = merge([], [phraseRecord()]);

    expect(result.phraseAnalyses).toStrictEqual([
      {
        id: 'pt9:pa:GEN 1:1:0:0',
        createdAt: STAMP,
        updatedAt: STAMP,
        surfaceText: 'in the',
        producer: 'pt9-import',
        gloss: { en: 'in' },
      },
    ]);
    expect(result.phraseAnalysisLinks).toStrictEqual([
      {
        analysisId: 'pt9:pa:GEN 1:1:0:0',
        createdAt: STAMP,
        updatedAt: STAMP,
        status: 'approved',
        tokens: [
          { tokenRef: 'GEN 1:1:0', surfaceText: 'in' },
          { tokenRef: 'GEN 1:1:3', surfaceText: 'the' },
        ],
      },
    ]);
  });

  it('merges same-phrase contributions across languages and resolves a unanimous sense', () => {
    const resolver = fakeResolver({}, { 'Phrase:in the#S5': 'phrase-sense' });
    const { result } = merge(
      [],
      [
        phraseRecord(),
        phraseRecord({
          tag: 'fr',
          phrase: {
            key: { Type: 'Phrase', Form: 'in the' },
            keyId: 'Phrase:in the',
            senseId: 'S5',
            glossText: 'dans',
          },
        }),
      ],
      resolver,
    );

    expect(result.phraseAnalyses).toHaveLength(1);
    expect(result.phraseAnalyses[0].gloss).toStrictEqual({ en: 'in', fr: 'dans' });
    expect(result.phraseAnalyses[0].senseRef).toStrictEqual({ senseId: 'phrase-sense' });
  });

  it('demotes a second approved phrase overlapping an approved one and flags ambiguity', () => {
    const overlapping = phraseRecord({
      phrase: {
        key: { Type: 'Phrase', Form: 'the book' },
        keyId: 'Phrase:the book',
        senseId: undefined,
      },
      tokens: [
        { ref: 'GEN 1:1:3', surface: 'the' },
        { ref: 'GEN 1:1:7', surface: 'book' },
      ],
      ambiguous: true,
    });
    const { result, report } = merge([], [phraseRecord(), overlapping]);

    expect(result.phraseAnalysisLinks.map((l) => l.status)).toStrictEqual([
      'approved',
      'candidate',
    ]);
    expect(result.phraseAnalysisLinks[1].confidence).toBe('low');
    expect(report.merge.approvedDemotedToCandidate).toBe(1);
    expect(result.phraseAnalyses[1].gloss).toBeUndefined();
  });

  it('numbers several phrases at one first token sequentially', () => {
    const second = phraseRecord({
      phrase: { key: { Type: 'Phrase', Form: 'in' }, keyId: 'Phrase:in', senseId: undefined },
      tokens: [{ ref: 'GEN 1:1:0', surface: 'in' }],
      status: 'suggested',
    });
    const { result } = merge([], [phraseRecord(), second]);

    expect(result.phraseAnalyses.map((a) => a.id)).toStrictEqual([
      'pt9:pa:GEN 1:1:0:0',
      'pt9:pa:GEN 1:1:0:1',
    ]);
  });

  it('keeps rejected and mixed phrase statuses by the agreement rule', () => {
    const rejected = merge([], [phraseRecord({ status: 'rejected' })]);
    expect(rejected.result.phraseAnalysisLinks[0].status).toBe('rejected');

    const mixed = merge(
      [],
      [phraseRecord({ status: 'rejected' }), phraseRecord({ tag: 'fr', status: 'approved' })],
    );
    expect(mixed.result.phraseAnalysisLinks[0].status).toBe('suggested');
  });
});
