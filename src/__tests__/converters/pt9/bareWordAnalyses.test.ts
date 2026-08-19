/// <reference types="jest" />

import type { LexiconData } from 'parsers/pt9/lexiconXmlParser';
import type { WordAnalysesData } from 'parsers/pt9/wordAnalysesXmlParser';
import { buildBareWordAnalyses } from '../../../converters/pt9/bareWordAnalyses';
import {
  Pt9LexiconResolver,
  unresolvedPt9LexiconResolver,
} from '../../../converters/pt9/lexiconResolver';
import { createPt9GlossSource } from '../../../converters/pt9/pt9GlossSource';
import { emptyPt9ImportReport } from '../../../converters/pt9/report';

const STAMP = '2026-08-01T00:00:00.000Z';

const LEXICON: LexiconData = {
  Entries: [
    {
      Key: { Type: 'Stem', Form: 'hello' },
      Senses: [{ Id: 'SG', Glosses: [{ Language: 'en', Text: 'greet' }] }],
    },
  ],
  Analyses: {
    legacy: [
      { Type: 'Stem', Form: 'lega' },
      { Type: 'Suffix', Form: 'cy' },
    ],
  },
};

function build(args: {
  wordAnalyses?: WordAnalysesData;
  lexicon?: LexiconData;
  languages?: { raw: string; tag: string }[];
  resolver?: Pt9LexiconResolver;
  clusterParseIdentities?: Set<string>;
}) {
  const report = emptyPt9ImportReport();
  const payloads = buildBareWordAnalyses({
    wordAnalyses: args.wordAnalyses,
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
      wordAnalyses: {
        Entries: [{ Word: 'helloing', Analyses: [{ LexemeIds: ['Stem:hello', 'Suffix:ing'] }] }],
      },
      lexicon: { ...LEXICON, Analyses: {} },
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
      wordAnalyses: {
        Entries: [{ Word: 'helloing', Analyses: [{ LexemeIds: ['Stem:hello', 'Suffix:ing'] }] }],
      },
      lexicon: LEXICON,
    });

    expect(payloads.map((p) => p.surfaceText)).toStrictEqual(['helloing', 'legacy']);
  });

  it('dedupes an identical analysis appearing in both inventories, homograph 1 normalized', () => {
    const { payloads } = build({
      wordAnalyses: {
        Entries: [{ Word: 'legacy', Analyses: [{ LexemeIds: ['Stem:lega', 'Suffix:cy'] }] }],
      },
      lexicon: {
        Entries: [],
        Analyses: {
          legacy: [
            { Type: 'Stem', Form: 'lega', Homograph: 1 },
            { Type: 'Suffix', Form: 'cy', Homograph: 1 },
          ],
        },
      },
    });

    expect(payloads).toHaveLength(1);
  });

  it('numbers several analyses of one wordform sequentially', () => {
    const { payloads } = build({
      wordAnalyses: {
        Entries: [
          {
            Word: 'abe',
            Analyses: [{ LexemeIds: ['Stem:ab', 'Suffix:e'] }, { LexemeIds: ['Stem:abe'] }],
          },
        ],
      },
    });

    expect(payloads.map((p) => p.id)).toStrictEqual(['pt9:wa:abe:0', 'pt9:wa:abe:1']);
  });

  it('skips an analysis identical to a converted cluster parse', () => {
    const { payloads, report } = build({
      wordAnalyses: {
        Entries: [{ Word: 'Abe', Analyses: [{ LexemeIds: ['Stem:ab', 'Suffix:e'] }] }],
      },
      clusterParseIdentities: new Set(['abe|Stem:ab/Suffix:e']),
    });

    expect(payloads).toHaveLength(0);
    expect(report.barePayloads.skippedExistingIdentical).toBe(1);
  });

  it('drops an analysis with an unparseable lexeme id', () => {
    const { payloads, report } = build({
      wordAnalyses: { Entries: [{ Word: 'x', Analyses: [{ LexemeIds: ['garbage'] }] }] },
    });

    expect(payloads).toHaveLength(0);
    expect(report.barePayloads.droppedUnparseable).toBe(1);
  });

  it('drops an analysis with no lexemes at all', () => {
    const { payloads, report } = build({
      wordAnalyses: { Entries: [{ Word: 'x', Analyses: [{ LexemeIds: [] }] }] },
    });

    expect(payloads).toHaveLength(0);
    expect(report.barePayloads.droppedEmpty).toBe(1);
  });

  it('resolves a sense ref when every language finding a default agrees on it', () => {
    const resolver: Pt9LexiconResolver = {
      resolveEntry: (key) => ({ entryId: `entry-${key.Form}` }),
      resolveSense: (_key, senseId) => ({ senseId: `guid-${senseId}` }),
    };
    const { payloads, report } = build({
      wordAnalyses: { Entries: [{ Word: 'helloing', Analyses: [{ LexemeIds: ['Stem:hello'] }] }] },
      lexicon: LEXICON,
      // French abstains (no default in fr); English finds SG, so the lone vote carries.
      languages: [
        { raw: 'en', tag: 'en' },
        { raw: 'fr', tag: 'fr' },
      ],
      resolver,
    });

    expect(payloads[0].morphemes?.[0].senseRef).toStrictEqual({ senseId: 'guid-SG' });
    expect(report.senses.senseRefsResolved).toBe(1);
  });

  it('keeps the first gloss when two raw languages share one tag', () => {
    const { payloads } = build({
      wordAnalyses: { Entries: [{ Word: 'helloing', Analyses: [{ LexemeIds: ['Stem:hello'] }] }] },
      lexicon: {
        Entries: [
          {
            Key: { Type: 'Stem', Form: 'hello' },
            Senses: [
              {
                Id: 'SG',
                Glosses: [
                  { Language: 'English', Text: 'first' },
                  { Language: 'ENGLISH2', Text: 'second' },
                ],
              },
            ],
          },
        ],
        Analyses: {},
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
      wordAnalyses: { Entries: [{ Word: 'helloing', Analyses: [{ LexemeIds: ['Stem:hello'] }] }] },
      lexicon: LEXICON,
    });

    expect(report.senses.senseRefsUnresolved).toBe(1);
  });

  it('builds nothing from absent inventories', () => {
    const { payloads, report } = build({});
    expect(payloads).toStrictEqual([]);
    expect(report.barePayloads.added).toBe(0);
  });
});
