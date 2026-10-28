import type { Book, SegmentationDelta, TextAnalysis } from 'interlinearizer';
import { AnalysisSessions, type EditOutcome, type Session } from '../../services/analysisSessions';
import type { ChangeBuffer } from '../../services/commands/changeBuffer';
import * as tokenCommands from '../../services/commands/tokenCommands';
import { DraftRepository } from '../../services/draftRepository';
import { readBookOutline, readSegmentPage } from '../../services/sessionPages';
import type { SegmentPage } from '../../types/segment-pages';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import {
  FIXTURE_STAMPS,
  makeTokenLink,
  makeVerseBook,
  memoryStorage,
  silentLogger,
  tokenRefOf,
} from '../test-helpers';

export const BOOK = makeVerseBook([
  { sid: 'GEN 1:1', text: 'In the beginning God' },
  { sid: 'GEN 1:2', text: 'And the earth' },
  { sid: 'GEN 1:3', text: 'And God said' },
]);
export const ref = (surfaceText: string) => tokenRefOf(BOOK, surfaceText);
export const NOW = '2026-06-01T00:00:00.000Z';

export const GLOSSED: Partial<TextAnalysis> = {
  tokenAnalyses: [{ id: 'ta-god', ...FIXTURE_STAMPS, surfaceText: 'God', gloss: { en: 'God' } }],
  tokenAnalysisLinks: [makeTokenLink('ta-god', ref('God'), { surfaceText: 'God', id: 'tl-god' })],
};

/**
 * A session over a draft holding `analysis` and `segmentation`, with a way to read its outline and
 * pages as the host serves them.
 */
export async function sessionOver(
  analysis: Partial<TextAnalysis> = GLOSSED,
  segmentation: SegmentationDelta | undefined = undefined,
) {
  const { storage } = memoryStorage();
  await new DraftRepository(storage, 'src', silentLogger()).replaceAll({
    ...emptyDraft('src'),
    analysisLanguages: ['en'],
    analysis: { ...emptyAnalysis(), ...analysis },
    ...(segmentation && { segmentation }),
  });
  const sessions = new AnalysisSessions({
    findProject: async () => undefined,
    openDraftRepository: (source) => new DraftRepository(storage, source, silentLogger()),
    releaseDraftRepository: async () => {},
    openPt9ImportRepository: () => {
      throw new Error('no imports here');
    },
    getInterfaceLanguages: async () => ['en'],
    startTextRead: async () => {},
    stopTextRead: async () => {},
    heldBook: () => BOOK,
    reportChange: () => {},
  });
  const { sessionId } = await sessions.open('src');
  const fetchPage = (start: number, end: number, book: Book = BOOK): Promise<SegmentPage> =>
    sessions.run(sessionId, (session) => readSegmentPage(session.repository, book, start, end));
  const fetchOutline = (book: Book = BOOK) =>
    sessions.run(sessionId, (session) => readBookOutline(session.repository, book));
  const outline = await fetchOutline();
  const edit = (
    intent: string,
    command: (buffer: ChangeBuffer, session: Session) => Promise<void | EditOutcome>,
  ) => sessions.edit(sessionId, intent, command);
  return { sessions, sessionId, fetchPage, fetchOutline, outline, edit };
}

/** A page's analysis with each list in id order, so two pages compare without regard to order. */
export function comparable(page: SegmentPage | undefined) {
  if (!page?.analysis) return page;
  const byId = <T extends { id: string }>(list: readonly T[]) =>
    [...list].sort((a, b) => a.id.localeCompare(b.id));
  const { analysis } = page;
  return {
    ...page,
    analysis: {
      ...analysis,
      tokenAnalysisLinks: byId(analysis.tokenAnalysisLinks),
      phraseAnalysisLinks: byId(analysis.phraseAnalysisLinks),
      segmentAnalysisLinks: byId(analysis.segmentAnalysisLinks),
      tokenAnalyses: byId(analysis.tokenAnalyses),
      phraseAnalyses: byId(analysis.phraseAnalyses),
      segmentAnalyses: byId(analysis.segmentAnalyses),
    },
  };
}

export const glossing = (surfaceText: string, value: string) => (buffer: ChangeBuffer) =>
  tokenCommands.writeGloss(buffer, {
    tokenRef: ref(surfaceText),
    surfaceText,
    value,
    analysisLanguage: 'en',
    analysisId: `ta-${value}`,
    linkId: `tl-${value}`,
    now: NOW,
  });
