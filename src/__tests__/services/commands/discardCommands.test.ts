/// <reference types="jest" />

import type { SegmentationDelta, TextAnalysis, TokenAnalysisLink } from 'interlinearizer';
import { ChangeBuffer } from '../../../services/commands/changeBuffer';
import {
  discardAll,
  discardBook,
  type SavedProject,
} from '../../../services/commands/discardCommands';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import { asPuts, FIXTURE_STAMPS, memoryStorage, silentLogger } from '../../test-helpers';

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

/** A repository over a stored draft holding `analysis` and `segmentation`. */
async function storedHolding(
  analysis: TextAnalysis,
  segmentation?: SegmentationDelta,
  analysisLanguages: string[] = [],
): Promise<DraftRepository> {
  const repository = new DraftRepository(memoryStorage().storage, 'src', silentLogger());
  await repository.startOver({
    ...emptyDraft('src'),
    analysis,
    analysisLanguages,
    ...(segmentation && { segmentation }),
  });
  return repository;
}

const merged = (...refs: string[]): SegmentationDelta => ({
  removedVerseStarts: refs,
  addedStarts: [],
});

describe('discardAll', () => {
  it('names the books of the links it restores, in order', async () => {
    const saved: SavedProject = {
      analysis: analysisLinking(link('tl-gen', 'GEN 1:1:0'), link('tl-exo', 'EXO 1:1:0')),
      segmentation: undefined,
      analysisLanguages: [],
    };

    const stored = await storedHolding(emptyAnalysis());

    const { changedBooks } = await discardAll(new ChangeBuffer(stored), stored, saved);

    expect(changedBooks).toStrictEqual(['EXO', 'GEN']);
  });

  it('names no book whose links it only removes', async () => {
    const stored = await storedHolding(analysisLinking(link('tl-gen', 'GEN 1:1:0')));

    const { changedBooks } = await discardAll(new ChangeBuffer(stored), stored, undefined);

    expect(changedBooks).toStrictEqual([]);
  });

  it('names the books whose boundaries it changes', async () => {
    const stored = await storedHolding(emptyAnalysis(), merged('GEN 1:2:0', 'EXO 1:2:0'));
    const saved: SavedProject = {
      analysis: emptyAnalysis(),
      segmentation: merged('EXO 1:2:0'),
      analysisLanguages: [],
    };

    const { changedBooks } = await discardAll(new ChangeBuffer(stored), stored, saved);

    expect(changedBooks).toStrictEqual(['GEN']);
  });

  it('names a book whose boundaries its restore adds', async () => {
    const saved: SavedProject = {
      analysis: emptyAnalysis(),
      segmentation: {
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: 'EXO 1:1:4', surfaceText: 'And' }],
      },
      analysisLanguages: [],
    };

    const stored = await storedHolding(emptyAnalysis());

    const { changedBooks } = await discardAll(new ChangeBuffer(stored), stored, saved);

    expect(changedBooks).toStrictEqual(['EXO']);
  });

  it('stages nothing and names no book when the draft already holds the saved content', async () => {
    const analysis = analysisLinking(link('tl-gen', 'GEN 1:1:0'));
    const stored = await storedHolding(analysis, merged('GEN 1:2:0'));
    const buffer = new ChangeBuffer(stored);

    const { changedBooks } = await discardAll(buffer, stored, {
      analysis: JSON.parse(JSON.stringify(analysis)),
      segmentation: merged('GEN 1:2:0'),
      analysisLanguages: [],
    });

    expect(asPuts(buffer.toChangeSet('discardAll'))).toStrictEqual({ intent: 'discardAll' });
    expect(changedBooks).toStrictEqual([]);
  });

  it('stages nothing when the saved records list their keys in another order', async () => {
    const stored = await storedHolding(analysisLinking(link('tl-gen', 'GEN 1:1:0')));
    const buffer = new ChangeBuffer(stored);

    await discardAll(buffer, stored, {
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
      analysisLanguages: [],
    });

    expect(asPuts(buffer.toChangeSet('discardAll'))).toStrictEqual({ intent: 'discardAll' });
  });

  it('stages the scope with the restored boundaries', async () => {
    const stored = await storedHolding(emptyAnalysis());
    const buffer = new ChangeBuffer(stored);

    await discardAll(buffer, stored, {
      analysis: emptyAnalysis(),
      segmentation: merged('GEN 1:2:0'),
      analysisLanguages: [],
    });

    expect(buffer.toChangeSet('discardAll').scope?.after.segmentation).toStrictEqual(
      merged('GEN 1:2:0'),
    );
  });

  it("stages the scope with the saved project's analysis languages, keeping its boundaries", async () => {
    const stored = await storedHolding(emptyAnalysis(), merged('GEN 1:2:0'));
    const buffer = new ChangeBuffer(stored);

    await discardAll(buffer, stored, {
      analysis: emptyAnalysis(),
      segmentation: merged('GEN 1:2:0'),
      analysisLanguages: ['en'],
    });

    const { scope } = buffer.toChangeSet('discardAll');
    expect(scope?.after.analysisLanguages).toStrictEqual(['en']);
    expect(scope?.after.segmentation).toStrictEqual(merged('GEN 1:2:0'));
  });

  it('keeps the analysis languages when the draft saves to no project', async () => {
    const stored = await storedHolding(emptyAnalysis(), merged('GEN 1:2:0'), ['fr']);
    const buffer = new ChangeBuffer(stored);

    await discardAll(buffer, stored, undefined);

    expect(buffer.toChangeSet('discardAll').scope?.after.analysisLanguages).toStrictEqual(['fr']);
  });

  it('stages a scope with no boundaries when the restore has none', async () => {
    const stored = await storedHolding(emptyAnalysis(), merged('GEN 1:2:0'));
    const buffer = new ChangeBuffer(stored);

    await discardAll(buffer, stored, undefined);

    const { scope } = buffer.toChangeSet('discardAll');
    expect(scope).toBeDefined();
    expect(scope).not.toHaveProperty('segmentation');
  });

  it('leaves the scope alone when the boundaries already match', async () => {
    const stored = await storedHolding(analysisLinking(link('tl-gen', 'GEN 1:1:0')));
    const buffer = new ChangeBuffer(stored);

    await discardAll(buffer, stored, undefined);

    expect(asPuts(buffer.toChangeSet('discardAll'))).not.toHaveProperty('scope');
  });
});

