/** @file Unit tests for components/InterlinearizerLoader.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings, useSetting } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book, DraftProject, PhraseAnalysisLink, TextAnalysis } from 'interlinearizer';
import type { Dispatch, SetStateAction } from 'react';
import InterlinearizerLoader from '../../components/InterlinearizerLoader';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import type { PhraseMode } from '../../types/phrase-mode';
import type { ViewOptions } from '../../types/view-options';
import { GEN_1_1_BOOK, makeScrollGroupHook, makeWebViewState } from '../test-helpers';

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
    chapterLabelInVerse,
    onChapterLabelInVerseChange,
    showMorphology,
    onShowMorphologyChange,
    showFreeTranslation,
    onShowFreeTranslationChange,
  }: {
    continuousScroll: boolean;
    onContinuousScrollChange: (v: boolean) => void;
    hideInactiveLinkButtons: boolean;
    onHideInactiveLinkButtonsChange: (v: boolean) => void;
    simplifyPhrases: boolean;
    onSimplifyPhrasesChange: (v: boolean) => void;
    chapterLabelInVerse: boolean;
    onChapterLabelInVerseChange: (v: boolean) => void;
    showMorphology: boolean;
    onShowMorphologyChange: (v: boolean) => void;
    showFreeTranslation: boolean;
    onShowFreeTranslationChange: (v: boolean) => void;
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
        aria-label="chapter label in verse"
        data-testid="chapter-label-in-verse-toggle"
        data-checked={String(chapterLabelInVerse)}
        onClick={() => onChapterLabelInVerseChange(!chapterLabelInVerse)}
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
   *
   * @param hasActiveBook - Whether a book is loaded; surfaced so tests can assert the loader passes
   *   it through.
   * @param onConfirm - Invoked with the chosen scope (`'book'` or `'all'`) when the user confirms.
   * @param onCancel - Invoked when the user backs out.
   * @returns A panel with a confirm button per scope plus cancel.
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
  setScrRef: (newScrRef: SerializedVerseRef) => void;
  analysisLanguage: string;
  initialAnalysis?: TextAnalysis;
  onSaveAnalysis?: (analysis: TextAnalysis) => void;
  onPendingEditsChange?: (pending: boolean) => void;
  phraseMode: PhraseMode;
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  viewOptions: ViewOptions;
};
let capturedInterlinearizerProps: CapturedInterlinearizerProps | undefined;
let interlinearizerMountCount = 0;

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
      return <div data-testid="interlinearizer" />;
    },
  };
});

/** Minimal project summary used across modal interaction tests. */
type MockProject = {
  id: string;
  createdAt: string;
  sourceProjectId: string;
  analysisLanguages: string[];
  name?: string;
  description?: string;
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

jest.mock('../../components/modals/ProjectModals', () => ({
  __esModule: true,
  /**
   * Minimal ProjectModals stand-in that drives modal state and active-project state through the
   * same `useWebViewState` hook the real component uses, so tests can assert on state transitions
   * without mounting the full modal tree. Accepts (and ignores) the draft-related props the loader
   * now passes (`dirty`, `getDraftSnapshot`, `loadFromProject`, `markSynced`).
   *
   * @param modal - Current modal identifier controlling which stub panel is rendered.
   * @param setModal - Callback to transition to a different modal state.
   * @param activeProject - The currently active interlinear project, or undefined when none is
   *   selected.
   * @param defaultAnalysisLanguage - BCP 47 tag forwarded as the create modal's default language.
   * @param useWebViewState - Injected hook used to read and write persisted WebView state; must
   *   support the `'activeProject'` key.
   * @returns A JSX element containing the stub modal panels keyed by `modal`.
   */
  default: function StubProjectModals({
    modal,
    setModal,
    activeProject,
    defaultAnalysisLanguage,
    useWebViewState,
  }: {
    modal: string;
    setModal: (m: string) => void;
    activeProject: MockProject | undefined;
    defaultAnalysisLanguage?: string;
    dirty: boolean;
    getDraftSnapshot: () => DraftProject | undefined;
    loadFromProject: (project: unknown) => void;
    markSynced: () => void;
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
        data-active-project-name={activeProject?.name}
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
            <button
              type="button"
              data-testid="select-modal-view-info"
              onClick={() => setModal('metadata')}
            >
              View info
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
 * Renders {@link InterlinearizerLoader} with the given props, supplying a fresh
 * `updateWebViewDefinition` spy (which tests can read back) and sensible defaults for the scroll
 * group and WebView-state hooks. Centralizing the render keeps every call site supplying the
 * required `updateWebViewDefinition` prop.
 *
 * @param options - Optional overrides.
 * @param options.useWebViewScrollGroupScrRef - Scroll-group hook; defaults to a GEN 1:1 stub.
 * @param options.useWebViewState - WebView-state hook; defaults to a fresh empty store.
 * @param options.projectId - Source project ID; defaults to {@link testProjectId}.
 * @returns The Testing Library render result plus the `updateWebViewDefinition` spy.
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

/**
 * Configures useInterlinearizerBookData to return the given state.
 *
 * @param overrides - Partial hook result; all fields default to a successful loaded state
 */
function mockBookData(
  overrides: Partial<{
    book: Book | undefined;
    isLoading: boolean;
    bookError: string | undefined;
    tokenizeError: { message: string; raw: unknown } | undefined;
  }> = {},
): void {
  jest.mocked(useInterlinearizerBookData).mockReturnValue({
    book: GEN_1_1_BOOK,
    isLoading: false,
    bookError: undefined,
    tokenizeError: undefined,
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
 * @returns A map from setting key to that key's `onChange` mock.
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
 * Configures `useSetting` to return per-key values for the two settings consumed by
 * `InterlinearizerLoader`: `platform.interfaceMode` and `platform.interfaceLanguage`.
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
    interlinearizerMountCount = 0;
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
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
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
      segments: [
        {
          id: 'PSA 3:0',
          startRef: { book: 'PSA', chapter: 3, verse: 0 },
          endRef: { book: 'PSA', chapter: 3, verse: 0 },
          baselineText: 'A Psalm by David.',
          tokens: [],
        },
      ],
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

    expect(screen.getByText('Loading…')).toBeInTheDocument();
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

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error heading and message when bookError is set', async () => {
    mockBookData({ book: undefined, bookError: 'Project not found' });
    await act(async () => {
      renderLoader();
    });

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
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

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
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

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
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
    expect(screen.getByText('Loading…')).toBeInTheDocument();
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
    expect(capturedInterlinearizerProps?.viewOptions.chapterLabelInVerse).toBe(false);
    expect(capturedInterlinearizerProps?.viewOptions.showMorphology).toBe(false);
    expect(capturedInterlinearizerProps?.viewOptions.showFreeTranslation).toBe(false);
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

  it('wires ViewOptionsDropdown chapter-label-in-verse to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await act(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('chapter-label-in-verse-toggle'));
    expect(onChangeByKey.get('interlinearizer.chapterLabelInVerse')).toHaveBeenCalledWith(true);
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
    // The draft owns the analysis language now; a draft configured for French must win even when
    // the active project's summary lists a different language.
    mockSendCommand.mockResolvedValueOnce(
      JSON.stringify({ ...emptyDraft(testProjectId), analysisLanguages: ['fr'] }),
    );
    await act(async () =>
      renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
    );

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('fr');
  });

  it('falls back to the first interfaceLanguage tag when the draft has no analysis language', async () => {
    // A brand-new source seeds the draft's analysis language from the platform UI language.
    mockSettings('simple', ['fr', 'en']);
    await act(async () => {
      renderLoader();
    });

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('fr');
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

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('und');
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

      // First create a project to set activeProject
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
      draftAnalysis.tokenAnalyses.push({ id: 't1', surfaceText: 'In', gloss: { en: 'in' } });
      mockSendCommand.mockResolvedValueOnce(
        JSON.stringify({ ...emptyDraft(testProjectId), analysis: draftAnalysis }),
      );
      await act(async () => {
        renderLoader();
      });

      expect(mockSendCommand).toHaveBeenCalledWith('interlinearizer.getDraft', testProjectId);
      expect(capturedInterlinearizerProps?.initialAnalysis).toEqual(draftAnalysis);
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
      expect(capturedInterlinearizerProps?.initialAnalysis).toEqual(emptyAnalysis());
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
      edited.tokenAnalyses.push({ id: 't1', surfaceText: 'In', gloss: { en: 'in' } });

      // Switch to fake timers only for this test so we can advance past the 300ms debounce.
      jest.useFakeTimers();
      act(() => {
        capturedInterlinearizerProps?.onSaveAnalysis?.(edited);
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

  describe('save command', () => {
    it('saves the draft analysis to the active project when Save is clicked with an active project', async () => {
      const draftAnalysis = emptyAnalysis();
      draftAnalysis.tokenAnalyses.push({ id: 't1', surfaceText: 'In', gloss: { en: 'in' } });
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
      );
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
        capturedInterlinearizerProps?.onSaveAnalysis?.(emptyAnalysis());
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
        capturedInterlinearizerProps?.onPendingEditsChange?.(true);
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer ●' });

      // The edit is reverted or the input unmounts with nothing committed: the marker clears.
      updateWebViewDefinition?.mockClear();
      act(() => {
        capturedInterlinearizerProps?.onPendingEditsChange?.(false);
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer' });
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
        capturedInterlinearizerProps?.onSaveAnalysis?.(emptyAnalysis());
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
     *
     * @returns The wrapper's inline `opacity` style value.
     */
    function fadeOpacity(): string {
      return screen.getByTestId('book-fade-wrapper').style.opacity;
    }

    /**
     * Builds a scroll-group hook whose reference can be restaged between rerenders. A fresh object
     * identity is required each change so the provider's `liveScrRef` memo recomputes.
     *
     * @param initial - The reference reported on the first render.
     * @returns A `[hook, setRef]` pair.
     */
    function makeMutableScrollGroupHook(
      initial: SerializedVerseRef,
    ): [
      () => [SerializedVerseRef, () => void, undefined, () => void],
      (n: SerializedVerseRef) => void,
    ] {
      let current = initial;
      const hook = (): [SerializedVerseRef, () => void, undefined, () => void] => [
        current,
        () => {},
        undefined,
        () => {},
      ];
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
     *
     * @param initial - The scroll-group reference reported on the first render.
     * @returns `setRef` to stage the next reference and `rerenderNow` to re-render with it.
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

      // Cross-book jump to MAT while the loaded book is still GEN (the window before the USJ arrives /
      // Interlinearizer remounts). Rather than leave the previous book's views mounted — where they
      // would show through the fade as the swap happens — the loader shows the Loading curtain, so
      // nothing of either book is visible until the new one mounts and fades in.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      controls?.rerenderNow();
      expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument();
      expect(screen.getByText('Loading…')).toBeInTheDocument();

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
      // it never updates in place against carried-over (wrong-book) scroll/focus state — the shuffle
      // that surfaced before the curtain settled.
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
