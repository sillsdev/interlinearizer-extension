/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings, useSetting } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book, DraftProject, PhraseAnalysisLink, TextAnalysis } from 'interlinearizer';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useStore } from 'react-redux';
import { useGlossDispatch } from '../../components/AnalysisStore';
import InterlinearizerLoader from '../../components/InterlinearizerLoader';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';
import type { OpenableProject } from '../../hooks/useDraftProject';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { PT9_MANIFEST_TIMEOUT_MS } from '../../utils/pt9-manifest';
import type { PhraseMode } from '../../types/phrase-mode';
import type { ViewOptions } from '../../types/view-options';
import type { SegmentationDispatch } from '../../components/SegmentationStore';
import {
  FIXTURE_STAMPS,
  GEN_1_1_BOOK,
  makePunctToken,
  makeScrollGroupHook,
  makeSegment,
  getMockedPdpGet,
  makeWebViewState,
  makeWordToken,
  type ScrollGroupTuple,
} from '../test-helpers';
import { mockKeyAsValueLocalizedStrings } from './test-helpers';

jest.mock('../../hooks/useInterlinearizerBookData');
jest.mock('../../hooks/useOptimisticBooleanSetting');

jest.mock('../../components/controls/ViewOptionsDropdown', () => ({
  __esModule: true,
  default: ({
    continuousScroll,
    onContinuousScrollChange,
    hideInactiveLinkButtons,
    onHideInactiveLinkButtonsChange,
    simplifyPhrases,
    onSimplifyPhrasesChange,
    showMorphology,
    onShowMorphologyChange,
    showFreeTranslation,
    onShowFreeTranslationChange,
    showVerseGutter,
    onShowVerseGutterChange,
  }: {
    continuousScroll: boolean;
    onContinuousScrollChange: (v: boolean) => void;
    hideInactiveLinkButtons: boolean;
    onHideInactiveLinkButtonsChange: (v: boolean) => void;
    simplifyPhrases: boolean;
    onSimplifyPhrasesChange: (v: boolean) => void;
    showMorphology: boolean;
    onShowMorphologyChange: (v: boolean) => void;
    showFreeTranslation: boolean;
    onShowFreeTranslationChange: (v: boolean) => void;
    showVerseGutter: boolean;
    onShowVerseGutterChange: (v: boolean) => void;
  }) => (
    <div data-testid="view-options-dropdown">
      <button
        aria-label="continuous scroll"
        data-testid="continuous-scroll-toggle"
        data-checked={String(continuousScroll)}
        onClick={() => onContinuousScrollChange(!continuousScroll)}
        type="button"
      />
      <button
        aria-label="hide inactive link buttons"
        data-testid="hide-inactive-link-buttons-toggle"
        data-checked={String(hideInactiveLinkButtons)}
        onClick={() => onHideInactiveLinkButtonsChange(!hideInactiveLinkButtons)}
        type="button"
      />
      <button
        aria-label="dim inactive segments"
        data-testid="dim-inactive-segments-toggle"
        data-checked={String(simplifyPhrases)}
        onClick={() => onSimplifyPhrasesChange(!simplifyPhrases)}
        type="button"
      />
      <button
        aria-label="show morphology"
        data-testid="show-morphology-toggle"
        data-checked={String(showMorphology)}
        onClick={() => onShowMorphologyChange(!showMorphology)}
        type="button"
      />
      <button
        aria-label="show free translation"
        data-testid="show-free-translation-toggle"
        data-checked={String(showFreeTranslation)}
        onClick={() => onShowFreeTranslationChange(!showFreeTranslation)}
        type="button"
      />
      <button
        aria-label="show verse gutter"
        data-testid="show-verse-gutter-toggle"
        data-checked={String(showVerseGutter)}
        onClick={() => onShowVerseGutterChange(!showVerseGutter)}
        type="button"
      />
    </div>
  ),
}));

jest.mock('../../components/controls/ScriptureNavControls', () => ({
  __esModule: true,
  default: () => <div data-testid="scripture-nav-controls" />,
}));

jest.mock('../../components/modals/WipeModal', () => ({
  __esModule: true,
  /**
   * Minimal WipeModal stand-in exposing per-scope confirm buttons and cancel so tests can drive the
   * loader's wipe handlers without the real dialog's localization or scope-picker UI.
   */
  WipeModal: ({
    hasActiveBook,
    onConfirm,
    onCancel,
  }: {
    hasActiveBook: boolean;
    onConfirm: (scope: 'book' | 'all') => void;
    onCancel: () => void;
  }) => (
    <div data-testid="wipe-modal-panel" data-has-active-book={String(hasActiveBook)}>
      <button type="button" data-testid="wipe-confirm-book" onClick={() => onConfirm('book')}>
        Wipe book
      </button>
      <button type="button" data-testid="wipe-confirm-all" onClick={() => onConfirm('all')}>
        Wipe draft
      </button>
      <button type="button" data-testid="wipe-modal-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: () => <div data-testid="continuous-view" />,
}));

type CapturedInterlinearizerProps = {
  book: Book;
  continuousScroll: boolean;
  scrRef: SerializedVerseRef;
  phraseMode: PhraseMode;
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  viewOptions: ViewOptions;
  segmentationDispatch: SegmentationDispatch;
  formerBoundaries: ReadonlyMap<string, string>;
  segmentationVersion: number;
};
let capturedInterlinearizerProps: CapturedInterlinearizerProps | undefined;
let interlinearizerMountCount = 0;

/** Provider props the loader supplies, captured by the spy wrapper below. */
// The spy forwards every prop wholesale rather than reading any, so these exist for the assertions
// rather than for the component — which is exactly what the unused-prop-type rule objects to.
/* eslint-disable react/no-unused-prop-types */
type CapturedStoreProps = {
  /** BCP 47 tag for reading and writing gloss values. */
  analysisLanguage: string;
  /** Analysis seeded into the store; not reactive after mount. */
  initialAnalysis?: TextAnalysis;
  /** Called after each store mutation with the updated analysis. */
  onSave?: (analysis: TextAnalysis) => void;
  /** Called with whether any gloss input holds uncommitted text. */
  onPendingEditsChange?: (pending: boolean) => void;
  /** Whether un-approved tokens render the engine's suggestion. */
  showSuggestions?: boolean;
  children: ReactNode;
};
/* eslint-enable react/no-unused-prop-types */
let capturedStoreProps: CapturedStoreProps | undefined;

// Spy wrapper around the real provider rather than a replacement for it: the lifetime tests compare
// store identity across a book change, so the store has to be genuine, while the props the loader
// passes still need to be observable.
jest.mock('../../components/AnalysisStore', () => {
  const actual = jest.requireActual('../../components/AnalysisStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  const { createElement } = require('react');
  return {
    ...actual,
    /** Records the props, then renders the real provider unchanged. */
    AnalysisStoreProvider(props: CapturedStoreProps) {
      capturedStoreProps = props;
      return createElement(actual.AnalysisStoreProvider, props);
    },
  };
});

/**
 * Whether the view stub should mount {@link StoreProbe}. Off by default, because the probe's hooks
 * throw outside a Redux provider and most tests here neither render one nor care about the store.
 */
let mountStoreProbe = false;

/** The Redux store the probe is mounted in, captured so a test can compare store identity. */
let probeStore: unknown;

/** Writes a gloss through the store the probe is mounted in. */
let probeWriteGloss: ((tokenRef: string, surfaceText: string, value: string) => void) | undefined;

/**
 * Publishes the store it is mounted in, and a way to write into it, so a test can tell whether a
 * book change replaced the store or left it alone. Renders no markup.
 */
function StoreProbe() {
  probeStore = useStore();
  probeWriteGloss = useGlossDispatch();
  return undefined;
}

jest.mock('../../components/Interlinearizer', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
  const { useEffect } = require('react');
  return {
    __esModule: true,
    default: (props: CapturedInterlinearizerProps) => {
      capturedInterlinearizerProps = props;
      // Count mounts so tests can distinguish a remount (book change) from an in-place update.
      // eslint-disable-next-line react-hooks/rules-of-hooks -- stub render fn acts as a component
      useEffect(() => {
        interlinearizerMountCount += 1;
      }, []);
      return (
        <div data-testid="interlinearizer">{mountStoreProbe ? <StoreProbe /> : undefined}</div>
      );
    },
  };
});

/** Minimal project summary used across modal interaction tests. */
type MockProject = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  sourceProjectId: string;
  analysisLanguages: string[];
  name?: string;
  description?: string;
  pt9Import?: { fileHashes: Record<string, string>; importedAt: string };
};

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

const testProjectId = 'test-project-id';

const STUB_ACTIVE_PROJECT: MockProject = {
  id: 'proj-1',
  createdAt: '2026-01-01T00:00:00Z',
  sourceProjectId: testProjectId,
  analysisLanguages: ['en'],
  name: 'My Project',
};

/** A stored Paratext 9 import, as the picker would hand it to the open flow. */
const STUB_IMPORT_PROJECT: MockProject = {
  id: 'import-1',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  sourceProjectId: testProjectId,
  analysisLanguages: ['en'],
  name: 'Paratext 9 Interlinear',
  pt9Import: { fileHashes: { 'Lexicon.xml': 'aaaa1111' }, importedAt: '2026-08-01T00:00:00Z' },
};

/**
 * The project the stub picker's "Open project" button loads into the draft. Mutable so a test can
 * choose the boundaries the opened project carries.
 */
let openableProjectForStub: OpenableProject = {
  analysis: emptyAnalysis(),
  analysisLanguages: ['en'],
};

