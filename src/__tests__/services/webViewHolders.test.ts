/// <reference types="jest" />

import { WebViewHolders } from '../../services/webViewHolders';

const projectId = 'project-1';

let holders: WebViewHolders;

beforeEach(() => {
  holders = new WebViewHolders();
});

describe('claim', () => {
  it('gives the project to the first tab it serves for it', () => {
    expect(holders.claim(projectId, 'tab-a')).toBeUndefined();
    expect(holders.holderOf(projectId)).toBe('tab-a');
  });

  it('turns a second tab away as a duplicate of the holder', () => {
    holders.claim(projectId, 'tab-a');

    expect(holders.claim(projectId, 'tab-b')).toBe('tab-a');
    expect(holders.holderOf(projectId)).toBe('tab-a');
  });

  it('keeps the project on a holder served again', () => {
    holders.claim(projectId, 'tab-a');

    expect(holders.claim(projectId, 'tab-a')).toBeUndefined();
    expect(holders.holderOf(projectId)).toBe('tab-a');
  });

  it('stops counting a duplicate as one once it claims the project', () => {
    holders.claim(projectId, 'tab-a');
    holders.claim(projectId, 'tab-b');
    holders.release(projectId, 'tab-a');
    holders.claim(projectId, 'tab-b');

    expect(holders.release(projectId, 'tab-b')).toStrictEqual({ successor: undefined });
  });
});

describe('hold', () => {
  it('gives the project to a tab when no tab holds it', () => {
    expect(holders.hold(projectId, 'tab-a')).toBe(true);
    expect(holders.holderOf(projectId)).toBe('tab-a');
  });

  it('turns a tab away without keeping it as a duplicate', () => {
    holders.claim(projectId, 'tab-a');

    expect(holders.hold(projectId, 'tab-b')).toBe(false);
    expect(holders.release(projectId, 'tab-a')).toStrictEqual({ successor: undefined });
  });
});

describe('release', () => {
  it('names the first duplicate to take the project over when the holder closes', () => {
    holders.claim(projectId, 'tab-a');
    holders.claim(projectId, 'tab-b');
    holders.claim(projectId, 'tab-c');

    expect(holders.release(projectId, 'tab-a')).toStrictEqual({ successor: 'tab-b' });
    expect(holders.holderOf(projectId)).toBeUndefined();
  });

  it('keeps a named successor a duplicate until it claims the project', () => {
    holders.claim(projectId, 'tab-a');
    holders.claim(projectId, 'tab-b');
    holders.release(projectId, 'tab-a');
    holders.claim(projectId, 'tab-c');

    expect(holders.release(projectId, 'tab-c')).toStrictEqual({ successor: 'tab-b' });
  });

  it('keeps the project on its holder when a duplicate closes', () => {
    holders.claim(projectId, 'tab-a');
    holders.claim(projectId, 'tab-b');

    expect(holders.release(projectId, 'tab-b')).toBeUndefined();
    expect(holders.holderOf(projectId)).toBe('tab-a');
  });

  it('forgets a duplicate that closes', () => {
    holders.claim(projectId, 'tab-a');
    holders.claim(projectId, 'tab-b');
    holders.release(projectId, 'tab-b');

    expect(holders.release(projectId, 'tab-a')).toStrictEqual({ successor: undefined });
  });
});

describe('clear', () => {
  it('forgets every holder and duplicate', () => {
    holders.claim(projectId, 'tab-a');
    holders.claim(projectId, 'tab-b');

    holders.clear();

    expect(holders.holderOf(projectId)).toBeUndefined();
    expect(holders.claim(projectId, 'tab-c')).toBeUndefined();
    expect(holders.release(projectId, 'tab-c')).toStrictEqual({ successor: undefined });
  });
});
