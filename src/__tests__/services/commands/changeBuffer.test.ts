/// <reference types="jest" />

import type { TextAnalysis, TokenAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, makePhraseLink, memoryStorage, silentLogger } from '../../test-helpers';

function payload(id: string, surfaceText = id): TokenAnalysis {
  return { id, ...FIXTURE_STAMPS, surfaceText };
}

function link(id: string, analysisId: string, tokenRef: string): TokenAnalysisLink {
  return {
    id,
    analysisId,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'In' },
  };
}

/** A buffer over a draft holding `analysis`. */
async function bufferOver(analysis: Partial<TextAnalysis> = {}): Promise<ChangeBuffer> {
  const { storage } = memoryStorage();
  const repository = new DraftRepository(storage, 'src', silentLogger());
  await repository.replaceAll({
    ...emptyDraft('src'),
    analysis: { ...emptyAnalysis(), ...analysis },
  });
  return new ChangeBuffer(repository);
}

const ids = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();

describe('ChangeBuffer', () => {
  it('reads stored records as the repository does while nothing is staged', async () => {
    const buffer = await bufferOver({
      tokenAnalyses: [payload('ta-1')],
      tokenAnalysisLinks: [link('tl-1', 'ta-1', 'GEN 1:1:0')],
    });

    await expect(buffer.getTokenAnalyses(['ta-1'])).resolves.toStrictEqual([payload('ta-1')]);
    await expect(buffer.findLinksToAnalyses(['ta-1'])).resolves.toStrictEqual({
      tokenAnalysisLinks: [link('tl-1', 'ta-1', 'GEN 1:1:0')],
      phraseAnalysisLinks: [],
      segmentAnalysisLinks: [],
    });
  });

  it('answers with a staged put in place of the stored record', async () => {
    const buffer = await bufferOver({ tokenAnalyses: [payload('ta-1')] });

    buffer.put('tokenAnalyses', { ...payload('ta-1'), gloss: { en: 'one' } });

    await expect(buffer.getTokenAnalyses(['ta-1'])).resolves.toStrictEqual([
      { ...payload('ta-1'), gloss: { en: 'one' } },
    ]);
  });

  it('leaves a staged removal out of every read', async () => {
    const stored = link('tl-1', 'ta-1', 'GEN 1:1:0');
    const buffer = await bufferOver({ tokenAnalysisLinks: [stored] });

    buffer.delete('tokenAnalysisLinks', stored);

    await expect(buffer.findLinksByToken(['GEN 1:1:0'])).resolves.toStrictEqual({
      tokenAnalysisLinks: [],
      phraseAnalysisLinks: [],
    });
  });

  it('finds a record a staged put moves into a lookup, and not one it moves out', async () => {
    const buffer = await bufferOver({
      tokenAnalysisLinks: [link('tl-1', 'ta-1', 'GEN 1:1:0'), link('tl-2', 'ta-2', 'GEN 1:1:0')],
    });

    buffer.put('tokenAnalysisLinks', link('tl-1', 'ta-2', 'GEN 1:1:0'));

    await expect(buffer.findLinksToAnalyses(['ta-1'])).resolves.toMatchObject({
      tokenAnalysisLinks: [],
    });
    const { tokenAnalysisLinks } = await buffer.findLinksToAnalyses(['ta-2']);
    expect(ids(tokenAnalysisLinks)).toStrictEqual(['tl-1', 'tl-2']);
  });

  it('answers every lookup through the staged changes', async () => {
    const phrase = makePhraseLink('pa-1', ['GEN 1:1:0', 'GEN 1:1:3']);
    const segmentLink = {
      id: 'sl-1',
      analysisId: 'sa-1',
      ...FIXTURE_STAMPS,
      status: 'approved' as const,
      segmentId: 'GEN 1:1',
    };
    const buffer = await bufferOver({
      phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the' }],
      phraseAnalysisLinks: [phrase],
      segmentAnalyses: [{ id: 'sa-1', ...FIXTURE_STAMPS, surfaceText: 'In the beginning' }],
      segmentAnalysisLinks: [segmentLink],
    });

    buffer.create('tokenAnalyses', payload('ta-new', 'In'));

    await expect(buffer.findTokenAnalysesByForm(['in'])).resolves.toStrictEqual([
      payload('ta-new', 'In'),
    ]);
    await expect(buffer.findPhraseAnalysesByForm(['in the']).then(ids)).resolves.toStrictEqual([
      'pa-1',
    ]);
    await expect(buffer.getPhraseAnalyses(['pa-1']).then(ids)).resolves.toStrictEqual(['pa-1']);
    await expect(buffer.getSegmentAnalyses(['sa-1']).then(ids)).resolves.toStrictEqual(['sa-1']);
    await expect(buffer.findLinksBySegment(['GEN 1:1'])).resolves.toStrictEqual([segmentLink]);
    await expect(buffer.findLinksByToken(['GEN 1:1:3'])).resolves.toStrictEqual({
      tokenAnalysisLinks: [],
      phraseAnalysisLinks: [phrase],
    });
    await expect(buffer.findLinksToAnalyses(['pa-1', 'sa-1'])).resolves.toStrictEqual({
      tokenAnalysisLinks: [],
      phraseAnalysisLinks: [phrase],
      segmentAnalysisLinks: [segmentLink],
    });
  });

  it('hands out copies, so changing a record read stages nothing', async () => {
    const buffer = await bufferOver({ tokenAnalyses: [payload('ta-1')] });
    const [read] = await buffer.getTokenAnalyses(['ta-1']);

    read.surfaceText = 'changed';

    expect(buffer.toChangeSet('nothing')).toStrictEqual({ intent: 'nothing' });
    await expect(buffer.getTokenAnalyses(['ta-1'])).resolves.toStrictEqual([payload('ta-1')]);
  });

  it('keeps a staged record as it stood when staged', async () => {
    const buffer = await bufferOver();
    const created = payload('ta-1');

    buffer.create('tokenAnalyses', created);
    created.surfaceText = 'changed';

    expect(buffer.toChangeSet('create').tokenAnalyses?.puts).toStrictEqual([payload('ta-1')]);
  });

  it('collects the staged puts and removals of each kind into one change set', async () => {
    const stored = link('tl-1', 'ta-1', 'GEN 1:1:0');
    const buffer = await bufferOver({
      tokenAnalyses: [payload('ta-1')],
      tokenAnalysisLinks: [stored],
    });

    buffer.put('tokenAnalyses', { ...payload('ta-1'), gloss: { en: 'one' } });
    buffer.delete('tokenAnalysisLinks', stored);

    expect(buffer.toChangeSet('edit')).toStrictEqual({
      intent: 'edit',
      tokenAnalyses: { puts: [{ ...payload('ta-1'), gloss: { en: 'one' } }], deletes: [] },
      tokenAnalysisLinks: { puts: [], deletes: ['tl-1'] },
    });
  });

  it('stages nothing for a record it created and then removed', async () => {
    const buffer = await bufferOver();

    buffer.create('tokenAnalyses', payload('ta-new'));
    buffer.delete('tokenAnalyses', payload('ta-new'));

    expect(buffer.toChangeSet('none')).toStrictEqual({ intent: 'none' });
  });

  it('stages a put again after a removal of a stored record', async () => {
    const buffer = await bufferOver({ tokenAnalyses: [payload('ta-1')] });

    buffer.delete('tokenAnalyses', payload('ta-1'));
    buffer.put('tokenAnalyses', payload('ta-1'));

    expect(buffer.toChangeSet('restore').tokenAnalyses).toStrictEqual({
      puts: [payload('ta-1')],
      deletes: [],
    });
  });

  it('lists the records it touches as they stood before a removal or will stand after a put', async () => {
    const stored = link('tl-1', 'ta-1', 'GEN 1:1:0');
    const buffer = await bufferOver({ tokenAnalysisLinks: [stored] });

    buffer.delete('tokenAnalysisLinks', stored);
    buffer.create('tokenAnalysisLinks', link('tl-2', 'ta-1', 'GEN 1:1:3'));

    expect(ids(buffer.touched('tokenAnalysisLinks'))).toStrictEqual(['tl-1', 'tl-2']);
  });
});
