/// <reference types="jest" />

import type { TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { FIXTURE_STAMPS } from '../test-helpers';
import { preferredLink, preferredPayload, prefersLink } from '../../utils/pick-rules';

const EARLIER = '2026-01-01T00:00:00.000Z';
const LATER = '2026-02-01T00:00:00.000Z';

function link(id: string, updatedAt: string): TokenAnalysisLink {
  return {
    id,
    analysisId: 'ta-1',
    createdAt: EARLIER,
    updatedAt,
    status: 'approved',
    token: { tokenRef: 'GEN 1:1:0', surfaceText: 'word' },
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
