/// <reference types="jest" />

import {
  draftAnalysisKey,
  draftJournalKey,
  draftKey,
  projectKey,
} from '../../services/storageKeys';

describe('projectKey', () => {
  it('keys a project by its id', () => {
    expect(projectKey('abc')).toBe('project:abc');
  });
});

describe('draftKey', () => {
  it('keys a draft by its source project', () => {
    expect(draftKey('src-1')).toBe('draft:src-1');
  });
});

describe('draftAnalysisKey', () => {
  it("keys one book's analysis shard under its draft", () => {
    expect(draftAnalysisKey('src-1', 'GEN')).toBe('draft:src-1:analysis:GEN');
  });
});

describe('draftJournalKey', () => {
  it("keys a draft's shard journal under its draft", () => {
    expect(draftJournalKey('src-1')).toBe('draft:src-1:shards');
  });
});
