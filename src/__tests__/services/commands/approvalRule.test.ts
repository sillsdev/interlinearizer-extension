/// <reference types="jest" />

import type {
  PhraseAnalysisLink,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysisLink,
} from 'interlinearizer';
import { ApprovalRuleError, assertApprovalRule } from '../../../services/commands/approvalRule';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, seedRepository, silentLogger } from '../../test-helpers';

function tokenLink(
  id: string,
  status: TokenAnalysisLink['status'] = 'approved',
): TokenAnalysisLink {
  return {
    id,
    analysisId: `ta-${id}`,
    ...FIXTURE_STAMPS,
    status,
    token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
  };
}

function segmentLink(id: string): SegmentAnalysisLink {
  return {
    id,
    analysisId: `sa-${id}`,
    ...FIXTURE_STAMPS,
    status: 'approved',
    segmentId: 'GEN 1:1',
  };
}

function phraseLink(id: string, ...indexes: number[]): PhraseAnalysisLink {
  return {
    id,
    analysisId: `pa-${id}`,
    ...FIXTURE_STAMPS,
    status: 'approved',
    tokens: indexes.map((i) => ({ tokenRef: `GEN 1:1:${i}`, surfaceText: `w${i}` })),
  };
}

async function over(analysis: Partial<TextAnalysis>) {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await seedRepository(repository, {
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return { repository, buffer: new ChangeBuffer(repository) };
}

describe('assertApprovalRule', () => {
  it('accepts changes that leave each token one approval', async () => {
    const { repository, buffer } = await over({ tokenAnalysisLinks: [tokenLink('a')] });

    buffer.delete('tokenAnalysisLinks', tokenLink('a'));
    buffer.create('tokenAnalysisLinks', tokenLink('b'));

    await expect(assertApprovalRule(buffer, repository)).resolves.toBeUndefined();
  });

  it('refuses a second approval for a token', async () => {
    const { repository, buffer } = await over({ tokenAnalysisLinks: [tokenLink('a')] });

    buffer.create('tokenAnalysisLinks', tokenLink('b'));

    await expect(assertApprovalRule(buffer, repository)).rejects.toThrow(
      new ApprovalRuleError(['GEN 1:1:0']),
    );
  });

  it('refuses a second approval for a segment', async () => {
    const { repository, buffer } = await over({ segmentAnalysisLinks: [segmentLink('a')] });

    buffer.create('segmentAnalysisLinks', segmentLink('b'));

    await expect(assertApprovalRule(buffer, repository)).rejects.toThrow(ApprovalRuleError);
  });

  it('refuses a token in a second approved phrase', async () => {
    const { repository, buffer } = await over({ phraseAnalysisLinks: [phraseLink('a', 0, 1)] });

    buffer.create('phraseAnalysisLinks', phraseLink('b', 1, 2));

    await expect(assertApprovalRule(buffer, repository)).rejects.toThrow(
      new ApprovalRuleError(['GEN 1:1:1']),
    );
  });

  it('counts approved phrases apart from approved token links', async () => {
    const { repository, buffer } = await over({ tokenAnalysisLinks: [tokenLink('a')] });

    buffer.create('phraseAnalysisLinks', phraseLink('b', 0, 1));

    await expect(assertApprovalRule(buffer, repository)).resolves.toBeUndefined();
  });

  it('accepts changes that leave a stored breach no worse', async () => {
    const { repository, buffer } = await over({
      tokenAnalysisLinks: [tokenLink('a'), tokenLink('b'), tokenLink('c', 'suggested')],
    });

    buffer.put('tokenAnalysisLinks', { ...tokenLink('a'), updatedAt: '2026-06-01T00:00:00.000Z' });
    buffer.put('tokenAnalysisLinks', tokenLink('c', 'rejected'));

    await expect(assertApprovalRule(buffer, repository)).resolves.toBeUndefined();
  });

  it('names the places it refuses on the error', async () => {
    const { repository, buffer } = await over({});

    buffer.create('tokenAnalysisLinks', tokenLink('a'));
    buffer.create('tokenAnalysisLinks', tokenLink('b'));

    await expect(assertApprovalRule(buffer, repository)).rejects.toMatchObject({
      places: ['GEN 1:1:0'],
    });
  });
});
