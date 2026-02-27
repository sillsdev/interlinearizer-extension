/**
 * @file Jest manual mock for parsers/paratext-9/converter. Placed adjacent to the module so
 * jest.mock('parsers/paratext-9/converter') picks it up automatically. Used by
 * interlinearizer.web-view tests so the WebView does not run real conversion.
 */

import type {
  ConvertParatext9Options,
  CreateAnalysesOptions,
  CreateTargetAnalysesOptions,
} from '../converter';
import type { InterlinearData, LexiconData } from '../types';
import type {
  Analysis,
  InterlinearAlignment,
  Interlinearization,
  Segment,
} from 'interlinearizer';
import { AnalysisType, AssignmentStatus, Confidence, OccurrenceType } from 'types/interlinearizer-enums';

/** Stub source segment: one word occurrence (morph assignments) and one punctuation. */
const stubSourceSegment: Segment = {
  id: 'mock-seg-1',
  segmentRef: 'JHN 1:1',
  occurrences: [
    {
      id: 'mock-occ-word',
      segmentId: 'mock-seg-1',
      index: 0,
      anchor: '0-2',
      surfaceText: 'In',
      writingSystem: '',
      type: OccurrenceType.Word,
      assignments: [
        {
          id: 'mock-assign-1',
          occurrenceId: 'mock-occ-word',
          analysisId: 'analysis-en-lex1-s1',
          status: AssignmentStatus.Approved,
        },
      ],
    },
    {
      id: 'mock-occ-punct',
      segmentId: 'mock-seg-1',
      index: 1,
      anchor: '2-3',
      surfaceText: ',',
      writingSystem: '',
      type: OccurrenceType.Punctuation,
      assignments: [],
    },
  ],
};

/** Stub target segment: same layout; word occurrence has surfaceText = word-level gloss. */
const stubTargetSegment: Segment = {
  id: 'mock-seg-1-target',
  segmentRef: 'JHN 1:1',
  occurrences: [
    {
      id: 'mock-occ-word-target',
      segmentId: 'mock-seg-1-target',
      index: 0,
      anchor: '0-2',
      surfaceText: 'In',
      writingSystem: '',
      type: OccurrenceType.Word,
      assignments: [
        {
          id: 'mock-assign-1-target',
          occurrenceId: 'mock-occ-word-target',
          analysisId: 'target-analysis-en-lex1-s1',
          status: AssignmentStatus.Approved,
        },
      ],
    },
    {
      id: 'mock-occ-punct-target',
      segmentId: 'mock-seg-1-target',
      index: 1,
      anchor: '2-3',
      surfaceText: ',',
      writingSystem: '',
      type: OccurrenceType.Punctuation,
      assignments: [],
    },
  ],
};

/** Stub source Interlinearization (source side of alignment). */
export const stubInterlinearization: Interlinearization = {
  id: 'mock-interlinear-id',
  sourceWritingSystem: '',
  analysisLanguages: ['en'],
  books: [
    { id: 'mock-book-id', bookRef: 'JHN', textVersion: '', segments: [stubSourceSegment] },
  ],
};

/** Stub target Interlinearization (target side; gloss in occurrence.surfaceText). */
export const stubTargetInterlinearization: Interlinearization = {
  id: 'mock-interlinear-id-target',
  sourceWritingSystem: '',
  analysisLanguages: ['en'],
  books: [
    {
      id: 'mock-book-id-target',
      bookRef: 'JHN',
      textVersion: '',
      segments: [stubTargetSegment],
    },
  ],
};

/** Stub InterlinearAlignment returned by mockConvertAlignment. */
export const stubAlignment: InterlinearAlignment = {
  id: 'mock-interlinear-id-alignment',
  source: stubInterlinearization,
  target: stubTargetInterlinearization,
  links: [],
};

/** Source analyses (morph form for Source morphs row). */
export const stubSourceAnalysesMap: Map<string, Analysis> = new Map([
  [
    'analysis-en-lex1-s1',
    {
      id: 'analysis-en-lex1-s1',
      analysisLanguage: 'en',
      analysisType: AnalysisType.Morph,
      confidence: Confidence.Medium,
      sourceSystem: 'paratext-9',
      sourceUser: 'paratext-9-parser',
      morphemeBundles: [{ id: 'bundle-0', index: 0, form: 'In', writingSystem: '' }],
    },
  ],
]);

/** Target analyses (gloss text for Analyses row). */
export const stubTargetAnalysesMap: Map<string, Analysis> = new Map([
  [
    'target-analysis-en-lex1-s1',
    {
      id: 'target-analysis-en-lex1-s1',
      analysisLanguage: 'en',
      analysisType: AnalysisType.Morph,
      confidence: Confidence.Medium,
      sourceSystem: 'paratext-9',
      sourceUser: 'paratext-9-parser',
      glossText: 'sense1',
      morphemeBundles: [{ id: 'bundle-0', index: 0, form: 'In', writingSystem: '' }],
    },
  ],
]);

/** Legacy: single analyses map for tests that still expect createAnalyses. */
export const stubAnalysesMap = stubSourceAnalysesMap;

/** Typed mocks so tests get correct argument/return types when calling the replaced converter. */
export const mockConvert = jest
  .fn<Promise<Interlinearization>, [InterlinearData, ConvertParatext9Options?]>()
  .mockResolvedValue(stubInterlinearization);
export const mockConvertAlignment = jest
  .fn<Promise<InterlinearAlignment>, [InterlinearData, LexiconData | undefined, ConvertParatext9Options?]>()
  .mockResolvedValue(stubAlignment);
export const mockCreateAnalyses = jest
  .fn<Map<string, Analysis>, [InterlinearData, CreateAnalysesOptions?]>()
  .mockReturnValue(stubSourceAnalysesMap);
export const mockCreateSourceAnalyses = jest
  .fn<Map<string, Analysis>, [InterlinearData]>()
  .mockReturnValue(stubSourceAnalysesMap);
export const mockCreateTargetAnalyses = jest
  .fn<Map<string, Analysis>, [InterlinearData, CreateTargetAnalysesOptions?]>()
  .mockReturnValue(stubTargetAnalysesMap);

export const convertParatext9ToInterlinearization = mockConvert;
export const convertParatext9ToInterlinearAlignment = mockConvertAlignment;
export const createAnalyses = mockCreateAnalyses;
export const createSourceAnalyses = mockCreateSourceAnalyses;
export const createTargetAnalyses = mockCreateTargetAnalyses;
