/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import {
  approveAnalysisForToken as approveCommand,
  writeGloss as writeGlossCommand,
} from '../../../services/commands/tokenCommands';
import { approveAnalysisForToken, writeGloss } from '../../../store/analysisSlice';
import { emptyAnalysis } from '../../../types/empty-factories';
import { FIXTURE_STAMPS } from '../../test-helpers';
import { runParity } from './parity';

const NOW = '2026-06-01T00:00:00.000Z';
const EARLIER = { createdAt: '2025-06-01T00:00:00.000Z', updatedAt: '2025-06-01T00:00:00.000Z' };
const LATER = { createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' };

function payload(id: string, surfaceText: string, fields: Partial<TokenAnalysis> = {}) {
  return { id, ...FIXTURE_STAMPS, surfaceText, ...fields };
}

function link(
  id: string,
  analysisId: string,
  tokenRef: string,
  fields: Partial<TokenAnalysisLink> = {},
): TokenAnalysisLink {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'in' },
    ...fields,
  };
}

function analysisOf(
  tokenAnalyses: TokenAnalysis[],
  tokenAnalysisLinks: TokenAnalysisLink[],
): TextAnalysis {
  return { ...emptyAnalysis(), tokenAnalyses, tokenAnalysisLinks };
}

const TOKEN = 'GEN 1:1:0';
const OTHER_TOKEN = 'GEN 1:2:0';

type ParityCase<Input> = {
  analysis: TextAnalysis;
  input: Input;
  /** What the reducer's result must show, so the case exercises the path it names. */
  expectStore: (store: TextAnalysis) => void;
};

type GlossInput = { surfaceText?: string; value: string };

const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