describe('discardBook', () => {
  it('names the book when it restores its links', async () => {
    const saved: SavedProject = {
      analysis: analysisLinking(link('tl-gen', 'GEN 1:1:0'), link('tl-exo', 'EXO 1:1:0')),
      segmentation: undefined,
      analysisLanguages: [],
    };

    const stored = await storedHolding(emptyAnalysis());

    const { changedBooks } = await discardBook(new ChangeBuffer(stored), stored, 'GEN', saved);

    expect(changedBooks).toStrictEqual(['GEN']);
  });

  it('stages nothing when the book already holds the saved content', async () => {
    const analysis = analysisLinking(link('tl-gen', 'GEN 1:1:0'));
    const stored = await storedHolding(analysis);
    const buffer = new ChangeBuffer(stored);

    const { changedBooks } = await discardBook(buffer, stored, 'GEN', {
      analysis: JSON.parse(JSON.stringify(analysis)),
      segmentation: undefined,
      analysisLanguages: [],
    });

    expect(asPuts(buffer.toChangeSet('discardBook'))).toStrictEqual({ intent: 'discardBook' });
    expect(changedBooks).toStrictEqual([]);
  });

  it('leaves the analysis languages alone, because they span every book', async () => {
    const stored = await storedHolding(emptyAnalysis());
    const buffer = new ChangeBuffer(stored);

    await discardBook(buffer, stored, 'GEN', {
      analysis: emptyAnalysis(),
      segmentation: undefined,
      analysisLanguages: ['en'],
    });

    expect(asPuts(buffer.toChangeSet('discardBook'))).not.toHaveProperty('scope');
  });
});
