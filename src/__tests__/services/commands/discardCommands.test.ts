/// <reference types="jest" />

import type { SegmentationDelta, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import type { DraftContent } from '../../../hooks/useDraftProject';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import { discardAll, discardBook } from '../../../services/commands/discardCommands';
import { DraftRepository } from '../../../services/draftRepository';
import type { DraftExport } from '../../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { FIXTURE_STAMPS, memoryStorage, silentLogger } from '../../test-helpers';

function link(id: string, tokenRef: string): TokenAnalysisLink {
  return {
    id,
    analysisId: `ta-${id}`,
    ...FIXTURE_STAMPS,
    status: 'approved',
    token: { tokenRef, surfaceText: 'In' },
  };
}

function analysisLinking(...links: TokenAnalysisLink[]): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: links.map(({ analysisId }) => ({
      id: analysisId,
      ...FIXTURE_STAMPS,
      surfaceText: 'In',
      gloss: { en: 'at' },
    })),
    tokenAnalysisLinks: links,
  };
}

function storedHolding(analysis: TextAnalysis, segmentation?: SegmentationDelta): DraftExport {
  return {
    draft: { ...emptyDraft('src'), analysis, ...(segmentation && { segmentation }) },
    unreadableBooks: [],
  };
}

function freshBuffer(): ChangeBuffer {
  return new ChangeBuffer(new DraftRepository(memoryStorage().storage, 'src', silentLogger()));
}

const merged = (...refs: string[]): SegmentationDelta => ({
  removedVerseStarts: refs,
  addedStarts: [],
});

describe('discardAll', () => {
  it('names the books of the links it restores, in order', () => {
    const saved: DraftContent = {
      analysis: analysisLinking(link('tl-gen', 'GEN 1:1:0'), link('tl-exo', 'EXO 1:1:0')),
      segmentation: undefined,
    };

    const { changedBooks } = discardAll(freshBuffer(), storedHolding(emptyAnalysis()), saved);

    expect(changedBooks).toStrictEqual(['EXO', 'GEN']);
  });

  it('names no book whose links it only removes', () => {
    const stored = storedHolding(analysisLinking(link('tl-gen', 'GEN 1:1:0')));

    const { changedBooks } = discardAll(freshBuffer(), stored, undefined);

    expect(changedBooks).toStrictEqual([]);
  });

  it('names the books whose boundaries it changes', () => {
    const stored = storedHolding(emptyAnalysis(), merged('GEN 1:2:0', 'EXO 1:2:0'));
    const saved: DraftContent = { analysis: emptyAnalysis(), segmentation: merged('EXO 1:2:0') };

    const { changedBooks } = discardAll(freshBuffer(), stored, saved);

    expect(changedBooks).toStrictEqual(['GEN']);
  });

  it('names a book whose boundaries its restore adds', () => {
    const saved: DraftContent = {
      analysis: emptyAnalysis(),
      segmentation: {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: 'EXO 1:1:4', surfaceText: 'And' }],
      },
    };

    const { changedBooks } = discardAll(freshBuffer(), storedHolding(emptyAnalysis()), saved);

    expect(changedBooks).toStrictEqual(['EXO']);
  });

  it('stages nothing and names no book when the draft already holds the saved content', () => {
    const analysis = analysisLinking(link('tl-gen', 'GEN 1:1:0'));
    const buffer = freshBuffer();

    const { changedBooks } = discardAll(buffer, storedHolding(analysis, merged('GEN 1:2:0')), {
      analysis: JSON.parse(JSON.stringify(analysis)),
      segmentation: merged('GEN 1:2:0'),
    });

    expect(buffer.toChangeSet('discardAll')).toStrictEqual({ intent: 'discardAll' });
    expect(changedBooks).toStrictEqual([]);
  });

  it('stages nothing when the saved records list their keys in another order', () => {
    const buffer = freshBuffer();

    discardAll(buffer, storedHolding(analysisLinking(link('tl-gen', 'GEN 1:1:0'))), {
      analysis: {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { gloss: { en: 'at' }, surfaceText: 'In', ...FIXTURE_STAMPS, id: 'ta-tl-gen' },
        ],
        tokenAnalysisLinks: [
          {
            token: { surfaceText: 'In', tokenRef: 'GEN 1:1:0' },
            status: 'approved',
            ...FIXTURE_STAMPS,
            analysisId: 'ta-tl-gen',
            id: 'tl-gen',
          },
        ],
      },
      segmentation: undefined,
    });

    expect(buffer.toChangeSet('discardAll')).toStrictEqual({ intent: 'discardAll' });
  });

  it('stages the scope with the restored boundaries', () => {
    const buffer = freshBuffer();

    discardAll(buffer, storedHolding(emptyAnalysis()), {
      analysis: emptyAnalysis(),
      segmentation: merged('GEN 1:2:0'),
    });

    expect(buffer.toChangeSet('discardAll').scope?.segmentation).toStrictEqual(merged('GEN 1:2:0'));
  });

  it('stages a scope with no boundaries when the restore has none', () => {
    const buffer = freshBuffer();

    discardAll(buffer, storedHolding(emptyAnalysis(), merged('GEN 1:2:0')), undefined);

    const { scope } = buffer.toChangeSet('discardAll');
    expect(scope).toBeDefined();
    expect(scope).not.toHaveProperty('segmentation');
  });

  it('leaves the scope alone when the boundaries already match', () => {
    const buffer = freshBuffer();

    discardAll(buffer, storedHolding(analysisLinking(link('tl-gen', 'GEN 1:1:0'))), undefined);

    expect(buffer.toChangeSet('discardAll')).not.toHaveProperty('scope');
  });
});

describe('discardBook', () => {
  it('names the book when it restores its links', () => {
    const saved: DraftContent = {
      analysis: analysisLinking(link('tl-gen', 'GEN 1:1:0'), link('tl-exo', 'EXO 1:1:0')),
      segmentation: undefined,
    };

    const { changedBooks } = discardBook(
      freshBuffer(),
      storedHolding(emptyAnalysis()),
      'GEN',
      saved,
    );

    expect(changedBooks).toStrictEqual(['GEN']);
  });

  it('stages nothing when the book already holds the saved content', () => {
    const analysis = analysisLinking(link('tl-gen', 'GEN 1:1:0'));
    const buffer = freshBuffer();

    const { changedBooks } = discardBook(buffer, storedHolding(analysis), 'GEN', {
      analysis: JSON.parse(JSON.stringify(analysis)),
      segmentation: undefined,
    });

    expect(buffer.toChangeSet('discardBook')).toStrictEqual({ intent: 'discardBook' });
    expect(changedBooks).toStrictEqual([]);
  });
});
