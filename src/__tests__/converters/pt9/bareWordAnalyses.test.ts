/// <reference types="jest" />

import type { Pt9Lexicon, Pt9WordParse } from 'platform-scripture';
import { buildBareWordAnalyses } from '../../../converters/pt9/bareWordAnalyses';
import {
  Pt9LexiconResolver,
  unresolvedPt9LexiconResolver,
} from '../../../converters/pt9/lexiconResolver';
import { createPt9GlossSource } from '../../../converters/pt9/pt9GlossSource';
import { emptyPt9ImportReport } from '../../../converters/pt9/report';

const STAMP = '2026-08-01T00:00:00.000Z';

const LEXICON: Pt9Lexicon = {
  entries: [
    {
      id: 'Stem:hello',
      type: 'Stem',
      form: 'hello',
      homograph: 1,
      senses: [{ id: 'SG', glosses: [{ language: 'en', text: 'greet' }] }],
    },
  ],
  legacyAnalyses: [{ word: 'legacy', analyses: [['Stem:lega', 'Suffix:cy']] }],
};

function build(args: {
  wordAnalyses?: Pt9WordParse[];
  lexicon?: Pt9Lexicon;
  languages?: { raw: string; tag: string }[];
  resolver?: Pt9LexiconResolver;
  clusterParseIdentities?: Set<string>;
}) {
  const report = emptyPt9ImportReport();
  const payloads = buildBareWordAnalyses({
    wordAnalyses: args.wordAnalyses ?? [],
    lexicon: args.lexicon,
    languages: args.languages ?? [{ raw: 'en', tag: 'en' }],
    glossSource: createPt9GlossSource(args.lexicon),
    resolver: args.resolver ?? unresolvedPt9LexiconResolver,
    clusterParseIdentities: args.clusterParseIdentities ?? new Set(),
    writingSystem: 'grc',
    importedAt: STAMP,
    report,
  });
  return { payloads, report };
}