describe('writeGloss parity with the reducer', () => {
  const cases: [string, ParityCase<GlossInput>][] = [
    [
      'creates a payload and an approved link for an unglossed token',
      {
        analysis: emptyAnalysis(),
        input: { value: 'at' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['new-analysis']);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['new-link']);
        },
      },
    ],
    [
      'shares a stored payload whose content matches',
      {
        analysis: analysisOf(
          [payload('ta-in', 'in', { gloss: { en: 'at' } })],
          [link('tl-other', 'ta-in', OTHER_TOKEN)],
        ),
        input: { value: 'at' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-in']);
          expect(store.tokenAnalysisLinks.find(({ id }) => id === 'new-link')?.analysisId).toBe(
            'ta-in',
          );
        },
      },
    ],
    [
      "approves the token's held link to the matching payload rather than adding one",
      {
        analysis: analysisOf(
          [payload('ta-in', 'in', { gloss: { en: 'at' } })],
          [link('tl-held', 'ta-in', TOKEN, { status: 'suggested', confidence: 'low' })],
        ),
        input: { value: 'at' },
        expectStore: (store) => {
          expect(store.tokenAnalysisLinks).toHaveLength(1);
          expect(store.tokenAnalysisLinks[0].status).toBe('approved');
        },
      },
    ],
    [
      'edits an unshared payload in place, refreshing surface text and keeping its sense',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              gloss: { en: 'at', fr: 'à' },
              glossSenseRef: { authority: 'fwlite', senseId: 's-at' },
            }),
          ],
          [link('tl-in', 'ta-in', TOKEN)],
        ),
        input: { surfaceText: 'In,', value: 'at first' },
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([
            payload('ta-in', 'In,', {
              gloss: { en: 'at first', fr: 'à' },
              glossSenseRef: { authority: 'fwlite', senseId: 's-at' },
              updatedAt: NOW,
            }),
          ]);
        },
      },
    ],
    [
      'forks a payload other tokens share, editing only the fork',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-in', 'ta-in', TOKEN), link('tl-other', 'ta-in', OTHER_TOKEN)],
        ),
        input: { value: 'start' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['new-analysis', 'ta-in']);
        },
      },
    ],
    [
      "folds an edit matching another payload into it, clearing the survivor's stale breakdown",
      {
        analysis: analysisOf(
          [
            payload('ta-at', 'in', { gloss: { en: 'at' } }),
            payload('ta-within', 'In', {
              ...EARLIER,
              gloss: { en: 'within' },
              morphemesStale: true,
            }),
          ],
          [link('tl-in', 'ta-at', TOKEN), link('tl-other', 'ta-within', OTHER_TOKEN)],
        ),
        input: { value: 'within' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-within']);
          expect(store.tokenAnalyses[0].morphemesStale).toBeUndefined();
        },
      },
    ],
    [
      'leaves a token linking both folded payloads one link, dated by the earlier',
      {
        analysis: analysisOf(
          [
            payload('ta-at', 'In', { gloss: { en: 'at' } }),
            payload('ta-within', 'In', { ...EARLIER, gloss: { en: 'within' } }),
          ],
          [
            link('tl-in', 'ta-at', TOKEN, LATER),
            link('tl-offered', 'ta-within', TOKEN, { ...EARLIER, status: 'suggested' }),
          ],
        ),
        input: { value: 'within' },
        expectStore: (store) => {
          expect(store.tokenAnalysisLinks).toHaveLength(1);
          expect(store.tokenAnalysisLinks[0]).toMatchObject({
            id: 'tl-in',
            status: 'approved',
            createdAt: EARLIER.createdAt,
          });
        },
      },
    ],
    [
      'folds into a payload another token was offered, leaving that offer as it was',
      {
        analysis: analysisOf(
          [
            payload('ta-at', 'In', { gloss: { en: 'at' } }),
            payload('ta-within', 'In', { ...EARLIER, gloss: { en: 'within' } }),
          ],
          [
            link('tl-in', 'ta-at', TOKEN),
            link('tl-offered', 'ta-within', OTHER_TOKEN, { status: 'suggested' }),
          ],
        ),
        input: { value: 'within' },
        expectStore: (store) => {
          expect(store.tokenAnalysisLinks).toStrictEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: 'tl-offered', status: 'suggested' }),
            ]),
          );
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-within']);
        },
      },
    ],
    [
      'clears the gloss, removing the payload it empties and its link',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-in', 'ta-in', TOKEN)],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
    [
      'clears one language, keeping the others and the sense',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              gloss: { en: 'at', fr: 'à' },
              glossSenseRef: { authority: 'fwlite', senseId: 's-at' },
            }),
          ],
          [link('tl-in', 'ta-in', TOKEN)],
        ),
        input: { value: '  ' },
        expectStore: (store) => {
          expect(store.tokenAnalyses[0].gloss).toStrictEqual({ fr: 'à' });
          expect(store.tokenAnalyses[0].glossSenseRef).toBeDefined();
        },
      },
    ],
    [
      'clears the last language, keeping the sense and the approval',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', {
              gloss: { en: 'at' },
              glossSenseRef: { authority: 'fwlite', senseId: 's-at' },
            }),
          ],
          [link('tl-in', 'ta-in', TOKEN)],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(store.tokenAnalyses).toHaveLength(1);
          expect(store.tokenAnalyses[0].gloss).toBeUndefined();
          expect(store.tokenAnalyses[0].glossSenseRef).toStrictEqual({
            authority: 'fwlite',
            senseId: 's-at',
          });
          expect(store.tokenAnalysisLinks[0].status).toBe('approved');
        },
      },
    ],
    [
      'clears a shared payload by dropping only this token’s link',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-in', 'ta-in', TOKEN), link('tl-other', 'ta-in', OTHER_TOKEN)],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-in']);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-other']);
        },
      },
    ],
    [
      'keeps an emptied payload another of the token’s links still names',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [
            link('tl-in', 'ta-in', TOKEN),
            link('tl-rejected', 'ta-in', TOKEN, { status: 'rejected' }),
          ],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(store.tokenAnalyses).toStrictEqual([payload('ta-in', 'In', { updatedAt: NOW })]);
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-rejected']);
        },
      },
    ],
    [
      'folds a cleared payload into another its remaining content matches',
      {
        analysis: analysisOf(
          [
            payload('ta-in', 'In', { gloss: { en: 'at' }, pos: 'prep' }),
            payload('ta-bare', 'in', { ...EARLIER, pos: 'prep' }),
          ],
          [link('tl-in', 'ta-in', TOKEN)],
        ),
        input: { value: '' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-bare']);
          expect(store.tokenAnalysisLinks[0].analysisId).toBe('ta-bare');
        },
      },
    ],
    [
      'folds a fork back onto the shared payload when the write leaves it unchanged',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-in', 'ta-in', TOKEN), link('tl-other', 'ta-in', OTHER_TOKEN)],
        ),
        input: { value: 'at' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-in']);
          expect(store.tokenAnalysisLinks.every(({ analysisId }) => analysisId === 'ta-in')).toBe(
            true,
          );
        },
      },
    ],
    [
      'edits the payload an approval tie picks among several approved links',
      {
        analysis: analysisOf(
          [
            payload('ta-old', 'In', { gloss: { en: 'old' } }),
            payload('ta-new', 'In', { gloss: { en: 'new' } }),
          ],
          [link('tl-old', 'ta-old', TOKEN, EARLIER), link('tl-new', 'ta-new', TOKEN, LATER)],
        ),
        input: { value: 'newer' },
        expectStore: (store) => {
          expect(store.tokenAnalyses.find(({ id }) => id === 'ta-new')?.gloss).toStrictEqual({
            en: 'newer',
          });
        },
      },
    ],
    [
      'stages nothing for a blank write to an unglossed token',
      {
        analysis: analysisOf([payload('ta-in', 'In', { gloss: { en: 'at' } })], []),
        input: { value: '' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-in']);
        },
      },
    ],
    [
      'removes an approved link whose payload is gone before writing',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN)]),
        input: { value: 'at' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['new-link']);
        },
      },
    ],
    [
      'removes an approved link whose payload is gone even on a blank write',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN)]),
        input: { value: '' },
        expectStore: (store) => {
          expect(store).toStrictEqual(emptyAnalysis());
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectStore }) => {
    const surfaceText = input.surfaceText ?? 'In';
    const outcome = await runParity(
      analysis,
      'en',
      {
        type: writeGloss.type,
        payload: {
          tokenRef: TOKEN,
          surfaceText,
          value: input.value,
          id: 'new-analysis',
          linkId: 'new-link',
          now: NOW,
        },
      },
      (buffer) =>
        writeGlossCommand(buffer, {
          tokenRef: TOKEN,
          surfaceText,
          value: input.value,
          analysisLanguage: 'en',
          analysisId: 'new-analysis',
          linkId: 'new-link',
          now: NOW,
        }),
    );

    expectStore(outcome.store);
    expect(outcome.host).toStrictEqual(outcome.store);
    expect(outcome.indexDifferences).toStrictEqual([]);
  });
});

