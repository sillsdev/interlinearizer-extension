/// <reference types="jest" />

import type { TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { FIXTURE_STAMPS } from '../test-helpers';
import {
  preferredLink,
  preferredLinkByKey,
  preferredPayload,
  prefersLink,
} from '../../utils/pick-rules';

const EARLIER = '2026-01-01T00:00:00.000Z';
const LATER = '2026-02-01T00:00:00.000Z';

function link(id: string, updatedAt: string, tokenRef = 'GEN 1:1:0'): TokenAnalysisLink {
  return {
    ...FIXTURE_STAMPS,
    id,
    analysisId: 'ta-1',
    updatedAt,
    status: 'approved',
    token: { tokenRef, surfaceText: 'word' },
  };
}

function payload(id: string, createdAt: string): TokenAnalysis {
  return { ...FIXTURE_STAMPS, id, createdAt, surfaceText: 'word' };
}

describe('prefersLink', () => {
  it('prefers the later-written link', () => {
    expect(prefersLink(link('b', LATER), link('a', EARLIER))).toBe(true);
  });

  it('does not prefer the earlier-written link', () => {
    expect(prefersLink(link('a', EARLIER), link('b', LATER))).toBe(false);
  });

  it('prefers the smaller id between links written together', () => {
    expect(prefersLink(link('a', EARLIER), link('b', EARLIER))).toBe(true);
  });

  it('does not prefer the larger id between links written together', () => {
    expect(prefersLink(link('b', EARLIER), link('a', EARLIER))).toBe(false);
  });
});

describe('preferredLink', () => {
  it('picks the latest-written link whatever the order', () => {
    const latest = link('z', LATER);

    expect(preferredLink([latest, link('a', EARLIER)])).toBe(latest);
    expect(preferredLink([link('a', EARLIER), latest])).toBe(latest);
  });

  it('picks the smallest id among links written together whatever the order', () => {
    const smallest = link('a', EARLIER);

    expect(preferredLink([link('b', EARLIER), smallest])).toBe(smallest);
    expect(preferredLink([smallest, link('b', EARLIER)])).toBe(smallest);
  });

  it('picks nothing from no links', () => {
    expect(preferredLink([])).toBeUndefined();
  });
});

describe('preferredLinkByKey', () => {
  const byToken = (l: TokenAnalysisLink) => l.token.tokenRef;

  it('picks the preferred link for each key whatever the order', () => {
    const first = link('a', LATER, 'GEN 1:1:0');
    const second = link('b', LATER, 'GEN 1:1:5');
    const beaten = [link('c', EARLIER, 'GEN 1:1:0'), link('d', EARLIER, 'GEN 1:1:5')];
    const expected = new Map([
      ['GEN 1:1:0', first],
      ['GEN 1:1:5', second],
    ]);

    expect(preferredLinkByKey([...beaten, first, second], byToken)).toEqual(expected);
    expect(preferredLinkByKey([first, second, ...beaten], byToken)).toEqual(expected);
  });

  it('skips a link given no key', () => {
    const kept = link('a', EARLIER);
    const skipped = link('b', LATER);

    expect(
      preferredLinkByKey([kept, skipped], (l) => (l === skipped ? undefined : byToken(l))),
    ).toEqual(new Map([['GEN 1:1:0', kept]]));
  });
});

describe('preferredPayload', () => {
  it('picks the earliest-created payload whatever the order', () => {
    const earliest = payload('z', EARLIER);

    expect(preferredPayload([payload('a', LATER), earliest])).toBe(earliest);
    expect(preferredPayload([earliest, payload('a', LATER)])).toBe(earliest);
  });

  it('picks the smallest id among payloads created together whatever the order', () => {
    const smallest = payload('a', EARLIER);

    expect(preferredPayload([payload('b', EARLIER), smallest])).toBe(smallest);
    expect(preferredPayload([smallest, payload('b', EARLIER)])).toBe(smallest);
  });

  it('picks nothing from no payloads', () => {
    expect(preferredPayload([])).toBeUndefined();
  });
});
