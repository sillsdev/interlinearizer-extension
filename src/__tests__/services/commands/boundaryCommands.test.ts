/// <reference types="jest" />

import type { DraftProject, PhraseAnalysisLink, TokenSnapshot } from 'interlinearizer';
import { AnalysisSessions } from '../../../services/analysisSessions';
import { splitSegment } from '../../../services/commands/boundaryCommands';
import { DraftRepository } from '../../../services/draftRepository';
import { emptyAnalysis, emptyDraft } from '../../../types/empty-factories';
import {
  FIXTURE_STAMPS,
  makeVerseBook,
  memoryStorage,
  seedRepository,
  silentLogger,
} from '../../test-helpers';

const NOW = '2026-06-01T00:00:00.000Z';
const SOURCE = 'src-project';

const VERSE_BOOK = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning God created.' },
  { sid: 'GEN 1:2', text: 'And the earth was void.' },
]);

const IN: TokenSnapshot = { tokenRef: 'GEN 1:1:0', surfaceText: 'In' };
const THE: TokenSnapshot = { tokenRef: 'GEN 1:1:3', surfaceText: 'the' };
const GOD: TokenSnapshot = { tokenRef: 'GEN 1:1:17', surfaceText: 'God' };
const AND: TokenSnapshot = { tokenRef: 'GEN 1:2:0', surfaceText: 'And' };

function phraseLink(id: string, analysisId: string, tokens: TokenSnapshot[]): PhraseAnalysisLink {
  return { id, analysisId, ...FIXTURE_STAMPS, status: 'approved', tokens };
}

/** A draft whose verses 1 and 2 are merged, holding `phraseAnalysisLinks` over payload `pa-1`. */
function draftWith(...phraseAnalysisLinks: PhraseAnalysisLink[]): DraftProject {
  return {
    ...emptyDraft(SOURCE),
    analysisLanguages: ['en'],
    segmentation: { removedVerseStarts: [AND.tokenRef], addedStarts: [] },
    analysis: {
      ...emptyAnalysis(),
      phraseAnalyses: [{ id: 'pa-1', ...FIXTURE_STAMPS, surfaceText: 'In the God' }],
      phraseAnalysisLinks,
    },
  };
}

/** Makes ids in a fixed sequence. */
function idSequence(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `id-${next}`;
  };
}

describe('splitSegment', () => {
  it('reverts the boundaries and the phrases it broke as one undo step, and redoes both', async () => {
    const { storage } = memoryStorage();
    const logger = silentLogger();
    const seeded = draftWith(phraseLink('pl-1', 'pa-1', [IN, THE, GOD]));
    await seedRepository(new DraftRepository(storage, SOURCE, logger), seeded);
    const sessions = new AnalysisSessions({
      findProject: async () => undefined,
      openDraftRepository: (sourceProjectId) =>
        new DraftRepository(storage, sourceProjectId, logger),
      releaseDraftRepository: async () => {},
      openPt9ImportRepository: () => {
        throw new Error('no import in this test');
      },
      getInterfaceLanguages: async () => [],
      startTextRead: async () => {},
      stopTextRead: async () => {},
      heldBook: () => undefined,
      reportChange: () => {},
    });
    const stored = async () => {
      const { draft } = await new DraftRepository(storage, SOURCE, logger).exportAll();
      return { segmentation: draft.segmentation, analysis: draft.analysis };
    };
    const { sessionId } = await sessions.open(SOURCE);

    await sessions.edit(sessionId, 'splitSegment', (buffer) =>
      splitSegment(buffer, {
        verseBook: VERSE_BOOK,
        tokenRef: GOD.tokenRef,
        now: NOW,
        newId: idSequence(),
      }),
    );
    const split = await stored();

    expect(split.segmentation).toStrictEqual({
      removedVerseStarts: [AND.tokenRef],
      addedStarts: [GOD],
    });
    expect(split.analysis.phraseAnalysisLinks.map(({ tokens }) => tokens)).toStrictEqual([
      [IN, THE],
    ]);
    await sessions.undo(sessionId);
    await expect(stored()).resolves.toStrictEqual({
      segmentation: seeded.segmentation,
      analysis: seeded.analysis,
    });
    await sessions.redo(sessionId);
    await expect(stored()).resolves.toStrictEqual(split);
  });
});