jest.mock('../../components/modals/ProjectModals', () => ({
  __esModule: true,
  /**
   * Minimal ProjectModals stand-in that drives modal state and active-project state through the
   * same `useWebViewState` hook the real component uses, so tests can assert on state transitions
   * without mounting the full modal tree. Accepts (and mostly ignores) the draft-related props the
   * loader passes (`hasUnsavedWork`, `getDraftSnapshot`, `loadFromProject`, `markSynced`);
   * `hasUnsavedWork` is surfaced as a `data-*` attribute so tests can assert the loader feeds it
   * the combined committed-and-pending unsaved state.
   */
  default: function StubProjectModals({
    modal,
    setModal,
    activeProject,
    defaultAnalysisLanguage,
    hasUnsavedWork,
    loadFromProject,
    onImportPt9,
    onOpenImport,
    openRequest,
    useWebViewState,
  }: {
    modal: string;
    setModal: (m: string) => void;
    activeProject: MockProject | undefined;
    defaultAnalysisLanguage?: string;
    hasUnsavedWork: boolean;
    getDraftSnapshot: () => DraftProject | undefined;
    loadFromProject: (project: OpenableProject) => void;
    markSynced: () => void;
    onImportPt9: () => void;
    onOpenImport: (project: MockProject) => void;
    openRequest?: { project: MockProject; requestId: number };
    useWebViewState: (
      key: string,
      def: MockProject | undefined,
    ) => [MockProject | undefined, (v: MockProject | undefined) => void, () => void];
    projectId: string;
  }) {
    const [, setActiveProject] = useWebViewState('activeProject', undefined);
    return (
      <div
        data-testid="project-modals"
        data-modal={modal}
        data-default-lang={defaultAnalysisLanguage}
        data-has-unsaved-work={hasUnsavedWork}
        data-active-project-name={activeProject?.name}
        data-active-project-updated={activeProject?.updatedAt}
        data-open-request-id={openRequest?.requestId}
        data-open-request-name={openRequest?.project.name}
      >
        {modal === 'select' && (
          <div data-testid="select-modal">
            <button
              type="button"
              data-testid="select-modal-select"
              onClick={() => {
                setActiveProject(STUB_ACTIVE_PROJECT);
                setModal('none');
              }}
            >
              Select
            </button>
            <button
              type="button"
              data-testid="select-modal-create-new"
              onClick={() => setModal('create')}
            >
              Create new
            </button>
            <button type="button" data-testid="select-modal-close" onClick={() => setModal('none')}>
              Close
            </button>
            <button type="button" data-testid="select-modal-import-pt9" onClick={onImportPt9}>
              Import from Paratext 9
            </button>
            <button
              type="button"
              data-testid="select-modal-open-import"
              onClick={() => onOpenImport(STUB_IMPORT_PROJECT)}
            >
              Open import
            </button>
            <button
              type="button"
              data-testid="select-modal-view-info"
              onClick={() => setModal('metadata')}
            >
              View info
            </button>
            <button
              type="button"
              data-testid="select-modal-open-project"
              onClick={() => {
                loadFromProject(openableProjectForStub);
                setModal('none');
              }}
            >
              Open project
            </button>
          </div>
        )}
        {modal === 'create' && (
          <div data-testid="create-modal">
            <button type="button" data-testid="create-modal-close" onClick={() => setModal('none')}>
              Close
            </button>
            <button
              type="button"
              data-testid="create-modal-created"
              onClick={() => {
                setActiveProject(STUB_ACTIVE_PROJECT);
                setModal('none');
              }}
            >
              Created
            </button>
          </div>
        )}
        {modal === 'saveAs' && (
          <div data-testid="save-as-modal">
            <button
              type="button"
              data-testid="save-as-modal-close"
              onClick={() => setModal('none')}
            >
              Close
            </button>
          </div>
        )}
        {modal === 'metadata' && activeProject && (
          <div data-testid="metadata-modal">
            <button
              type="button"
              data-testid="metadata-modal-close"
              onClick={() => setModal('none')}
            >
              Close
            </button>
            <button
              type="button"
              data-testid="metadata-modal-saved"
              onClick={() => {
                setActiveProject({ ...STUB_ACTIVE_PROJECT, name: 'Renamed Project' });
                setModal('none');
              }}
            >
              Save
            </button>
            <button
              type="button"
              data-testid="metadata-modal-deleted"
              onClick={() => {
                setActiveProject(undefined);
                setModal('none');
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    );
  },
}));

/**
 * The resizable panel the catalog is laid out in, which is what carries the share of the group it
 * holds. Fails the test when the catalog is closed.
 */
function catalogPanelElement(): HTMLElement {
  const panel = screen.getByTestId('analysis-catalog-panel').parentElement;
  if (!panel) throw new Error('the catalog panel is not inside a resizable panel');
  return panel;
}

/**
 * Renders {@link InterlinearizerLoader} with the given props, supplying a fresh
 * `updateWebViewDefinition` spy (which tests can read back) and sensible defaults for the scroll
 * group and WebView-state hooks. Centralizing the render keeps every call site supplying the
 * required `updateWebViewDefinition` prop.
 *
 * @param options.useWebViewScrollGroupScrRef - Scroll-group hook; defaults to a GEN 1:1 stub.
 * @param options.useWebViewState - WebView-state hook; defaults to a fresh empty store.
 * @param options.projectId - Source project ID; defaults to {@link testProjectId}.
 */
function renderLoader(
  options: {
    useWebViewScrollGroupScrRef?: ReturnType<typeof makeScrollGroupHook>;
    useWebViewState?: ReturnType<typeof makeWebViewState>;
    projectId?: string;
  } = {},
) {
  const updateWebViewDefinition = jest.fn(() => true);
  const result = render(
    <InterlinearizerLoader
      projectId={options.projectId ?? testProjectId}
      useWebViewScrollGroupScrRef={options.useWebViewScrollGroupScrRef ?? makeScrollGroupHook()}
      useWebViewState={options.useWebViewState ?? makeWebViewState()}
      updateWebViewDefinition={updateWebViewDefinition}
    />,
  );
  return { ...result, updateWebViewDefinition };
}

/** Configures useInterlinearizerBookData to return the given state. */
function mockBookData(
  overrides: Partial<{
    book: Book | undefined;
    isLoading: boolean;
    bookError: string | undefined;
    tokenizeError: { message: string; raw: unknown } | undefined;
    writingSystem: string;
  }> = {},
): void {
  jest.mocked(useInterlinearizerBookData).mockReturnValue({
    book: GEN_1_1_BOOK,
    isLoading: false,
    bookError: undefined,
    tokenizeError: undefined,
    writingSystem: 'und',
    ...overrides,
  });
}

/**
 * Configures useOptimisticBooleanSetting to return the given state. Each setting key gets its own
 * distinct `onChange` mock so wiring tests can verify that a given toggle is connected to the
 * correct handler — a single shared mock would let a toggle wired to the wrong setting still pass.
 *
 * @param value - The current boolean value applied to every setting; defaults to `false`
 * @param onChange - The change handler for every setting; defaults to a distinct jest.fn() per key
 * @param isLoading - Whether the settings are loading; defaults to `false`
 */
function mockOptimisticSetting(
  value = false,
  onChange: jest.Mock | undefined = undefined,
  isLoading = false,
): Map<string, jest.Mock> {
  const onChangeByKey = new Map<string, jest.Mock>();
  jest.mocked(useOptimisticBooleanSetting).mockImplementation((_projectId, key) => {
    const handler = onChange ?? onChangeByKey.get(key) ?? jest.fn();
    onChangeByKey.set(key, handler);
    return { value, onChange: handler, isLoading };
  });
  return onChangeByKey;
}

/**
 * Configures `useSetting` to return per-key values for `platform.interfaceMode` and
 * `platform.interfaceLanguage`.
 *
 * @param interfaceMode - Value for `platform.interfaceMode`; defaults to `'simple'`.
 * @param interfaceLanguage - Value for `platform.interfaceLanguage`; defaults to `[]`.
 * @throws {Error} When `useSetting` is called with any key other than `platform.interfaceMode` or
 *   `platform.interfaceLanguage` (message: `useSetting mock: unexpected key "<key>"`).
 */
function mockSettings(
  interfaceMode: 'simple' | 'power' = 'simple',
  interfaceLanguage: string[] = [],
): void {
  jest.mocked(useSetting).mockImplementation((key: string) => {
    if (key === 'platform.interfaceMode') return [interfaceMode, jest.fn(), jest.fn(), false];
    if (key === 'platform.interfaceLanguage')
      return [interfaceLanguage, jest.fn(), jest.fn(), false];
    throw new Error(`useSetting mock: unexpected key "${key}"`);
  });
}

describe('InterlinearizerLoader', () => {
  beforeEach(() => {
    capturedInterlinearizerProps = undefined;
    capturedStoreProps = undefined;
    interlinearizerMountCount = 0;
    openableProjectForStub = { analysis: emptyAnalysis(), analysisLanguages: ['en'] };
    mockBookData();
    mockOptimisticSetting();
    // The loader's draft hook calls `interlinearizer.getDraft` on mount; default to a valid empty
    // draft so the editor renders. Individual tests override with mockResolvedValueOnce.
    mockSendCommand.mockResolvedValue(JSON.stringify(emptyDraft(testProjectId)));
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    mockKeyAsValueLocalizedStrings();
    mockSettings();
  });

  it('shows nav controls when interface mode is power', async () => {
    mockSettings('power');
    await act(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('scripture-nav-controls')).toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('hides nav controls when interface mode is simple', async () => {
    await act(async () => {
      renderLoader();
    });

    expect(screen.queryByTestId('scripture-nav-controls')).not.toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('resolves a verse-0 reference to verse 1 when the book has no verse-0 segment', async () => {
    // GEN_1_1_BOOK has only a GEN 1:1 segment, so a whole-chapter (verse 0) selection falls back to
    // the chapter's first numbered verse rather than leaving nothing highlighted.
    await act(async () => {
      renderLoader({
        useWebViewScrollGroupScrRef: makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 3,
          verseNum: 0,
        }),
      });
    });

    expect(capturedInterlinearizerProps?.scrRef).toEqual({
      book: 'GEN',
      chapterNum: 3,
      verseNum: 1,
    });
  });

  it('keeps a verse-0 reference when the book has a verse-0 (superscription) segment', async () => {
    const bookWithSuperscription: Book = {
      id: 'PSA',
      bookRef: 'PSA',
      textVersion: 'v1',
      segments: [makeSegment('PSA 3:0', 'A Psalm by David.', [])],
    };
    mockBookData({ book: bookWithSuperscription });

    await act(async () => {
      renderLoader({
        useWebViewScrollGroupScrRef: makeScrollGroupHook({
          book: 'PSA',
          chapterNum: 3,
          verseNum: 0,
        }),
      });
    });

    expect(capturedInterlinearizerProps?.scrRef).toEqual({
      book: 'PSA',
      chapterNum: 3,
      verseNum: 0,
    });
  });

  it('resolves an out-of-range verse to the last segment of the same chapter', async () => {
    // The host's next-verse button emits verseNum + 1 without clamping, so bumping forward from
    // the last verse of a chapter delivers a verse past the chapter's end. The loader resolves it
    // to the chapter's last segment rather than letting the views fall back to the start of the
    // book. Chapter 4 exists so the test proves resolution stays within the requested chapter.
    const multiSegmentBook: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: [
        makeSegment('GEN 3:1', 'First verse.', []),
        makeSegment('GEN 3:2', 'Last verse of the chapter.', []),
        makeSegment('GEN 4:1', 'Next chapter.', []),
      ],
    };
    mockBookData({ book: multiSegmentBook });

    await act(async () => {
      renderLoader({
        useWebViewScrollGroupScrRef: makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 3,
          verseNum: 3,
        }),
      });
    });

    expect(capturedInterlinearizerProps?.scrRef).toEqual({
      book: 'GEN',
      chapterNum: 3,
      verseNum: 2,
    });
  });

  it('resolves an over-shoot within a chapter opened by a cross-chapter segment', async () => {
    // A cross-chapter segment covers 4:20 through 5:3 — its `startRef.chapter` is 4, but its verse
    // starts include chapter 5's opening verses. When the host over-shoots past chapter 5's real end
    // (verse 4 here, with only 5:1..5:3 present), the fallback must still find the nearest preceding
    // verse start in chapter 5 — 5:3 — even though no segment's `startRef` sits in chapter 5.
    const crossChapterBook: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: [
        {
          id: 'GEN 4:20',
          startRef: { book: 'GEN', chapter: 4, verse: 20 },
          endRef: { book: 'GEN', chapter: 5, verse: 3 },
          baselineText: 'Chapter four tail folded into chapter five opening.',
          tokens: [],
          verseStarts: [
            { charStart: 0, number: '20', chapter: 4 },
            { charStart: 20, number: '1', chapter: 5 },
            { charStart: 30, number: '2', chapter: 5 },
            { charStart: 40, number: '3', chapter: 5 },
          ],
        },
      ],
    };
    mockBookData({ book: crossChapterBook });

    await act(async () => {
      renderLoader({
        useWebViewScrollGroupScrRef: makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 5,
          verseNum: 4,
        }),
      });
    });

    expect(capturedInterlinearizerProps?.scrRef).toEqual({
      book: 'GEN',
      chapterNum: 5,
      verseNum: 3,
    });
  });

  it('resolves a verse missing from the text to the nearest preceding segment start, never a later one', async () => {
    // A verse absent from the book's content (e.g. bridged away in the source) is contained in no
    // segment, so the loader resolves it to the nearest preceding segment start in the chapter —
    // skipping the later segment that also sits in the chapter.
    const gappedBook: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: [
        makeSegment('GEN 3:1', 'First verse.', []),
        makeSegment('GEN 3:3', 'Verse after the gap.', []),
      ],
    };
    mockBookData({ book: gappedBook });

    await act(async () => {
      renderLoader({
        useWebViewScrollGroupScrRef: makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 3,
          verseNum: 2,
        }),
      });
    });

    expect(capturedInterlinearizerProps?.scrRef).toEqual({
      book: 'GEN',
      chapterNum: 3,
      verseNum: 1,
    });
  });

  it('passes a mid-segment verse through unchanged', async () => {
    // A merged segment can span several verses; a verse inside the span is contained in that
    // segment even though no segment starts at it, so the loader passes the reference through
    // unchanged and the views resolve it to the containing segment.
    const mergedSegmentBook: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: [
        {
          id: 'GEN 3:1',
          startRef: { book: 'GEN', chapter: 3, verse: 1 },
          endRef: { book: 'GEN', chapter: 3, verse: 2 },
          baselineText: 'Two verses merged into one segment.',
          tokens: [],
          // A merged segment carries one verse start per absorbed verse, so containment resolves the
          // interior verse 2 to it.
          verseStarts: [
            { charStart: 0, number: '1', chapter: 3 },
            { charStart: 18, number: '2', chapter: 3 },
          ],
        },
        makeSegment('GEN 3:3', 'Verse after the merged segment.', []),
      ],
    };
    mockBookData({ book: mergedSegmentBook });

    await act(async () => {
      renderLoader({
        useWebViewScrollGroupScrRef: makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 3,
          verseNum: 2,
        }),
      });
    });

    expect(capturedInterlinearizerProps?.scrRef).toEqual({
      book: 'GEN',
      chapterNum: 3,
      verseNum: 2,
    });
  });

  it('leaves a verse-0 reference untouched while the book is still loading', async () => {
    // With no book loaded yet, the verse-0 resolution has nothing to consult, so the loader shows
    // the loading placeholder and does not render the interlinearizer.
    mockBookData({ book: undefined, isLoading: true });

    await act(async () => {
      renderLoader({
        useWebViewScrollGroupScrRef: makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 3,
          verseNum: 0,
        }),
      });
    });

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument();
  });

  it('passes a verse-level reference through to Interlinearizer unchanged', async () => {
    await act(async () => {
      renderLoader({
        useWebViewScrollGroupScrRef: makeScrollGroupHook({
          book: 'GEN',
          chapterNum: 3,
          verseNum: 4,
        }),
      });
    });

    expect(capturedInterlinearizerProps?.scrRef).toEqual({
      book: 'GEN',
      chapterNum: 3,
      verseNum: 4,
    });
  });

  it('shows Loading when book data has not arrived', async () => {
    mockBookData({ book: undefined, isLoading: true });
    await act(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
  });

  it('leaves the loading text blank while its localize key is unresolved', async () => {
    // The key-as-value stub stands in for PAPI's pre-resolution state, where each key maps to
    // itself — rendering that verbatim would flash the bare key at the user.
    mockBookData({ book: undefined, isLoading: true });
    await act(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('loading-indicator')).toBeEmptyDOMElement();
  });

  it('shows the loading text once its localize key resolves', async () => {
    mockKeyAsValueLocalizedStrings({ '%interlinearizer_loading%': 'Loading…' });
    mockBookData({ book: undefined, isLoading: true });
    await act(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('loading-indicator')).toHaveTextContent('Loading…');
  });

  it('shows an error heading and message when bookError is set', async () => {
    mockBookData({ book: undefined, bookError: 'Project not found' });
    await act(async () => {
      renderLoader();
    });

    expect(
      screen.getByRole('heading', { name: '%interlinearizer_error_load_book_heading%' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  it('shows an error heading and message when tokenization throws an Error', async () => {
    mockBookData({
      book: undefined,
      tokenizeError: { message: 'parse failure', raw: new Error('parse failure') },
    });
    await act(async () => {
      renderLoader();
    });

    expect(
      screen.getByRole('heading', { name: '%interlinearizer_error_process_book_heading%' }),
    ).toBeInTheDocument();
    expect(screen.getByText('parse failure')).toBeInTheDocument();
  });

  it('shows an error message when tokenization throws a non-Error value', async () => {
    mockBookData({
      book: undefined,
      tokenizeError: { message: 'unexpected string error', raw: 'unexpected string error' },
    });
    await act(async () => {
      renderLoader();
    });

    expect(
      screen.getByRole('heading', { name: '%interlinearizer_error_process_book_heading%' }),
    ).toBeInTheDocument();
    expect(screen.getByText('unexpected string error')).toBeInTheDocument();
  });

  it('passes the checked value from useOptimisticBooleanSetting to ViewOptionsDropdown', async () => {
    mockOptimisticSetting(true);
    await act(async () => {
      renderLoader();
    });

    const toggle = screen.getByTestId('continuous-scroll-toggle');
    expect(toggle).toHaveAttribute('data-checked', 'true');
  });

  it('gates rendering until the persisted display settings have loaded', async () => {
    mockOptimisticSetting(false, jest.fn(), true);
    await act(async () => {
      renderLoader();
    });

    // The saved settings must arrive before the view renders so the user's stored choices apply on
    // the first paint instead of flashing the hard-coded defaults.
    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId('continuous-scroll-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument();
  });

  it('wires ViewOptionsDropdown continuous scroll to the onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await act(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('continuous-scroll-toggle'));
    expect(onChangeByKey.get('interlinearizer.continuousScroll')).toHaveBeenCalledWith(true);
  });

  it('passes all view-option booleans as false to Interlinearizer by default', async () => {
    await act(async () => {
      renderLoader();
    });

    expect(capturedInterlinearizerProps?.viewOptions.hideInactiveLinkButtons).toBe(false);
    expect(capturedInterlinearizerProps?.viewOptions.simplifyPhrases).toBe(false);
    expect(capturedInterlinearizerProps?.viewOptions.showMorphology).toBe(false);
    expect(capturedInterlinearizerProps?.viewOptions.showFreeTranslation).toBe(false);
    expect(capturedInterlinearizerProps?.viewOptions.showVerseGutter).toBe(false);
  });

  it('wires ViewOptionsDropdown hide-inactive-link-buttons to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await act(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('hide-inactive-link-buttons-toggle'));
    expect(onChangeByKey.get('interlinearizer.hideInactiveLinkButtons')).toHaveBeenCalledWith(true);
  });

  it('wires ViewOptionsDropdown dim-inactive-segments to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await act(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('dim-inactive-segments-toggle'));
    expect(onChangeByKey.get('interlinearizer.simplifyPhrases')).toHaveBeenCalledWith(true);
  });

  it('wires ViewOptionsDropdown show-morphology to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await act(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('show-morphology-toggle'));
    expect(onChangeByKey.get('interlinearizer.showMorphology')).toHaveBeenCalledWith(true);
  });

  it('wires ViewOptionsDropdown show-free-translation to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await act(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('show-free-translation-toggle'));
    expect(onChangeByKey.get('interlinearizer.showFreeTranslation')).toHaveBeenCalledWith(true);
  });

  it('wires ViewOptionsDropdown show-verse-gutter to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await act(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('show-verse-gutter-toggle'));
    expect(onChangeByKey.get('interlinearizer.showVerseGutter')).toHaveBeenCalledWith(true);
  });

  it('passes continuousScroll=true to Interlinearizer when the setting is true', async () => {
    mockOptimisticSetting(true);
    await act(async () => {
      renderLoader();
    });

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(true);
  });

  it('passes continuousScroll=false to Interlinearizer when the setting is false', async () => {
    await act(async () => {
      renderLoader();
    });

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(false);
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('takes analysisLanguage from the draft analysisLanguages, not the active project', async () => {
    // The draft owns the analysis language; a draft configured for French must win even when
    // the active project's summary lists a different language.
    mockSendCommand.mockResolvedValueOnce(
      JSON.stringify({ ...emptyDraft(testProjectId), analysisLanguages: ['fr'] }),
    );
    await act(async () =>
      renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
    );

    expect(capturedStoreProps?.analysisLanguage).toBe('fr');
  });

  it('falls back to the first interfaceLanguage tag when the draft has no analysis language', async () => {
    // A brand-new source seeds the draft's analysis language from the platform UI language.
    mockSettings('simple', ['fr', 'en']);
    await act(async () => {
      renderLoader();
    });

    expect(capturedStoreProps?.analysisLanguage).toBe('fr');
  });

  it('passes the platform language to ProjectModals as defaultAnalysisLanguage', async () => {
    mockSettings('simple', ['de']);
    await act(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('project-modals')).toHaveAttribute('data-default-lang', 'de');
  });

  it('falls back to "und" as analysisLanguage when the draft has no language and interfaceLanguage is empty', async () => {
    await act(async () => {
      renderLoader();
    });

    expect(capturedStoreProps?.analysisLanguage).toBe('und');
  });

  describe('Paratext 9 import flows', () => {
    const mockPdpGet = getMockedPdpGet(papi);

    beforeEach(() => {
      jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
    });

    /** A minimal conversion report that satisfies the report type guard. */
    const IMPORT_REPORT = {
      languages: [
        {
          rawLanguage: 'en',
          tag: 'en',
          tagIsFallback: false,
          books: [
            {
              bookId: 'GEN',
              bookFound: true,
              versesTotal: 1,
              versesHashed: 1,
              versesNotFound: 0,
              clustersTotal: 2,
              clustersConverted: 2,
              phrasesConverted: 0,
              clusterDrops: {
                verseNotFound: 0,
                formMismatch: 0,
                lemmaOrOther: 0,
                duplicateCluster: 0,
                unparseableLexemeId: 0,
              },
              ambiguousAnchors: 0,
              punctuationEntriesIgnored: 0,
            },
          ],
        },
      ],
      merge: {
        mergedTokenRecords: 0,
        parseConflicts: 0,
        approvedDemotedToCandidate: 0,
        sameTagCollisions: [],
      },
      senses: {
        specificResolved: 0,
        defaultSingleResolved: 0,
        unresolvedGlossText: 0,
        entryRefsResolved: 0,
        entryRefsUnresolved: 0,
        senseRefsResolved: 0,
        senseRefsUnresolved: 0,
      },
      barePayloads: {
        added: 0,
        skippedExistingIdentical: 0,
        droppedUnparseable: 0,
        droppedEmpty: 0,
      },
    };

    const FRESH_IMPORT_SUMMARY = { ...STUB_IMPORT_PROJECT, updatedAt: '2026-08-21T00:00:00Z' };

    /**
     * Routes the loader's commands for these tests: draft loads stay empty, the stored import loads
     * with an empty analysis, and the import and copy commands resolve as configured.
     */
    function mockImportCommands({
      importResult,
      importError,
      copyJson,
    }: {
      importResult?: unknown;
      importError?: Error;
      copyJson?: string;
    } = {}): void {
      mockSendCommand.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProject')
          return JSON.stringify({ ...FRESH_IMPORT_SUMMARY, analysis: emptyAnalysis() });
        if (args[0] === 'interlinearizer.importPt9Project') {
          if (importError) throw importError;
          return JSON.stringify(importResult);
        }
        if (args[0] === 'interlinearizer.createEditableCopy') return copyJson;
        return JSON.stringify(emptyDraft(testProjectId));
      });
    }

    /** Renders the loader with the stored import active and waits for the banner. */
    async function renderImportView() {
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_IMPORT_PROJECT }) }),
      );
      return screen.findByTestId('pt9-import-banner');
    }

    it('renders the read-only banner with Sync and Copy for an import', async () => {
      mockImportCommands();
      await renderImportView();

      expect(screen.getByTestId('pt9-sync-button')).toBeInTheDocument();
      expect(screen.getByTestId('pt9-copy-button')).toBeInTheDocument();
    });

    it('holds the banner back until the localized strings resolve', async () => {
      mockImportCommands();
      jest
        .mocked(useLocalizedStrings)
        .mockImplementation((keys: readonly string[]) => [
          Object.fromEntries(keys.map((k) => [k, k])),
          true,
        ]);

      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_IMPORT_PROJECT }) }),
      );

      expect(screen.queryByTestId('pt9-import-banner')).not.toBeInTheDocument();
    });

    it('silences Save, Save As, and Wipe while an import is open', async () => {
      mockImportCommands();
      await renderImportView();
      mockSendCommand.mockClear();

      await userEvent.click(screen.getByTestId('tab-toolbar-save'));
      await userEvent.click(screen.getByTestId('tab-toolbar-save-as'));
      await userEvent.click(screen.getByTestId('tab-toolbar-wipe'));

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(screen.queryByTestId('save-as-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('wipe-modal-panel')).not.toBeInTheDocument();
    });

    /** Points the frontend PDP mock at a manifest, so the offer probe answers `available`. */
    function mockOfferProbe(manifest: Record<string, string> = { 'Interlinear_en/x.xml': 'h' }) {
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: jest.fn().mockResolvedValue(manifest),
      });
    }

    it('offers the first-open conversion and runs the import on Yes', async () => {
      mockOfferProbe();
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await act(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });
      expect(screen.getByTestId('pt9-convert-prompt-message')).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ConvertPrompt_yes%' }),
      );

      expect(await screen.findByTestId('pt9-import-report')).toBeInTheDocument();
      expect(screen.queryByTestId('pt9-convert-prompt-message')).not.toBeInTheDocument();
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.importPt9Project',
        testProjectId,
      );
    });

    it('offers an offer-run report no way out but opening the import it just made', async () => {
      mockOfferProbe();
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await act(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ConvertPrompt_yes%' }),
      );
      await screen.findByTestId('pt9-import-report');

      expect(
        screen.queryByRole('button', { name: '%interlinearizer_pt9ImportModal_close%' }),
      ).not.toBeInTheDocument();

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_open%' }),
      );

      expect(await screen.findByTestId('pt9-import-banner')).toBeInTheDocument();
    });

    it('persists the empty draft and runs no import on No', async () => {
      mockOfferProbe();
      mockImportCommands();
      await act(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ConvertPrompt_no%' }),
      );

      expect(screen.queryByTestId('pt9-convert-prompt-message')).not.toBeInTheDocument();
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraft',
        testProjectId,
        expect.stringContaining('"sourceProjectId"'),
      );
      expect(mockSendCommand).not.toHaveBeenCalledWith(
        'interlinearizer.importPt9Project',
        expect.anything(),
      );
    });

    it('holds the offer while the draft is still loading', async () => {
      mockOfferProbe();
      mockSendCommand.mockImplementation(() => new Promise(() => {}));
      await act(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });

      expect(screen.queryByTestId('pt9-convert-prompt-message')).not.toBeInTheDocument();
    });

    it('never offers when the probe finds no convertible data', async () => {
      mockOfferProbe({});
      mockImportCommands();
      await act(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });

      expect(screen.queryByTestId('pt9-convert-prompt-message')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pt9-checking')).not.toBeInTheDocument();
    });

    it('shows the checking status only when the probe is still unanswered after the delay', async () => {
      jest.useFakeTimers();
      try {
        mockPdpGet.mockResolvedValue({
          getPt9InterlinearManifest: jest.fn(() => new Promise(() => {})),
        });
        mockImportCommands();
        await act(async () => {
          renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
        });
        expect(screen.queryByTestId('pt9-checking')).not.toBeInTheDocument();

        await act(async () => {
          jest.advanceTimersByTime(400);
        });

        expect(screen.getByTestId('pt9-checking')).toBeInTheDocument();
      } finally {
        jest.useRealTimers();
      }
    });

    it('never flashes the checking status when the probe answers fast', async () => {
      jest.useFakeTimers();
      try {
        mockOfferProbe();
        mockImportCommands();
        await act(async () => {
          renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
        });

        await act(async () => {
          jest.advanceTimersByTime(400);
        });

        expect(screen.queryByTestId('pt9-checking')).not.toBeInTheDocument();
        expect(screen.getByTestId('pt9-convert-prompt-message')).toBeInTheDocument();
      } finally {
        jest.useRealTimers();
      }
    });

    it('hides the offer behind an open modal', async () => {
      mockOfferProbe();
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await act(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      expect(await screen.findByTestId('pt9-import-report')).toBeInTheDocument();
      expect(screen.queryByTestId('pt9-convert-prompt-message')).not.toBeInTheDocument();
    });

    it('imports from the select modal and opens the import from the report', async () => {
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      expect(await screen.findByTestId('pt9-import-report')).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_open%' }),
      );

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-name',
        'Paratext 9 Interlinear',
      );
    });

    it('returns to the select modal when an import report is closed', async () => {
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));
      await screen.findByTestId('pt9-import-report');

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_close%' }),
      );

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'select');
    });

    it('shows the in-modal failure when the import command rejects', async () => {
      mockImportCommands({ importError: new Error('nothing to import') });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      const error = await screen.findByTestId('pt9-import-error');
      expect(error).toHaveTextContent('%interlinearizer_pt9ImportModal_failed%');
    });

    it('shows the friendly too-large message when the platform refuses the oversized payload', async () => {
      mockImportCommands({
        importError: new Error(
          "PT9 interlinear data is too large: the project's interlinear files total 60000000 bytes",
        ),
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      const error = await screen.findByTestId('pt9-import-error');
      expect(error).toHaveTextContent('%interlinearizer_pt9ImportModal_tooLarge%');
    });

    it('syncs from the banner and shows the report with Close only', async () => {
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await renderImportView();

      await userEvent.click(screen.getByTestId('pt9-sync-button'));

      expect(await screen.findByTestId('pt9-import-report')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: '%interlinearizer_pt9ImportModal_open%' }),
      ).not.toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_close%' }),
      );
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-08-21T00:00:00Z',
      );
    });

    it('closes quietly when a sync finds the source files gone', async () => {
      mockImportCommands({ importResult: { outcome: 'staleKept', projectId: 'import-1' } });
      await renderImportView();

      await userEvent.click(screen.getByTestId('pt9-sync-button'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.queryByTestId('pt9-import-report')).not.toBeInTheDocument();
    });

    it('opens an unchanged import directly from the select modal', async () => {
      mockImportCommands();
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => ({ 'Lexicon.xml': 'aaaa1111' }),
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-open-import'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-name',
        'Paratext 9 Interlinear',
      );
      expect(mockSendCommand).not.toHaveBeenCalledWith(
        'interlinearizer.importPt9Project',
        expect.anything(),
      );
    });

    it('auto-syncs a changed import before opening, with no report step', async () => {
      mockImportCommands({ importResult: { outcome: 'imported', projectId: 'import-1' } });
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => ({ 'Lexicon.xml': 'bbbb2222' }),
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-open-import'));

      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.importPt9Project',
        testProjectId,
      );
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.queryByTestId('pt9-import-report')).not.toBeInTheDocument();
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-08-21T00:00:00Z',
      );
    });

    it('titles the open-path sync as a sync while it runs', async () => {
      mockSendCommand.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.importPt9Project') return new Promise<string>(() => {});
        return JSON.stringify(emptyDraft(testProjectId));
      });
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => ({ 'Lexicon.xml': 'bbbb2222' }),
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-open-import'));

      expect(await screen.findByTestId('pt9-import-running')).toHaveTextContent(
        '%interlinearizer_pt9ImportModal_syncing%',
      );
    });

    it('opens the stored import with a warning when the manifest read on open never answers', async () => {
      // The select modal is held inert for the whole open, so the wait has to end for the user to
      // get out of it.
      jest.useFakeTimers();
      try {
        mockImportCommands();
        jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
        mockPdpGet.mockResolvedValue({
          getPt9InterlinearManifest: jest.fn(() => new Promise(() => {})),
        });
        await act(async () => {
          renderLoader();
        });
        fireEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
        fireEvent.click(screen.getByTestId('select-modal-open-import'));
        expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'select');

        await act(async () => {
          jest.advanceTimersByTime(PT9_MANIFEST_TIMEOUT_MS);
        });

        expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
          message: '%interlinearizer_warning_pt9Sync_failed%',
          severity: 'warning',
        });
        expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
        expect(screen.getByTestId('project-modals')).toHaveAttribute(
          'data-active-project-name',
          'Paratext 9 Interlinear',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('opens the stored import with a warning when the open-path sync fails', async () => {
      mockImportCommands();
      mockPdpGet.mockRejectedValue(new Error('provider unavailable'));
      jest.mocked(papi.notifications.send).mockRejectedValue(new Error('ui offline'));
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-open-import'));

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
        message: '%interlinearizer_warning_pt9Sync_failed%',
        severity: 'warning',
      });
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-name',
        'Paratext 9 Interlinear',
      );
    });

    it('copies the import and requests the copy be opened through the draft flow', async () => {
      mockImportCommands({
        copyJson: JSON.stringify({
          ...STUB_ACTIVE_PROJECT,
          id: 'copy-1',
          updatedAt: '2026-08-21T00:00:00Z',
          name: 'My Copy',
        }),
      });
      await renderImportView();

      await userEvent.click(screen.getByTestId('pt9-copy-button'));
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_copyModal_create%' }),
      );

      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.createEditableCopy',
        'import-1',
        '%interlinearizer_copyModal_defaultName%',
        undefined,
      );
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-open-request-id', '1');
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-open-request-name',
        'My Copy',
      );
    });

    it('keeps the stored import when an open-path sync finds the files gone', async () => {
      mockImportCommands({ importResult: { outcome: 'staleKept', projectId: 'import-1' } });
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => ({}),
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-open-import'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      // The stale summary opened untouched: the pre-sync timestamp is still the one cached.
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-08-01T00:00:00Z',
      );
    });

    it('shows the in-modal failure when the import result is not even an object', async () => {
      mockImportCommands({ importResult: 42 });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      expect(await screen.findByTestId('pt9-import-error')).toBeInTheDocument();
    });

    it('opens the stored import when an open-path sync returns a malformed result', async () => {
      mockImportCommands({ importResult: 42 });
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => ({ 'Lexicon.xml': 'bbbb2222' }),
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-open-import'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-08-01T00:00:00Z',
      );
    });

    it('reseeds the view with the analysis a sync fetched, not the one it replaced', async () => {
      const syncedAnalysis: TextAnalysis = {
        ...emptyAnalysis(),
        tokenAnalyses: [
          { ...FIXTURE_STAMPS, id: 'ta-synced', surfaceText: 'In', gloss: { en: 'in' } },
        ],
      };
      let synced = false;
      mockSendCommand.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProject')
          return JSON.stringify(
            synced
              ? { ...FRESH_IMPORT_SUMMARY, analysis: syncedAnalysis }
              : { ...STUB_IMPORT_PROJECT, analysis: emptyAnalysis() },
          );
        if (args[0] === 'interlinearizer.importPt9Project') {
          synced = true;
          return JSON.stringify({
            outcome: 'imported',
            projectId: 'import-1',
            report: IMPORT_REPORT,
          });
        }
        return JSON.stringify(emptyDraft(testProjectId));
      });
      await renderImportView();
      expect(capturedStoreProps?.initialAnalysis).toEqual(emptyAnalysis());

      await userEvent.click(screen.getByTestId('pt9-sync-button'));

      await waitFor(() => expect(capturedStoreProps?.initialAnalysis).toEqual(syncedAnalysis));
    });

    it('empties the import view when a refresh brings back no analysis, rather than keeping the pre-sync one', async () => {
      let synced = false;
      mockSendCommand.mockImplementation(async (...args) => {
        // Once synced, the record comes back as a valid summary carrying no analysis at all: the
        // sync's own summary fetch is satisfied, while the refresh behind it finds nothing to show.
        if (args[0] === 'interlinearizer.getProject')
          return JSON.stringify(
            synced ? FRESH_IMPORT_SUMMARY : { ...STUB_IMPORT_PROJECT, analysis: emptyAnalysis() },
          );
        if (args[0] === 'interlinearizer.importPt9Project') {
          synced = true;
          return JSON.stringify({
            outcome: 'imported',
            projectId: 'import-1',
            report: IMPORT_REPORT,
          });
        }
        return JSON.stringify(emptyDraft(testProjectId));
      });
      await renderImportView();
      expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();

      await userEvent.click(screen.getByTestId('pt9-sync-button'));

      await waitFor(() => expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument());
      expect(screen.getByTestId('pt9-import-load-error')).toHaveTextContent(
        '%interlinearizer_error_pt9Import_load_failed%',
      );
      expect(screen.getByTestId('pt9-import-banner')).toBeInTheDocument();
      // The panel line is the whole message: no toast doubles it with different advice.
      expect(jest.mocked(papi.notifications.send)).not.toHaveBeenCalledWith({
        message: '%interlinearizer_error_load_projects_failed%',
        severity: 'error',
      });
    });

    it('hands the import view a segmentation dispatch that cannot write the draft', async () => {
      mockImportCommands();
      await renderImportView();
      mockSendCommand.mockClear();

      act(() => {
        capturedInterlinearizerProps?.segmentationDispatch.merge('GEN 1:2:0');
        capturedInterlinearizerProps?.segmentationDispatch.split('GEN 1:1:2');
        capturedInterlinearizerProps?.segmentationDispatch.move('GEN 1:1:2', 'GEN 1:1:4');
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it('drops a phrase mode entered on the draft when an import opens', async () => {
      mockImportCommands();
      await act(async () => {
        renderLoader();
      });
      act(() => {
        capturedInterlinearizerProps?.setPhraseMode({
          kind: 'edit',
          phraseId: 'phrase-1',
          originalTokens: [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }],
        });
      });
      expect(capturedInterlinearizerProps?.phraseMode).toEqual({
        kind: 'edit',
        phraseId: 'phrase-1',
        originalTokens: [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }],
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-open-import'));

      expect(await screen.findByTestId('pt9-import-banner')).toBeInTheDocument();
      await waitFor(() =>
        expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' }),
      );
    });

    it('keeps the import view in view mode however the phrase mode is set under it', async () => {
      mockImportCommands();
      await renderImportView();

      act(() => {
        capturedInterlinearizerProps?.setPhraseMode({
          kind: 'edit',
          phraseId: 'phrase-1',
          originalTokens: [{ tokenRef: 'GEN 1:1:0', surfaceText: 'In' }],
        });
      });

      // The reset effect only covers crossing into the import; a mode set from inside it would
      // otherwise stand, since nothing crosses back.
      expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' });
    });

    it('falls back to the platform language when the import declares no analysis language', async () => {
      mockImportCommands();
      await act(async () =>
        renderLoader({
          useWebViewState: makeWebViewState({
            activeProject: { ...STUB_IMPORT_PROJECT, analysisLanguages: [] },
          }),
        }),
      );

      expect(await screen.findByTestId('pt9-import-banner')).toBeInTheDocument();
      expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
    });

    it('reports a rejected imported-analysis fetch in the panel and sends no toast', async () => {
      jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
      mockSendCommand.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProject') throw new Error('storage offline');
        return JSON.stringify(emptyDraft(testProjectId));
      });
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_IMPORT_PROJECT }) }),
      );

      expect(screen.getByTestId('pt9-import-load-error')).toHaveTextContent(
        '%interlinearizer_error_pt9Import_load_failed%',
      );
      expect(jest.mocked(papi.notifications.send)).not.toHaveBeenCalled();
    });

    it('shows the in-modal failure when the import result carries no valid report', async () => {
      mockImportCommands({ importResult: { outcome: 'imported', projectId: 'import-1' } });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      expect(await screen.findByTestId('pt9-import-error')).toBeInTheDocument();
    });

    it('notifies and stays on the report when the Open fetch returns no project', async () => {
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));
      await screen.findByTestId('pt9-import-report');

      jest.mocked(papi.notifications.send).mockRejectedValue(new Error('ui offline'));
      mockSendCommand.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.getProject' ? '' : JSON.stringify(emptyDraft(testProjectId)),
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_open%' }),
      );

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
        message: '%interlinearizer_error_load_projects_failed%',
        severity: 'error',
      });
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'importPt9');
    });

    it('drops an Open fetch that lands after the user has closed the report', async () => {
      jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
      let imported = false;
      let releaseSummary: (() => void) | undefined;
      mockSendCommand.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProject' && imported) {
          // Hold the summary until the test has taken the user off the report.
          await new Promise<void>((resolve) => {
            releaseSummary = resolve;
          });
          return JSON.stringify(FRESH_IMPORT_SUMMARY);
        }
        if (args[0] === 'interlinearizer.importPt9Project') {
          imported = true;
          return JSON.stringify({
            outcome: 'imported',
            projectId: 'import-1',
            report: IMPORT_REPORT,
          });
        }
        return JSON.stringify(emptyDraft(testProjectId));
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));
      await screen.findByTestId('pt9-import-report');

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_open%' }),
      );
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_close%' }),
      );
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'select');

      await act(async () => {
        releaseSummary?.();
      });

      // The select modal the user went back to is still theirs, and no project has been switched in.
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'select');
      expect(screen.getByTestId('project-modals')).not.toHaveAttribute('data-active-project-name');
    });

    it('notifies and stays on the report when the Open fetch rejects', async () => {
      jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
      let imported = false;
      mockSendCommand.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProject' && imported)
          throw new Error('storage offline');
        if (args[0] === 'interlinearizer.importPt9Project') {
          imported = true;
          return JSON.stringify({
            outcome: 'imported',
            projectId: 'import-1',
            report: IMPORT_REPORT,
          });
        }
        return JSON.stringify(emptyDraft(testProjectId));
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));
      await screen.findByTestId('pt9-import-report');

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_open%' }),
      );

      expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
        'Interlinearizer: failed to load the imported project for opening',
        expect.any(Error),
      );
      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
        message: '%interlinearizer_error_load_projects_failed%',
        severity: 'error',
      });
      expect(screen.getByTestId('pt9-import-report')).toBeInTheDocument();
    });

    it('notifies when the copy command returns no project', async () => {
      mockImportCommands({ copyJson: '{}' });
      jest.mocked(papi.notifications.send).mockRejectedValue(new Error('ui offline'));
      await renderImportView();

      await userEvent.click(screen.getByTestId('pt9-copy-button'));
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_copyModal_create%' }),
      );

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
        message: '%interlinearizer_error_createEditableCopy_failed%',
        severity: 'error',
      });
      expect(screen.getByTestId('project-modals')).not.toHaveAttribute('data-open-request-id');
    });

    it('closes the copy dialog without copying when the user cancels', async () => {
      mockImportCommands();
      await renderImportView();

      await userEvent.click(screen.getByTestId('pt9-copy-button'));
      expect(screen.getByTestId('copy-to-editable-modal-title')).toBeInTheDocument();
      mockSendCommand.mockClear();
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_copyModal_cancel%' }),
      );

      expect(screen.queryByTestId('copy-to-editable-modal-title')).not.toBeInTheDocument();
      expect(mockSendCommand).not.toHaveBeenCalledWith(
        'interlinearizer.createEditableCopy',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('drops an imported-analysis fetch that lands after unmount', async () => {
      let resolveFetch: (json: string) => void = () => {};
      mockSendCommand.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProject')
          return new Promise((resolve) => {
            resolveFetch = resolve;
          });
        return JSON.stringify(emptyDraft(testProjectId));
      });
      let unmount = () => {};
      await act(async () => {
        ({ unmount } = renderLoader({
          useWebViewState: makeWebViewState({ activeProject: STUB_IMPORT_PROJECT }),
        }));
      });
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.getProject',
        STUB_IMPORT_PROJECT.id,
      );

      unmount();
      await act(async () => {
        resolveFetch(JSON.stringify({ ...FRESH_IMPORT_SUMMARY, analysis: emptyAnalysis() }));
      });
      // The ignore flag makes the late result a no-op; finishing without a React update-after-
      // unmount warning is the observable behavior.
    });

    it('logs and keeps the dialog when the copy command rejects', async () => {
      mockSendCommand.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProject')
          return JSON.stringify({ ...FRESH_IMPORT_SUMMARY, analysis: emptyAnalysis() });
        if (args[0] === 'interlinearizer.createEditableCopy') throw new Error('copy failed');
        return JSON.stringify(emptyDraft(testProjectId));
      });
      await renderImportView();

      await userEvent.click(screen.getByTestId('pt9-copy-button'));
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_copyModal_create%' }),
      );

      expect(logger.error).toHaveBeenCalledWith(
        'Interlinearizer: failed to copy the imported project',
        expect.any(Error),
      );
    });

    it('reports an imported analysis that never loads in the panel and sends no toast', async () => {
      jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
      // An empty response is the never-written case; the effect treats it like a malformed one.
      mockSendCommand.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.getProject' ? '' : JSON.stringify(emptyDraft(testProjectId)),
      );
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_IMPORT_PROJECT }) }),
      );

      expect(screen.getByTestId('pt9-import-load-error')).toHaveTextContent(
        '%interlinearizer_error_pt9Import_load_failed%',
      );
      expect(jest.mocked(papi.notifications.send)).not.toHaveBeenCalled();
    });
  });

  describe('modal interactions', () => {
    it('opens the select modal when the project menu selectProject item is clicked', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));

      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('opens the create modal directly when the openNewProjectModal menu item is clicked', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));

      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('closes the create modal without showing another when close is clicked from menu source', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));
      await userEvent.click(screen.getByTestId('create-modal-close'));

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('closes the select modal when its close button is clicked', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-close'));

      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('opens the create modal from the select modal create-new button', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));

      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
    });

    it('closes all modals after a project is created from the select modal', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));
      await userEvent.click(screen.getByTestId('create-modal-created'));

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('sets the active project and closes the select modal when a project is selected', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));

      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
      // After selection the view-project-info button becomes available, confirming activeProject is set
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('opens the metadata modal from the openProjectInfoModal menu item when a project is active', async () => {
      await act(async () => {
        renderLoader();
      });

      // Select a project so activeProject is set
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('does not open the metadata modal from openProjectInfoModal when no project is active', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
    });

    it('dismisses to none when metadata is closed after being opened from the menu', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-close'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('dismisses to none and clears active project when the active project is deleted from the menu', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-deleted'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
      // The deleted project was the active one, so the loader should now pass `activeProject:
      // undefined` down to ProjectModals (the stub omits the attribute when there is no name).
      expect(screen.getByTestId('project-modals')).not.toHaveAttribute('data-active-project-name');
    });

    it('updates the active project name when its metadata is saved', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-saved'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
      // Saving renamed the active project; the loader must reflect the new name it reads back from
      // WebView state by passing it down to ProjectModals.
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-name',
        'Renamed Project',
      );
    });

    it('renders without error when useData provides a topMenu with items', async () => {
      const mockWebViewMenu = {
        topMenu: {
          label: 'top',
          items: [
            {
              command: 'interlinearizer.openProjectInfoModal',
              label: 'View',
              group: 'g',
              order: 1,
              localizeNotes: '',
            },
            {
              command: 'interlinearizer.openSelectProjectModal',
              label: 'Select',
              group: 'g',
              order: 2,
              localizeNotes: '',
            },
          ],
        },
        includeDefaults: true,
        contextMenu: undefined,
      };
      jest
        .mocked(useData)
        .mockReturnValue(
          new Proxy(
            {},
            { get: () => jest.fn().mockReturnValue([mockWebViewMenu, jest.fn(), false]) },
          ),
        );
      await act(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('tab-toolbar')).toBeInTheDocument();
    });
  });

  describe('draft loading', () => {
    it('loads the draft on mount and passes its analysis as initialAnalysis', async () => {
      const draftAnalysis = emptyAnalysis();
      draftAnalysis.tokenAnalyses.push({
        ...FIXTURE_STAMPS,
        id: 't1',
        surfaceText: 'In',
        gloss: { en: 'in' },
      });
      mockSendCommand.mockResolvedValueOnce(
        JSON.stringify({ ...emptyDraft(testProjectId), analysis: draftAnalysis }),
      );
      await act(async () => {
        renderLoader();
      });

      expect(mockSendCommand).toHaveBeenCalledWith('interlinearizer.getDraft', testProjectId);
      expect(capturedStoreProps?.initialAnalysis).toEqual(draftAnalysis);
    });

    it('falls back to an empty draft and logs an error when getDraft rejects', async () => {
      const error = new Error('network error');
      mockSendCommand.mockRejectedValueOnce(error);
      await act(async () => {
        renderLoader();
      });

      expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
        'Interlinearizer: failed to load draft',
        error,
      );
      // The fallback empty draft still renders the editor with an empty analysis.
      expect(capturedStoreProps?.initialAnalysis).toEqual(emptyAnalysis());
    });

    it('skips state updates when the component unmounts before getDraft resolves', async () => {
      let resolveGetDraft: ((value: string) => void) | undefined;
      mockSendCommand.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          resolveGetDraft = resolve;
        }),
      );

      const { unmount } = renderLoader();

      unmount();
      resolveGetDraft?.(JSON.stringify(emptyDraft(testProjectId)));
      await act(async () => {
        await Promise.resolve();
      });

      expect(jest.mocked(logger.error)).not.toHaveBeenCalled();
    });
  });

  describe('autosave analysis', () => {
    it('persists edits to the draft via saveDraft when onSaveAnalysis fires', async () => {
      await act(async () => {
        renderLoader();
      });

      const edited = emptyAnalysis();
      edited.tokenAnalyses.push({
        ...FIXTURE_STAMPS,
        id: 't1',
        surfaceText: 'In',
        gloss: { en: 'in' },
      });

      // Switch to fake timers only for this test so we can advance past the 300ms debounce.
      jest.useFakeTimers();
      act(() => {
        capturedStoreProps?.onSave?.(edited);
      });
      act(() => {
        jest.advanceTimersByTime(300);
      });
      jest.useRealTimers();

      const saveDraftCall = mockSendCommand.mock.calls.find(
        ([command]) => command === 'interlinearizer.saveDraft',
      );
      expect(saveDraftCall?.[1]).toBe(testProjectId);
      const json = saveDraftCall?.[2];
      const persisted: DraftProject = typeof json === 'string' ? JSON.parse(json) : emptyDraft('x');
      expect(persisted.analysis).toEqual(edited);
      expect(persisted.dirty).toBe(true);
    });
  });

  describe('segmentation dispatch', () => {
    /** A two-verse book so boundary edits produce real, non-default deltas. */
    const TWO_VERSE_BOOK: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: [
        makeSegment('GEN 1:1', 'Alpha beta.', [
          makeWordToken('GEN 1:1:0', 'Alpha'),
          makeWordToken('GEN 1:1:6', 'beta', 6),
        ]),
        makeSegment('GEN 1:2', 'Gamma.', [makeWordToken('GEN 1:2:0', 'Gamma')]),
      ],
    };

    /**
     * Reads the segmentation delta back out of the most recent `saveDraft` call.
     *
     * @returns The persisted delta, or `undefined` when no draft has been saved or it carried none.
     */
    function lastPersistedSegmentation(): DraftProject['segmentation'] {
      const calls = mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveDraft');
      const last = calls[calls.length - 1];
      const json = last?.[2];
      return typeof json === 'string' ? JSON.parse(json).segmentation : undefined;
    }

    /**
     * Returns the segmentation dispatch captured from the rendered interlinearizer, failing the
     * test if none was captured.
     *
     * @throws If the interlinearizer did not render and capture a dispatch.
     */
    function getSegmentationDispatch(): SegmentationDispatch {
      const dispatch = capturedInterlinearizerProps?.segmentationDispatch;
      if (!dispatch) throw new Error('expected a captured segmentationDispatch');
      return dispatch;
    }

    it('persists split, merge, and move boundary edits made through the dispatch', async () => {
      mockBookData({ book: TWO_VERSE_BOOK });
      await act(async () => {
        renderLoader();
      });
      const dispatch = getSegmentationDispatch();

      jest.useFakeTimers();
      // Split verse 1 before "beta" — a non-default delta is persisted.
      act(() => dispatch.split('GEN 1:1:6'));
      act(() => jest.advanceTimersByTime(300));
      expect(lastPersistedSegmentation()).toEqual({
        removedVerseStarts: [],
        addedStarts: ['GEN 1:1:6'],
      });

      // Merge verse 2 into its predecessor — adds a removed verse start.
      act(() => dispatch.merge('GEN 1:2:0'));
      act(() => jest.advanceTimersByTime(300));
      expect(lastPersistedSegmentation()?.removedVerseStarts).toContain('GEN 1:2:0');

      // Move the verse-2 boundary back onto "beta". "beta" (GEN 1:1:6) already begins a segment from
      // the split above, so the move removes the (already-removed) verse-2 default start and re-adds
      // the existing "beta" start: the normalized delta is unchanged — verse 1's split boundary and
      // verse 2's merged boundary both persist.
      act(() => dispatch.move('GEN 1:2:0', 'GEN 1:1:6'));
      act(() => jest.advanceTimersByTime(300));
      jest.useRealTimers();
      expect(lastPersistedSegmentation()).toEqual({
        removedVerseStarts: ['GEN 1:2:0'],
        addedStarts: ['GEN 1:1:6'],
      });
    });

    it('re-renders the interlinearizer with the new segments in place after a boundary edit', async () => {
      // The resegmented book is derived from the draft's ref-held segmentation, and the auto-save's
      // `setDirty(true)` no-ops the re-render once the draft is dirty, so the new `book` prop reaches
      // the interlinearizer only because `autosaveSegmentation` bumps a dedicated version. Assert the
      // split reaches the rendered `book` (verse 1 becomes two segments) without a remount.
      mockBookData({ book: TWO_VERSE_BOOK });
      await act(async () => {
        renderLoader();
      });
      const dispatch = getSegmentationDispatch();
      expect(capturedInterlinearizerProps?.book.segments).toHaveLength(2);
      const mountsBefore = interlinearizerMountCount;

      act(() => dispatch.split('GEN 1:1:6'));

      // Verse 1 is now two segments (before/after "beta"), so the book has three segments total, and
      // the interlinearizer was updated in place rather than remounted.
      expect(capturedInterlinearizerProps?.book.segments).toHaveLength(3);
      expect(interlinearizerMountCount).toBe(mountsBefore);
    });

    it('sends the boundary delta on Save and clears the unsaved marker', async () => {
      mockBookData({ book: TWO_VERSE_BOOK });
      let result: ReturnType<typeof renderLoader> | undefined;
      await act(async () => {
        result = renderLoader({
          useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }),
        });
      });
      const dispatch = getSegmentationDispatch();

      // A boundary edit dirties the draft, so the tab marker lights up.
      act(() => dispatch.merge('GEN 1:2:0'));
      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer ●' });

      result?.updateWebViewDefinition.mockClear();
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      // Save sends the draft's boundary delta (not the "null" clear sentinel) alongside the
      // analysis, so the project's boundaries match the analysis just written.
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveAnalysis',
        'proj-1',
        JSON.stringify(emptyAnalysis()),
        JSON.stringify({ removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] }),
      );
      // markSynced received the draft's exact analysis and segmentation references, so its
      // identity guard matched and the unsaved marker cleared.
      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer' });
    });

    it('clears the segmentation field when an edit restores the default segmentation', async () => {
      mockBookData({ book: TWO_VERSE_BOOK });
      await act(async () => {
        renderLoader();
      });
      const dispatch = getSegmentationDispatch();

      jest.useFakeTimers();
      // Merging the book's first token is a no-op, so the result is the default segmentation and the
      // persisted field is cleared to undefined.
      act(() => dispatch.merge('GEN 1:1:0'));
      act(() => jest.advanceTimersByTime(300));
      jest.useRealTimers();
      expect(lastPersistedSegmentation()).toBeUndefined();
    });
  });

  describe('former boundaries', () => {
    /**
     * A four-verse book covering every former-boundary shape: a word-initial verse (1:3), a verse
     * that begins with punctuation so its first word token differs from its first token (1:2), a
     * verse with no word token at all (1:4), and a token-less verse (1:5).
     */
    const BOUNDARY_SHAPES_BOOK: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: [
        makeSegment('GEN 1:1', 'Alpha.', [makeWordToken('GEN 1:1:0', 'Alpha')]),
        makeSegment('GEN 1:2', '“Gamma.', [
          makePunctToken('GEN 1:2:0', '“'),
          makeWordToken('GEN 1:2:1', 'Gamma', 1),
        ]),
        makeSegment('GEN 1:3', 'Delta.', [makeWordToken('GEN 1:3:0', 'Delta')]),
        makeSegment('GEN 1:4', '—', [makePunctToken('GEN 1:4:0', '—')]),
        makeSegment('GEN 1:5', '', []),
      ],
    };

    /**
     * Renders the loader on {@link BOUNDARY_SHAPES_BOOK} and returns the captured segmentation
     * dispatch so a test can drive boundary edits.
     *
     * @throws If the interlinearizer did not render and capture a dispatch.
     */
    async function renderBoundaryBook(): Promise<SegmentationDispatch> {
      mockBookData({ book: BOUNDARY_SHAPES_BOOK });
      await act(async () => {
        renderLoader();
      });
      const dispatch = capturedInterlinearizerProps?.segmentationDispatch;
      if (!dispatch) throw new Error('expected a captured segmentationDispatch');
      return dispatch;
    }

    it('passes an empty formerBoundaries map and segmentationVersion 0 before any boundary edit', async () => {
      await renderBoundaryBook();

      expect(capturedInterlinearizerProps?.formerBoundaries.size).toBe(0);
      expect(capturedInterlinearizerProps?.segmentationVersion).toBe(0);
    });

    it('maps a merged word-initial verse start to itself and bumps segmentationVersion', async () => {
      const dispatch = await renderBoundaryBook();

      // Merge verse 3 into verse 2: the verse begins with a word token, so the split anchor (its
      // first word token) and the removed default start are the same ref.
      act(() => dispatch.merge('GEN 1:3:0'));

      expect(capturedInterlinearizerProps?.formerBoundaries.get('GEN 1:3:0')).toBe('GEN 1:3:0');
      expect(capturedInterlinearizerProps?.segmentationVersion).toBe(1);
    });

    it('keys a punct-initial merged verse by its first word token, mapped to the removed start', async () => {
      const dispatch = await renderBoundaryBook();

      // Merge verse 2 into verse 1: the verse opens with a quote mark, so the boundary slot's word
      // anchor (the first word token) differs from the removed default start (the punct token).
      act(() => dispatch.merge('GEN 1:2:0'));

      expect(capturedInterlinearizerProps?.formerBoundaries.get('GEN 1:2:1')).toBe('GEN 1:2:0');
      expect(capturedInterlinearizerProps?.formerBoundaries.has('GEN 1:2:0')).toBe(false);
    });

    it('skips a merged-away verse that has no word token', async () => {
      const dispatch = await renderBoundaryBook();

      // Merge verse 4 (punctuation only) into verse 3: with no word token there is no split anchor
      // to key the former boundary by, so the verse contributes no map entry.
      act(() => dispatch.merge('GEN 1:4:0'));

      expect(capturedInterlinearizerProps?.formerBoundaries.size).toBe(0);
    });

    it('does not map verses whose default start was not merged away', async () => {
      const dispatch = await renderBoundaryBook();

      // Only verse 3 is merged; the other verses keep their default boundaries and must stay out
      // of the map so their slots do not render former-boundary ticks.
      act(() => dispatch.merge('GEN 1:3:0'));

      expect(capturedInterlinearizerProps?.formerBoundaries.size).toBe(1);
      expect(capturedInterlinearizerProps?.formerBoundaries.has('GEN 1:1:0')).toBe(false);
      expect(capturedInterlinearizerProps?.formerBoundaries.has('GEN 1:2:1')).toBe(false);
    });

    it('shows the loading state when the book unloads while the draft holds removals', async () => {
      // Render with a rebuildable element so the same loader instance can be re-invoked after the
      // book-data mock changes (the mock mutates hook output, not React state).
      mockBookData({ book: BOUNDARY_SHAPES_BOOK });
      const updateWebViewDefinition = jest.fn(() => true);
      const scrollGroupHook = makeScrollGroupHook();
      const webViewState = makeWebViewState();
      const buildUi = () => (
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={scrollGroupHook}
          useWebViewState={webViewState}
          updateWebViewDefinition={updateWebViewDefinition}
        />
      );
      let view: ReturnType<typeof render> | undefined;
      await act(async () => {
        view = render(buildUi());
      });
      const dispatch = capturedInterlinearizerProps?.segmentationDispatch;
      if (!dispatch) throw new Error('expected a captured segmentationDispatch');
      // Merge so the draft's delta has a removed verse start.
      act(() => dispatch.merge('GEN 1:3:0'));
      expect(capturedInterlinearizerProps?.formerBoundaries.size).toBe(1);

      // The book unloads (e.g. a cross-book swap): with no verse book to resolve refs against, the
      // former boundaries cannot be derived and the loader falls back to the loading curtain.
      mockBookData({ book: undefined, isLoading: true });
      view?.rerender(buildUi());

      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
      expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument();
    });
  });

  describe('lost segment boundaries', () => {
    /** A two-verse book the deltas below anchor into. */
    const TWO_VERSE_BOOK: Book = {
      id: 'GEN',
      bookRef: 'GEN',
      textVersion: 'v1',
      segments: [
        makeSegment('GEN 1:1', 'Alpha beta.', [
          makeWordToken('GEN 1:1:0', 'Alpha'),
          makeWordToken('GEN 1:1:6', 'beta', 6),
        ]),
        makeSegment('GEN 1:2', 'Gamma.', [makeWordToken('GEN 1:2:0', 'Gamma')]),
      ],
    };

    /**
     * Renders the loader on {@link TWO_VERSE_BOOK} with the given persisted boundary delta,
     * returning a `rerenderNow` that re-invokes the _same_ loader instance — the book-data mock
     * mutates hook output rather than React state, so a rerender is what picks up a changed book.
     */
    async function renderWithSegmentation(
      segmentation: DraftProject['segmentation'],
    ): Promise<{ rerenderNow: () => void }> {
      mockBookData({ book: TWO_VERSE_BOOK });
      mockSendCommand.mockResolvedValue(
        JSON.stringify({ ...emptyDraft(testProjectId), segmentation }),
      );
      const scrollGroupHook = makeScrollGroupHook();
      const webViewState = makeWebViewState();
      const buildUi = () => (
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={scrollGroupHook}
          useWebViewState={webViewState}
          updateWebViewDefinition={jest.fn(() => true)}
        />
      );
      let view: ReturnType<typeof render> | undefined;
      await act(async () => {
        view = render(buildUi());
      });
      return { rerenderNow: () => view?.rerender(buildUi()) };
    }

    it('shows the banner when the source no longer has the anchored tokens', async () => {
      await renderWithSegmentation({
        removedVerseStarts: ['GEN 1:9:0'],
        addedStarts: ['GEN 1:1:99'],
      });

      expect(screen.getByTestId('lost-boundaries-banner')).toBeInTheDocument();
    });

    it('does not show the banner when every anchor still resolves', async () => {
      await renderWithSegmentation({
        removedVerseStarts: ['GEN 1:2:0'],
        addedStarts: ['GEN 1:1:6'],
      });

      expect(screen.queryByTestId('lost-boundaries-banner')).not.toBeInTheDocument();
    });

    it('does not show the banner for the default segmentation', async () => {
      await renderWithSegmentation(undefined);

      expect(screen.queryByTestId('lost-boundaries-banner')).not.toBeInTheDocument();
    });

    it('holds the banner back until the localized strings resolve', async () => {
      jest
        .mocked(useLocalizedStrings)
        .mockImplementation((keys: readonly string[]) => [
          Object.fromEntries(keys.map((k) => [k, k])),
          true,
        ]);

      await renderWithSegmentation({
        removedVerseStarts: ['GEN 1:9:0'],
        addedStarts: ['GEN 1:1:99'],
      });

      expect(screen.queryByTestId('lost-boundaries-banner')).not.toBeInTheDocument();
    });

    it('interpolates the lost-anchor count into the banner text', async () => {
      jest
        .mocked(useLocalizedStrings)
        .mockImplementation((keys: readonly string[]) => [
          Object.fromEntries(
            keys.map((k) => [
              k,
              k === '%interlinearizer_segmentation_lostBoundaries%' ? '{count} boundaries lost' : k,
            ]),
          ),
          false,
        ]);

      await renderWithSegmentation({
        removedVerseStarts: ['GEN 1:9:0'],
        addedStarts: ['GEN 1:1:99'],
      });

      expect(screen.getByTestId('lost-boundaries-banner')).toHaveTextContent('2 boundaries lost');
    });

    it('uses the singular string for a single lost anchor', async () => {
      jest
        .mocked(useLocalizedStrings)
        .mockImplementation((keys: readonly string[]) => [
          Object.fromEntries(
            keys.map((k) => [
              k,
              k === '%interlinearizer_segmentation_lostBoundaries_one%' ? 'just the one' : k,
            ]),
          ),
          false,
        ]);

      await renderWithSegmentation({ removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] });

      expect(screen.getByTestId('lost-boundaries-banner')).toHaveTextContent('just the one');
    });

    it('keeps the banner up across a re-tokenization that loses the same anchors', async () => {
      const view = await renderWithSegmentation({
        removedVerseStarts: ['GEN 1:9:0'],
        addedStarts: [],
      });
      expect(screen.getByTestId('lost-boundaries-banner')).toBeInTheDocument();

      // A source edit re-tokenizes to a fresh Book; the loss stands, so the banner simply stays.
      mockBookData({ book: { ...TWO_VERSE_BOOK } });
      await act(async () => {
        view.rerenderNow();
      });

      expect(screen.getByTestId('lost-boundaries-banner')).toBeInTheDocument();
    });

    it('shows the banner for a project opened into the already-loaded book', async () => {
      const view = await renderWithSegmentation({
        removedVerseStarts: ['GEN 1:2:0'],
        addedStarts: [],
      });
      expect(screen.queryByTestId('lost-boundaries-banner')).not.toBeInTheDocument();

      // Open replaces the draft wholesale without touching the loaded book.
      openableProjectForStub = {
        analysis: emptyAnalysis(),
        analysisLanguages: ['en'],
        segmentation: { removedVerseStarts: ['GEN 1:9:0'], addedStarts: [] },
      };
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await act(async () => {
        await userEvent.click(screen.getByTestId('select-modal-open-project'));
      });
      view.rerenderNow();

      expect(screen.getByTestId('lost-boundaries-banner')).toBeInTheDocument();
    });

    it('does not show the banner for anchors in a book other than the loaded one', async () => {
      await renderWithSegmentation({
        removedVerseStarts: ['EXO 1:5:0'],
        addedStarts: ['EXO 1:1:6'],
      });

      expect(screen.queryByTestId('lost-boundaries-banner')).not.toBeInTheDocument();
    });

    it('leaves the dead anchors in the draft so they revive if the source comes back', async () => {
      const segmentation = { removedVerseStarts: ['GEN 1:9:0'], addedStarts: ['GEN 1:1:99'] };
      await renderWithSegmentation(segmentation);

      // The banner is read-only: nothing persists a pruned delta in response to it.
      const saves = mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveDraft');
      expect(saves).toHaveLength(0);
    });
  });

  describe('save command', () => {
    it('saves the draft analysis to the active project when Save is clicked with an active project', async () => {
      const draftAnalysis = emptyAnalysis();
      draftAnalysis.tokenAnalyses.push({
        ...FIXTURE_STAMPS,
        id: 't1',
        surfaceText: 'In',
        gloss: { en: 'in' },
      });
      mockSendCommand.mockResolvedValueOnce(
        JSON.stringify({ ...emptyDraft(testProjectId), analysis: draftAnalysis }),
      );
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveAnalysis',
        'proj-1',
        JSON.stringify(draftAnalysis),
        // The draft has no custom boundaries, so Save sends "null" to clear any stored ones.
        'null',
      );
    });

    it('refreshes the cached activeProject updatedAt from the saveAnalysis response', async () => {
      // saveAnalysis returns the persisted project carrying the storage-refreshed updatedAt; every
      // other command keeps its default (the empty-draft load) so the editor still mounts.
      mockSendCommand.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.saveAnalysis'
          ? JSON.stringify({ ...STUB_ACTIVE_PROJECT, updatedAt: '2026-02-02T00:00:00Z' })
          : JSON.stringify(emptyDraft(testProjectId)),
      );
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
      );
      // The stubbed active project starts with no Modified time cached.
      expect(screen.getByTestId('project-modals')).not.toHaveAttribute(
        'data-active-project-updated',
      );

      // Dirty the draft so the post-save markSynced flips dirty back off, forcing the re-render that
      // reflects the newly cached updatedAt down to the ProjectModals stub.
      act(() => {
        capturedStoreProps?.onSave?.(emptyAnalysis());
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      // The stub surfaces the cached activeProject's updatedAt, so the refreshed value proves the
      // fold reached WebView state.
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-02-02T00:00:00Z',
      );
    });

    it('leaves the cached activeProject untouched when the saveAnalysis response is malformed', async () => {
      const seeded: MockProject = { ...STUB_ACTIVE_PROJECT, updatedAt: '2026-01-01T00:00:00Z' };
      // saveAnalysis returns a payload with no `updatedAt` (e.g. an unexpected shape), so there is
      // nothing to fold in; other commands keep the default empty-draft load.
      mockSendCommand.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.saveAnalysis'
          ? JSON.stringify({ notAProject: true })
          : JSON.stringify(emptyDraft(testProjectId)),
      );
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: seeded }) }),
      );

      act(() => {
        capturedStoreProps?.onSave?.(emptyAnalysis());
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      // The previously cached Modified time is preserved rather than being cleared.
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-01-01T00:00:00Z',
      );
    });

    it('leaves the cache untouched and the draft dirty when saveAnalysis reports the project is gone', async () => {
      const seeded: MockProject = { ...STUB_ACTIVE_PROJECT, updatedAt: '2026-01-01T00:00:00Z' };
      // saveAnalysis resolves to `undefined` (the project no longer exists), so the loader has no
      // response body to parse and the cache is left as-is.
      mockSendCommand.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.saveAnalysis'
          ? undefined
          : JSON.stringify(emptyDraft(testProjectId)),
      );
      let result: ReturnType<typeof renderLoader> | undefined;
      await act(async () => {
        result = renderLoader({ useWebViewState: makeWebViewState({ activeProject: seeded }) });
      });
      const updateWebViewDefinition = result?.updateWebViewDefinition;

      // Dirty the draft so the unsaved marker appears, then attempt the doomed Save.
      act(() => {
        capturedStoreProps?.onSave?.(emptyAnalysis());
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer ●' });

      updateWebViewDefinition?.mockClear();
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-01-01T00:00:00Z',
      );
      // Nothing was persisted, so the draft must stay dirty: the marker is never cleared.
      expect(updateWebViewDefinition).not.toHaveBeenCalledWith({ title: 'Interlinearizer' });
    });

    it('marks the draft synced after a successful Save, clearing the tab unsaved marker', async () => {
      let result: ReturnType<typeof renderLoader> | undefined;
      await act(async () => {
        result = renderLoader({
          useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }),
        });
      });
      const updateWebViewDefinition = result?.updateWebViewDefinition;

      // Dirty the draft via an edit so the marker appears, then Save.
      act(() => {
        capturedStoreProps?.onSave?.(emptyAnalysis());
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer ●' });

      updateWebViewDefinition?.mockClear();
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer' });
    });

    it('shows the tab unsaved marker for in-progress typing before the gloss commits', async () => {
      let result: ReturnType<typeof renderLoader> | undefined;
      await act(async () => {
        result = renderLoader();
      });
      const updateWebViewDefinition = result?.updateWebViewDefinition;

      // A gloss input begins holding uncommitted text: the marker appears even though no gloss has
      // been written (the persisted draft is still clean).
      act(() => {
        capturedStoreProps?.onPendingEditsChange?.(true);
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer ●' });

      // The edit is reverted or the input unmounts with nothing committed: the marker clears.
      updateWebViewDefinition?.mockClear();
      act(() => {
        capturedStoreProps?.onPendingEditsChange?.(false);
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer' });
    });

    it('reports in-progress typing to ProjectModals as unsaved work so a swap is guarded', async () => {
      await act(async () => {
        renderLoader();
      });

      // The persisted draft is clean, so the modal starts with no unsaved work to guard.
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-has-unsaved-work',
        'false',
      );

      // A gloss input begins holding uncommitted text. Even though nothing has committed (the draft
      // stays clean), ProjectModals must now treat the draft as having unsaved work so opening or
      // creating a project prompts before discarding the in-progress gloss.
      act(() => {
        capturedStoreProps?.onPendingEditsChange?.(true);
      });
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-has-unsaved-work', 'true');
    });

    it('drops the unsaved-work guard once in-progress typing is abandoned', async () => {
      await act(async () => {
        renderLoader();
      });

      act(() => {
        capturedStoreProps?.onPendingEditsChange?.(true);
      });
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-has-unsaved-work', 'true');

      // The edit is reverted or the input unmounts with nothing committed: the guard clears.
      act(() => {
        capturedStoreProps?.onPendingEditsChange?.(false);
      });
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-has-unsaved-work',
        'false',
      );
    });

    it('logs an error when the saveAnalysis command rejects during Save', async () => {
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
      );

      const error = new Error('save failed');
      mockSendCommand.mockRejectedValueOnce(error);
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
        'Interlinearizer: failed to save draft to project',
        error,
      );
    });

    it('opens the Save As modal when Save is clicked with no active project', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'saveAs');
      expect(screen.getByTestId('save-as-modal')).toBeInTheDocument();
      // Nothing was saved to a project since there is no Save target.
      expect(
        mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveAnalysis'),
      ).toHaveLength(0);
    });

    it('opens the Save As modal when the openSaveAsModal menu item is clicked', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-save-as'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'saveAs');
    });
  });

  describe('analysis catalog command', () => {
    it('opens the catalog panel beside the interlinear view', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(screen.getByTestId('analysis-catalog-panel')).toBeInTheDocument();
      // The panel sits beside the view rather than replacing it: jump-to-usage navigates the view
      // while the catalog stays open, which is impossible if opening unmounted it.
      expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
    });

    it('keeps the catalog panel out of the wrapper the cross-book fade dims', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(screen.getByTestId('book-fade-wrapper')).not.toContainElement(
        screen.getByTestId('analysis-catalog-panel'),
      );
    });

    it('closes the catalog panel from its own close control', async () => {
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      await userEvent.click(screen.getByTestId('analysis-catalog-close'));

      expect(screen.queryByTestId('analysis-catalog-panel')).not.toBeInTheDocument();
    });

    it('restores an open catalog panel from WebView state on remount', async () => {
      const useWebViewState = makeWebViewState();
      await act(async () => {
        renderLoader({ useWebViewState });
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      // A fresh render against the same state store stands in for the tab being restored.
      cleanup();
      await act(async () => {
        renderLoader({ useWebViewState });
      });

      expect(screen.getByTestId('analysis-catalog-panel')).toBeInTheDocument();
    });

    it('restores a resized catalog panel to its remembered layout on remount', async () => {
      // Resized by the mirrored arrow, that being the press the extension answers itself: dragging
      // needs measurement jsdom does not do, and the platform handle owns Home and End.
      document.documentElement.dir = 'rtl';
      try {
        const useWebViewState = makeWebViewState();
        await act(async () => {
          renderLoader({ useWebViewState });
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        // A step lands somewhere the default is not, so a layout read back on remount can only be
        // a stored one.
        fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'ArrowRight' });

        cleanup();
        await act(async () => {
          renderLoader({ useWebViewState });
        });

        expect(catalogPanelElement()).toHaveAttribute('data-panel-layout', '30');
      } finally {
        document.documentElement.removeAttribute('dir');
      }
    });

    it('restores a resized catalog panel to its remembered layout on reopening', async () => {
      // Closing unmounts the catalog's panel while its group stays mounted, and a group reports a
      // layout over the panels it still has — a report that, stored, would lose the resize.
      document.documentElement.dir = 'rtl';
      try {
        await act(async () => {
          renderLoader();
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'ArrowRight' });

        await userEvent.click(screen.getByTestId('analysis-catalog-close'));
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        expect(catalogPanelElement()).toHaveAttribute('data-panel-layout', '30');
      } finally {
        document.documentElement.removeAttribute('dir');
      }
    });

    it('restores a remembered layout the group never mounted with', async () => {
      // Closing before the remount is what makes this the restoring effect's own test: a group that
      // mounts with the catalog open seeds itself from the stored layout, and one that never
      // unmounts holds the layout across a reopening, either of which would carry the width without
      // the effect. Mounting closed leaves the group knowing only of the view, so a layout naming
      // the catalog reaches it only by being applied as the panel joins.
      document.documentElement.dir = 'rtl';
      try {
        const useWebViewState = makeWebViewState();
        await act(async () => {
          renderLoader({ useWebViewState });
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'ArrowRight' });

        await userEvent.click(screen.getByTestId('analysis-catalog-close'));
        cleanup();
        await act(async () => {
          renderLoader({ useWebViewState });
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        expect(catalogPanelElement()).toHaveAttribute('data-panel-layout', '30');
      } finally {
        document.documentElement.removeAttribute('dir');
      }
    });

    it('restores the remembered layout only once the catalog panel has joined the group', async () => {
      // Reopening restores a layout naming both panels, which a group refuses outright while it
      // still knows only of the view — a throw that takes the WebView down rather than misplacing
      // the panel, hence a presence assertion. The width itself is left to the layout tests above:
      // jsdom measures the group at zero, so it reports no layout to read back here.
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      await userEvent.click(screen.getByTestId('analysis-catalog-close'));

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(screen.getByTestId('analysis-catalog-panel')).toBeInTheDocument();
    });

    it('moves the catalog panel on the press that resized it, not only on the next mount', async () => {
      document.documentElement.dir = 'rtl';
      try {
        await act(async () => {
          renderLoader();
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'ArrowRight' });

        // The group reads its defaultLayout only while every panel it names is mounted, so the
        // panel can only have moved by the press itself rather than by the layout reaching state.
        //
        // Landing one step along also holds the press to the unit the group reports in: the group
        // rescales whatever layout it is handed to sum to 100, so a step taken in fractions while
        // bounded by percentages clamps to an end of the range instead of moving this far.
        expect(catalogPanelElement()).toHaveAttribute('data-panel-layout', '30');
      } finally {
        document.documentElement.removeAttribute('dir');
      }
    });

    it('stores the width a bounded press settled on rather than the one it asked for', async () => {
      // Home aims the catalog narrower than its pixel floor allows, so the group holds it at that
      // floor instead. Arrows and jumps resize only in a right-to-left interface, the platform
      // handle already reading them correctly in a left-to-right one.
      document.documentElement.dir = 'rtl';
      try {
        const useWebViewState = makeWebViewState();
        await act(async () => {
          renderLoader({ useWebViewState });
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        fireEvent.keyDown(screen.getByTestId('analysis-catalog-resize'), { key: 'Home' });

        // Read back on a remount, which lays the group out from what was stored, so the assertion
        // covers the stored layout rather than only the one on screen.
        cleanup();
        await act(async () => {
          renderLoader({ useWebViewState });
        });

        // The catalog's narrowest width as a percentage of the width the mock group resolves pixel
        // limits against, rather than the narrower one the press aimed at.
        expect(catalogPanelElement()).toHaveAttribute('data-panel-layout', '22');
      } finally {
        document.documentElement.removeAttribute('dir');
      }
    });

    it('keeps the interlinear view mounted as the catalog opens', async () => {
      // Identity rather than presence: a view that changed place in the tree as the catalog
      // appeared would still be found here, having remounted and lost everything it holds locally
      // — where the segment list was scrolled to, a gloss typed but not yet committed.
      await act(async () => {
        renderLoader();
      });
      const viewBeforeOpening = screen.getByTestId('interlinearizer');

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(screen.getByTestId('interlinearizer')).toBe(viewBeforeOpening);
    });

    it('keeps the interlinear view mounted as the catalog closes', async () => {
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      const viewBeforeClosing = screen.getByTestId('interlinearizer');

      await userEvent.click(screen.getByTestId('analysis-catalog-close'));

      expect(screen.getByTestId('interlinearizer')).toBe(viewBeforeClosing);
    });

    it('leaves the catalog panel closed on remount when it was never opened', async () => {
      const useWebViewState = makeWebViewState();
      await act(async () => {
        renderLoader({ useWebViewState });
      });

      cleanup();
      await act(async () => {
        renderLoader({ useWebViewState });
      });

      expect(screen.queryByTestId('analysis-catalog-panel')).not.toBeInTheDocument();
    });
  });

  describe('wipe command', () => {
    it('opens the wipe dialog with the active-book flag set when a book is loaded', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-wipe'));

      // The dialog must appear before anything is wiped, with the loaded book reflected.
      expect(screen.getByTestId('wipe-modal-panel')).toHaveAttribute(
        'data-has-active-book',
        'true',
      );
      expect(
        mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveDraft'),
      ).toHaveLength(0);
    });

    it('wipes the current book through the draft after confirming the book scope', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-wipe'));
      await userEvent.click(screen.getByTestId('wipe-confirm-book'));

      // Confirming a book wipe replaces the draft (saveDraft) and dismisses the dialog.
      expect(
        mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveDraft').length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId('wipe-modal-panel')).not.toBeInTheDocument();
    });

    it('wipes the whole draft through the draft after confirming the all scope', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-wipe'));
      await userEvent.click(screen.getByTestId('wipe-confirm-all'));

      const wiped: DraftProject | undefined = (() => {
        const call = [...mockSendCommand.mock.calls]
          .reverse()
          .find(([c]) => c === 'interlinearizer.saveDraft');
        const json = call?.[2];
        return typeof json === 'string' ? JSON.parse(json) : undefined;
      })();
      expect(wiped?.analysis).toEqual(emptyAnalysis());
      // Wiping the whole draft is treated as a clean baseline, so it persists not-dirty.
      expect(wiped?.dirty).toBe(false);
      expect(screen.queryByTestId('wipe-modal-panel')).not.toBeInTheDocument();
    });

    it('leaves the draft untouched when the wipe dialog is canceled', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-wipe'));
      mockSendCommand.mockClear();
      await userEvent.click(screen.getByTestId('wipe-modal-cancel'));

      expect(screen.queryByTestId('wipe-modal-panel')).not.toBeInTheDocument();
      expect(
        mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveDraft'),
      ).toHaveLength(0);
    });
  });

  describe('tab unsaved-changes marker', () => {
    it('reports the plain tab title while the draft is clean', async () => {
      let result: ReturnType<typeof renderLoader> | undefined;
      await act(async () => {
        result = renderLoader();
      });

      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer' });
      expect(result?.updateWebViewDefinition).not.toHaveBeenCalledWith({
        title: 'Interlinearizer ●',
      });
    });

    it('appends the unsaved marker to the tab title after an autosave dirties the draft', async () => {
      let result: ReturnType<typeof renderLoader> | undefined;
      await act(async () => {
        result = renderLoader();
      });

      act(() => {
        capturedStoreProps?.onSave?.(emptyAnalysis());
      });

      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer ●' });
    });
  });

  describe('phrase mode plumbing', () => {
    it('forwards setPhraseMode through to Interlinearizer', async () => {
      await act(async () => {
        renderLoader();
      });

      expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' });
      expect(typeof capturedInterlinearizerProps?.setPhraseMode).toBe('function');
    });

    it('updates the captured phraseMode when setPhraseMode is invoked', async () => {
      await act(async () => {
        renderLoader();
      });

      const originalTokens: PhraseAnalysisLink['tokens'] = [
        { tokenRef: 'tok-1', surfaceText: 'In' },
      ];
      act(() => {
        capturedInterlinearizerProps?.setPhraseMode({
          kind: 'edit',
          phraseId: 'phrase-1',
          originalTokens,
        });
      });

      expect(capturedInterlinearizerProps?.phraseMode).toEqual({
        kind: 'edit',
        phraseId: 'phrase-1',
        originalTokens,
      });
    });

    it('resets phraseMode to view when the draft is replaced (wipe)', async () => {
      await act(async () => {
        renderLoader();
      });

      // Enter edit mode.
      const originalTokens: PhraseAnalysisLink['tokens'] = [
        { tokenRef: 'tok-1', surfaceText: 'In' },
      ];
      act(() => {
        capturedInterlinearizerProps?.setPhraseMode({
          kind: 'edit',
          phraseId: 'phrase-1',
          originalTokens,
        });
      });
      expect(capturedInterlinearizerProps?.phraseMode.kind).toBe('edit');

      // Wiping the whole draft bumps draftVersion, which the loader watches to reset phraseMode.
      await userEvent.click(screen.getByTestId('tab-toolbar-wipe'));
      await userEvent.click(screen.getByTestId('wipe-confirm-all'));

      expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' });
    });
  });

  describe('cross-book fade curtain', () => {
    /**
     * Reads the live opacity of the book-fade wrapper the loader renders from the context's fade
     * phase.
     */
    function fadeOpacity(): string {
      return screen.getByTestId('book-fade-wrapper').style.opacity;
    }

    /**
     * Builds a scroll-group hook whose reference can be restaged between rerenders. A fresh object
     * identity is required each change so the provider adopts it as a new `scrRef`.
     */
    function makeMutableScrollGroupHook(
      initial: SerializedVerseRef,
    ): [() => ScrollGroupTuple, (n: SerializedVerseRef) => void] {
      let current = initial;
      const hook = (): ScrollGroupTuple => [current, () => {}, undefined, () => {}, undefined];
      return [
        hook,
        (next) => {
          current = next;
        },
      ];
    }

    /**
     * Renders the loader with a mutable scroll-group hook, returning a `rerenderNow` that rebuilds
     * a fresh element so React re-invokes the component (the stub mutates a closure variable, not
     * state, so an identical element would let React bail out).
     */
    function renderFadeLoader(initial: SerializedVerseRef) {
      const [scrollGroupHook, setRef] = makeMutableScrollGroupHook(initial);
      const webViewState = makeWebViewState();
      const updateWebViewDefinition = jest.fn(() => true);
      const buildUi = () => (
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={scrollGroupHook}
          useWebViewState={webViewState}
          updateWebViewDefinition={updateWebViewDefinition}
        />
      );
      const { rerender } = render(buildUi());
      return { setRef, rerenderNow: () => rerender(buildUi()) };
    }

    it('fades the content out the moment scrRef names a new book', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await act(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      // Initial GEN load shows no fade.
      expect(fadeOpacity()).toBe('1');

      // External jump to MAT: the context detects the book change and the curtain fades out.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      mockBookData({ book: undefined, isLoading: true });
      controls?.rerenderNow();
      expect(fadeOpacity()).toBe('0');
    });

    it('drops the curtain instantly (no transition) during the fade-out', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await act(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      const wrapper = () => screen.getByTestId('book-fade-wrapper');
      // At idle the shared recenter timing is armed for the next rise.
      expect(wrapper().style.transitionDuration).toBe(`${RECENTER_FADE_MS}ms`);

      // Cross-book jump: the old book is swapped for Loading… in the same commit, so a gradual
      // descent has nothing to fade — it would only let a fast-loading new book ghost in at
      // partial opacity (the "false-start fade"). The descent must be instant.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      mockBookData({ book: undefined, isLoading: true });
      controls?.rerenderNow();
      expect(fadeOpacity()).toBe('0');
      expect(wrapper().style.transitionDuration).toBe('0ms');
    });

    it('shows the Loading curtain (not the old book) during a cross-book swap', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await act(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 5 });
      });
      expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();

      // Cross-book jump to MAT while the loaded book is still GEN (before the USJ arrives and
      // Interlinearizer remounts). The loader shows the Loading curtain rather than the previous
      // book's views, so nothing of either book is visible until the new one mounts and fades in.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      controls?.rerenderNow();
      expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument();
      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();

      // Once MAT's book data arrives, Interlinearizer mounts on it and receives the live MAT ref.
      mockBookData({ book: { ...GEN_1_1_BOOK, id: 'MAT', bookRef: 'MAT' } });
      controls?.rerenderNow();
      expect(capturedInterlinearizerProps?.scrRef).toEqual({
        book: 'MAT',
        chapterNum: 5,
        verseNum: 3,
      });
    });

    it('remounts Interlinearizer on a book change but not on a same-book verse change', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await act(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      expect(interlinearizerMountCount).toBe(1);

      // A same-book verse change must keep the same Interlinearizer instance (no remount): its
      // scroll/focus state and in-component recenter fade carry the within-book navigation.
      controls?.setRef({ book: 'GEN', chapterNum: 1, verseNum: 40 });
      controls?.rerenderNow();
      expect(interlinearizerMountCount).toBe(1);

      // A book change must tear down the old instance and mount a fresh one keyed by the new book, so
      // it never updates in place against carried-over (wrong-book) scroll/focus state.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      mockBookData({ book: { ...GEN_1_1_BOOK, id: 'MAT', bookRef: 'MAT' } });
      controls?.rerenderNow();
      expect(interlinearizerMountCount).toBe(2);
    });

    it('reveals the error instead of staying faded when the new book fails to load', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await act(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      expect(fadeOpacity()).toBe('1');

      // Cross-book nav whose target book errors: cancelFade must reveal the content rather than
      // leave the error hidden behind a curtain that will never receive a settle.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      mockBookData({ book: undefined, bookError: 'No USJ book available' });
      controls?.rerenderNow();
      expect(fadeOpacity()).toBe('1');
      expect(screen.getByText('No USJ book available')).toBeInTheDocument();
    });

    it('does not fade for a same-book external navigation', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await act(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      expect(fadeOpacity()).toBe('1');

      // A verse change within the same book keeps Interlinearizer mounted; the loader curtain stays
      // up (its own in-component fade handles within-book recenters).
      controls?.setRef({ book: 'GEN', chapterNum: 1, verseNum: 40 });
      controls?.rerenderNow();
      expect(fadeOpacity()).toBe('1');
    });
  });
});