describe('buildBareWordAnalyses', () => {
  it('builds an unlinked payload per wordform analysis with DefaultSingle morpheme glosses', () => {
    const { payloads, report } = build({
      wordAnalyses: [{ word: 'helloing', analyses: [['Stem:hello', 'Suffix:ing']] }],
      lexicon: { ...LEXICON, legacyAnalyses: [] },
    });

    expect(payloads).toStrictEqual([
      {
        id: 'pt9:wa:helloing:0',
        createdAt: STAMP,
        updatedAt: STAMP,
        surfaceText: 'helloing',
        producer: 'pt9-import:word-analyses',
        morphemes: [
          { id: 'm0', form: 'hello', writingSystem: 'grc', gloss: { en: 'greet' } },
          { id: 'm1', form: 'ing', writingSystem: 'grc' },
        ],
      },
    ]);
    expect(report.barePayloads.added).toBe(1);
    expect(report.senses.entryRefsUnresolved).toBe(2);
  });

  it('includes the legacy lexicon analyses after the newer inventory', () => {
    const { payloads } = build({
      wordAnalyses: [{ word: 'helloing', analyses: [['Stem:hello', 'Suffix:ing']] }],
      lexicon: LEXICON,
    });

    expect(payloads.map((p) => p.surfaceText)).toStrictEqual(['helloing', 'legacy']);
  });

  it('dedupes an identical analysis appearing in both inventories, homograph 1 suffixes normalized', () => {
    const { payloads } = build({
      wordAnalyses: [{ word: 'legacy', analyses: [['Stem:lega', 'Suffix:cy']] }],
      lexicon: {
        entries: [],
        legacyAnalyses: [{ word: 'legacy', analyses: [['Stem:lega:1', 'Suffix:cy:1']] }],
      },
    });

    expect(payloads).toHaveLength(1);
  });

  it('numbers several analyses of one wordform sequentially', () => {
    const { payloads } = build({
      wordAnalyses: [{ word: 'abe', analyses: [['Stem:ab', 'Suffix:e'], ['Stem:abe']] }],
    });

    expect(payloads.map((p) => p.id)).toStrictEqual(['pt9:wa:abe:0', 'pt9:wa:abe:1']);
  });

  it('skips an analysis identical to a converted cluster parse', () => {
    const { payloads, report } = build({
      wordAnalyses: [{ word: 'Abe', analyses: [['Stem:ab', 'Suffix:e']] }],
      clusterParseIdentities: new Set(['abe|Stem:ab/Suffix:e']),
    });

    expect(payloads).toHaveLength(0);
    expect(report.barePayloads.skippedExistingIdentical).toBe(1);
  });

  it('drops an analysis with an unparseable lexeme id', () => {
    const { payloads, report } = build({
      wordAnalyses: [{ word: 'x', analyses: [['garbage']] }],
    });

    expect(payloads).toHaveLength(0);
    expect(report.barePayloads.droppedUnparseable).toBe(1);
  });

  it('drops an analysis with no lexemes at all', () => {
    const { payloads, report } = build({
      wordAnalyses: [{ word: 'x', analyses: [[]] }],
    });

    expect(payloads).toHaveLength(0);
    expect(report.barePayloads.droppedEmpty).toBe(1);
  });

  it('resolves a sense ref when every language finding a default agrees on it', () => {
    const resolver: Pt9LexiconResolver = {
      resolveEntry: (key) => ({ authority: 'test', entryId: `entry-${key.Form}` }),
      resolveSense: (_key, senseId) => ({ authority: 'test', senseId: `guid-${senseId}` }),
    };
    const { payloads, report } = build({
      wordAnalyses: [{ word: 'helloing', analyses: [['Stem:hello']] }],
      lexicon: LEXICON,
      // No default exists in fr; en finds SG, so SG is the only sense id in the set.
      languages: [
        { raw: 'en', tag: 'en' },
        { raw: 'fr', tag: 'fr' },
      ],
      resolver,
    });

    expect(payloads[0].morphemes?.[0].senseRef).toStrictEqual({
      authority: 'test',
      senseId: 'guid-SG',
    });
    expect(report.senses.senseRefsResolved).toBe(1);
  });

  it('attempts no sense ref when languages default to different senses', () => {
    const resolver: Pt9LexiconResolver = {
      resolveEntry: () => undefined,
      resolveSense: (_key, senseId) => ({ authority: 'test', senseId: `guid-${senseId}` }),
    };
    const { payloads, report } = build({
      wordAnalyses: [{ word: 'helloing', analyses: [['Stem:hello']] }],
      lexicon: {
        entries: [
          {
            id: 'Stem:hello',
            type: 'Stem',
            form: 'hello',
            homograph: 1,
            senses: [
              { id: 'SEN', glosses: [{ language: 'en', text: 'greet' }] },
              { id: 'SFR', glosses: [{ language: 'fr', text: 'saluer' }] },
            ],
          },
        ],
        legacyAnalyses: [],
      },
      languages: [
        { raw: 'en', tag: 'en' },
        { raw: 'fr', tag: 'fr' },
      ],
      resolver,
    });

    expect(payloads[0].morphemes?.[0].senseRef).toBeUndefined();
    expect(report.senses.senseRefsResolved).toBe(0);
    expect(report.senses.senseRefsUnresolved).toBe(0);
  });

  it('keeps the first gloss when two raw languages share one tag', () => {
    const { payloads } = build({
      wordAnalyses: [{ word: 'helloing', analyses: [['Stem:hello']] }],
      lexicon: {
        entries: [
          {
            id: 'Stem:hello',
            type: 'Stem',
            form: 'hello',
            homograph: 1,
            senses: [
              {
                id: 'SG',
                glosses: [
                  { language: 'English', text: 'first' },
                  { language: 'ENGLISH2', text: 'second' },
                ],
              },
            ],
          },
        ],
        legacyAnalyses: [],
      },
      languages: [
        { raw: 'English', tag: 'en' },
        { raw: 'ENGLISH2', tag: 'en' },
      ],
    });

    expect(payloads[0].morphemes?.[0].gloss).toStrictEqual({ en: 'first' });
  });

  it('counts an attempted but unresolved sense ref', () => {
    const { report } = build({
      wordAnalyses: [{ word: 'helloing', analyses: [['Stem:hello']] }],
      lexicon: LEXICON,
    });

    expect(report.senses.senseRefsUnresolved).toBe(1);
  });

  it('builds nothing from empty inventories', () => {
    const { payloads, report } = build({});
    expect(payloads).toStrictEqual([]);
    expect(report.barePayloads.added).toBe(0);
  });
});