type ApproveInput = { analysisId: string };

describe('approveAnalysisForToken parity with the reducer', () => {
  const cases: [string, ParityCase<ApproveInput>][] = [
    [
      'gives a token with no approval a new approved link',
      {
        analysis: analysisOf([payload('ta-in', 'In', { gloss: { en: 'at' } })], []),
        input: { analysisId: 'ta-in' },
        expectStore: (store) => {
          expect(store.tokenAnalysisLinks).toStrictEqual([
            {
              id: 'new-link',
              analysisId: 'ta-in',
              createdAt: NOW,
              updatedAt: NOW,
              status: 'approved',
              token: { tokenRef: TOKEN, surfaceText: 'In' },
            },
          ]);
        },
      },
    ],
    [
      'approves the link the token holds to the payload rather than adding one',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-held', 'ta-in', TOKEN, { status: 'candidate', confidence: 'guess' })],
        ),
        input: { analysisId: 'ta-in' },
        expectStore: (store) => {
          expect(store.tokenAnalysisLinks).toHaveLength(1);
          expect(store.tokenAnalysisLinks[0]).toMatchObject({
            status: 'approved',
            confidence: 'guess',
          });
        },
      },
    ],
    [
      'moves the approval off a payload, removing it once nothing links it',
      {
        analysis: analysisOf(
          [
            payload('ta-at', 'In', { gloss: { en: 'at' } }),
            payload('ta-on', 'In', { gloss: { en: 'on' } }),
          ],
          [link('tl-in', 'ta-at', TOKEN)],
        ),
        input: { analysisId: 'ta-on' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-on']);
          expect(store.tokenAnalysisLinks[0].analysisId).toBe('ta-on');
        },
      },
    ],
    [
      'keeps the payload the approval leaves when another token links it',
      {
        analysis: analysisOf(
          [
            payload('ta-at', 'In', { gloss: { en: 'at' } }),
            payload('ta-on', 'In', { gloss: { en: 'on' } }),
          ],
          [link('tl-in', 'ta-at', TOKEN), link('tl-other', 'ta-at', OTHER_TOKEN)],
        ),
        input: { analysisId: 'ta-on' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-at', 'ta-on']);
        },
      },
    ],
    [
      'approves a held link in place of the approval, keeping the earlier creation date',
      {
        analysis: analysisOf(
          [
            payload('ta-at', 'In', { gloss: { en: 'at' } }),
            payload('ta-on', 'In', { gloss: { en: 'on' } }),
          ],
          [
            link('tl-in', 'ta-at', TOKEN, EARLIER),
            link('tl-held', 'ta-on', TOKEN, { ...LATER, status: 'suggested' }),
          ],
        ),
        input: { analysisId: 'ta-on' },
        expectStore: (store) => {
          expect(store.tokenAnalysisLinks).toStrictEqual([
            expect.objectContaining({
              id: 'tl-held',
              status: 'approved',
              createdAt: EARLIER.createdAt,
            }),
          ]);
          expect(ids(store.tokenAnalyses)).toStrictEqual(['ta-on']);
        },
      },
    ],
    [
      'stages nothing for a payload not stored',
      {
        analysis: analysisOf([], [link('tl-orphan', 'ta-missing', TOKEN)]),
        input: { analysisId: 'ta-unknown' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-orphan']);
        },
      },
    ],
    [
      'removes orphaned approvals even when the payload is already approved',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-in', 'ta-in', TOKEN, LATER), link('tl-orphan', 'ta-missing', TOKEN, EARLIER)],
        ),
        input: { analysisId: 'ta-in' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['tl-in']);
        },
      },
    ],
    [
      'removes orphaned approvals before approving',
      {
        analysis: analysisOf(
          [payload('ta-in', 'In', { gloss: { en: 'at' } })],
          [link('tl-orphan', 'ta-missing', TOKEN)],
        ),
        input: { analysisId: 'ta-in' },
        expectStore: (store) => {
          expect(ids(store.tokenAnalysisLinks)).toStrictEqual(['new-link']);
        },
      },
    ],
  ];

  it.each(cases)('%s', async (_name, { analysis, input, expectStore }) => {
    const outcome = await runParity(
      analysis,
      'en',
      {
        type: approveAnalysisForToken.type,
        payload: {
          tokenRef: TOKEN,
          surfaceText: 'In',
          analysisId: input.analysisId,
          linkId: 'new-link',
          now: NOW,
        },
      },
      (buffer) =>
        approveCommand(buffer, {
          tokenRef: TOKEN,
          surfaceText: 'In',
          analysisId: input.analysisId,
          linkId: 'new-link',
          now: NOW,
        }),
    );

    expectStore(outcome.store);
    expect(outcome.host).toStrictEqual(outcome.store);
    expect(outcome.indexDifferences).toStrictEqual([]);
  });
});