/** LUK counterpart to `GEN_1_1_BOOK`, so a book change has a second book to land on. */
const LUK_1_1_BOOK: Book = {
  id: 'LUK',
  bookRef: 'LUK',
  textVersion: 'v1',
  segments: [
    {
      id: 'LUK 1:1',
      startRef: { book: 'LUK', chapter: 1, verse: 1 },
      endRef: { book: 'LUK', chapter: 1, verse: 1 },
      baselineText: 'Since many',
      tokens: [
        {
          ref: 'LUK 1:1:0',
          surfaceText: 'Since',
          writingSystem: 'en',
          type: 'word',
          charStart: 0,
          charEnd: 5,
        },
      ],
      verseStarts: [{ charStart: 0, number: '1', chapter: 1 }],
    },
  ],
};

describe('analysis store lifetime', () => {
  beforeEach(() => {
    mountStoreProbe = true;
    probeStore = undefined;
    probeWriteGloss = undefined;
    capturedInterlinearizerProps = undefined;
    capturedStoreProps = undefined;
    interlinearizerMountCount = 0;
    mockBookData();
    mockOptimisticSetting();
    mockSendCommand.mockResolvedValue(JSON.stringify(emptyDraft(testProjectId)));
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
    mockSettings();
  });

  afterEach(() => {
    mountStoreProbe = false;
  });

  it('keeps one analysis store across a book change', async () => {
    // The store holds the whole draft, not one book, so its lifetime is the draft's. A store rebuilt
    // per book would also tear down everything mounted inside it — which is where the analysis
    // catalog lives, and the catalog's whole point is clicking usage after usage across books.
    let scrRef: SerializedVerseRef = { book: 'GEN', chapterNum: 1, verseNum: 1 };
    const webViewState = makeWebViewState();
    const element = () => (
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={() => [scrRef, () => {}, undefined, () => {}, undefined]}
        useWebViewState={webViewState}
        updateWebViewDefinition={jest.fn(() => true)}
      />
    );

    const { rerender } = render(element());
    await act(async () => {});
    const storeBefore = probeStore;
    expect(storeBefore).toBeDefined();

    // Navigate to another book: the reference moves first, then that book's data arrives.
    scrRef = { book: 'LUK', chapterNum: 1, verseNum: 1 };
    mockBookData({ book: LUK_1_1_BOOK });
    await act(async () => {
      rerender(element());
    });

    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
    expect(probeStore).toBe(storeBefore);
  });

  it('rebuilds the store when the draft is replaced wholesale', async () => {
    // The store's seed is not reactive, so a replacement (New / Open / Wipe) reseeds by remounting
    // the provider. Hoisting it above the book key must not cost that: a wiped draft whose store
    // kept the old analysis would show glosses the draft no longer contains.
    await act(async () => renderLoader());
    const storeBefore = probeStore;

    act(() => probeWriteGloss?.('GEN 1:1:0', 'In', 'beginning'));
    await act(async () => {
      screen.getByTestId('tab-toolbar-wipe').click();
    });
    await act(async () => {
      screen.getByTestId('wipe-confirm-all').click();
    });

    expect(probeStore).not.toBe(storeBefore);
    expect(capturedStoreProps?.initialAnalysis).toEqual(emptyAnalysis());
  });
});
