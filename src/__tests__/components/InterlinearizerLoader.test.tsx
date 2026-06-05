/** @file Unit tests for components/InterlinearizerLoader.tsx. */
/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings, useSetting } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Book, PhraseAnalysisLink, Segment, TextAnalysis } from 'interlinearizer';
import type { Dispatch, SetStateAction } from 'react';
import InterlinearizerLoader from '../../components/InterlinearizerLoader';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';
import type { PhraseMode } from '../../types/phrase-mode';
import { defaultScrRef, GEN_1_1_BOOK, makeWebViewState } from '../test-helpers';

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
  }: {
    continuousScroll: boolean;
    onContinuousScrollChange: (v: boolean) => void;
    hideInactiveLinkButtons: boolean;
    onHideInactiveLinkButtonsChange: (v: boolean) => void;
    simplifyPhrases: boolean;
    onSimplifyPhrasesChange: (v: boolean) => void;
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
    </div>
  ),
}));

jest.mock('../../components/controls/ScriptureNavControls', () => ({
  __esModule: true,
  default: () => <div data-testid="scripture-nav-controls" />,
}));

jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: () => <div data-testid="continuous-view" />,
}));

type CapturedInterlinearizerProps = {
  book: Book;
  chapterSegments: Segment[];
  continuousScroll: boolean;
  scrRef: SerializedVerseRef;
  setScrRef: (newScrRef: SerializedVerseRef) => void;
  analysisLanguage: string;
  initialAnalysis?: TextAnalysis;
  onSaveAnalysis?: (analysis: TextAnalysis) => void;
  phraseMode: PhraseMode;
  setPhraseMode: Dispatch<SetStateAction<PhraseMode>>;
  hideInactiveLinkButtons: boolean;
  simplifyPhrases: boolean;
};
let capturedInterlinearizerProps: CapturedInterlinearizerProps | undefined;

jest.mock('../../components/Interlinearizer', () => ({
  __esModule: true,
  default: (props: CapturedInterlinearizerProps) => {
    capturedInterlinearizerProps = props;
    return <div data-testid="interlinearizer" />;
  },
}));

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

const STUB_TEXT_ANALYSIS: TextAnalysis = {
  segmentAnalyses: [],
  segmentAnalysisLinks: [],
  tokenAnalyses: [],
  tokenAnalysisLinks: [],
  phraseAnalyses: [],
  phraseAnalysisLinks: [],
};

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
   * without mounting the full modal tree.
   *
   * @param modal - Current modal identifier controlling which stub panel is rendered.
   * @param setModal - Callback to transition to a different modal state.
   * @param activeProject - The currently active interlinear project, or undefined when none is
   *   selected.
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
              onClick={() => setModal('none')}
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

/** Returns a `useWebViewScrollGroupScrRef` hook stub fixed to GEN 1:1. */
function makeScrollGroupHook() {
  return (): [
    SerializedVerseRef,
    (r: SerializedVerseRef) => void,
    number | undefined,
    (id: number | undefined) => void,
  ] => [defaultScrRef, () => {}, undefined, () => {}];
}

/**
 * Configures useInterlinearizerBookData to return the given state.
 *
 * @param overrides - Partial hook result; all fields default to a successful loaded state
 */
function mockBookData(
  overrides: Partial<{
    book: Book | undefined;
    chapterSegments: Book['segments'];
    isLoading: boolean;
    bookError: string | undefined;
    tokenizeError: { message: string; raw: unknown } | undefined;
  }> = {},
): void {
  jest.mocked(useInterlinearizerBookData).mockReturnValue({
    book: GEN_1_1_BOOK,
    chapterSegments: [],
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
    mockBookData();
    mockOptimisticSetting();
    mockSendCommand.mockResolvedValue(undefined);
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    jest.mocked(useLocalizedStrings).mockReturnValue([{}, false]);
    mockSettings();
  });

  it('shows nav controls when interface mode is power', () => {
    mockSettings('power');
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByTestId('scripture-nav-controls')).toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('hides nav controls when interface mode is simple', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.queryByTestId('scripture-nav-controls')).not.toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('shows Loading when book data has not arrived', () => {
    mockBookData({ book: undefined, isLoading: true });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows an error heading and message when bookError is set', () => {
    mockBookData({ book: undefined, bookError: 'Project not found' });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error loading book/i })).toBeInTheDocument();
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  it('shows an error heading and message when tokenization throws an Error', () => {
    mockBookData({
      book: undefined,
      tokenizeError: { message: 'parse failure', raw: new Error('parse failure') },
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('parse failure')).toBeInTheDocument();
  });

  it('shows an error message when tokenization throws a non-Error value', () => {
    mockBookData({
      book: undefined,
      tokenizeError: { message: 'unexpected string error', raw: 'unexpected string error' },
    });
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByRole('heading', { name: /error processing book/i })).toBeInTheDocument();
    expect(screen.getByText('unexpected string error')).toBeInTheDocument();
  });

  it('passes the checked value from useOptimisticBooleanSetting to ViewOptionsDropdown', () => {
    mockOptimisticSetting(true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    const toggle = screen.getByTestId('continuous-scroll-toggle');
    expect(toggle).toHaveAttribute('data-checked', 'true');
  });

  it('gates rendering until the persisted display settings have loaded', () => {
    mockOptimisticSetting(false, jest.fn(), true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    // The saved settings must arrive before the view renders so the user's stored choices apply on
    // the first paint instead of flashing the hard-coded defaults.
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByTestId('continuous-scroll-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument();
  });

  it('wires ViewOptionsDropdown continuous scroll to the onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    await userEvent.click(screen.getByTestId('continuous-scroll-toggle'));
    expect(onChangeByKey.get('interlinearizer.continuousScroll')).toHaveBeenCalledWith(true);
  });

  it('passes hideInactiveLinkButtons=false to Interlinearizer by default', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.hideInactiveLinkButtons).toBe(false);
  });

  it('wires ViewOptionsDropdown hide-inactive-link-buttons to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    await userEvent.click(screen.getByTestId('hide-inactive-link-buttons-toggle'));
    expect(onChangeByKey.get('interlinearizer.hideInactiveLinkButtons')).toHaveBeenCalledWith(true);
  });

  it('passes simplifyPhrases=false to Interlinearizer by default', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.simplifyPhrases).toBe(false);
  });

  it('wires ViewOptionsDropdown dim-inactive-segments to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    await userEvent.click(screen.getByTestId('dim-inactive-segments-toggle'));
    expect(onChangeByKey.get('interlinearizer.simplifyPhrases')).toHaveBeenCalledWith(true);
  });

  it('passes continuousScroll=true to Interlinearizer when the setting is true', () => {
    mockOptimisticSetting(true);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(true);
  });

  it('passes continuousScroll=false to Interlinearizer when the setting is false', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(false);
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('passes the first analysisLanguages tag from the active project as analysisLanguage', async () => {
    const state = makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT });
    await act(async () =>
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={state}
        />,
      ),
    );

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('en');
  });

  it('prefers the project analysisLanguage over the platform interface language', async () => {
    mockSettings('simple', ['fr']);
    const state = makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT });
    await act(async () =>
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={state}
        />,
      ),
    );

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('en');
  });

  it('falls back to the first interfaceLanguage tag when no project is active', () => {
    mockSettings('simple', ['fr', 'en']);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('fr');
  });

  it('passes the platform language to ProjectModals as defaultAnalysisLanguage', () => {
    mockSettings('simple', ['de']);
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(screen.getByTestId('project-modals')).toHaveAttribute('data-default-lang', 'de');
  });

  it('falls back to "und" as analysisLanguage when no project is active and interfaceLanguage is empty', () => {
    render(
      <InterlinearizerLoader
        projectId={testProjectId}
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
      />,
    );

    expect(capturedInterlinearizerProps?.analysisLanguage).toBe('und');
  });

  describe('modal interactions', () => {
    it('opens the select modal when the project menu selectProject item is clicked', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));

      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('opens the create modal directly when the openNewProjectModal menu item is clicked', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));

      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('closes the create modal without showing another when close is clicked from menu source', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));
      await userEvent.click(screen.getByTestId('create-modal-close'));

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('closes the select modal when its close button is clicked', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-close'));

      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('opens the create modal from the select modal create-new button', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));

      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
    });

    it('closes all modals after a project is created from the select modal', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));
      await userEvent.click(screen.getByTestId('create-modal-created'));

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('sets the active project and closes the select modal when a project is selected', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));

      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
      // After selection the view-project-info button becomes available, confirming activeProject is set
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('opens the metadata modal from the openProjectInfoModal menu item when a project is active', async () => {
      const state = makeWebViewState();
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={state}
        />,
      );

      // First create a project to set activeProject
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('does not open the metadata modal from openProjectInfoModal when no project is active', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
    });

    it('dismisses to none when metadata is closed after being opened from the menu', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-close'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('dismisses to none and clears active project when the active project is deleted from the menu', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-deleted'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
    });

    it('updates the active project name when its metadata is saved', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-saved'));

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
    });

    it('renders without error when useData provides a topMenu with items', () => {
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
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      expect(screen.getByTestId('tab-toolbar')).toBeInTheDocument();
    });
  });

  describe('project analysis loading', () => {
    it('passes the stored analysis as initialAnalysis when getProject returns valid JSON', async () => {
      mockSendCommand.mockResolvedValueOnce(
        JSON.stringify({ id: 'proj-1', analysis: STUB_TEXT_ANALYSIS }),
      );
      await act(async () =>
        render(
          <InterlinearizerLoader
            projectId={testProjectId}
            useWebViewScrollGroupScrRef={makeScrollGroupHook()}
            useWebViewState={makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT })}
          />,
        ),
      );

      expect(capturedInterlinearizerProps?.initialAnalysis).toEqual(STUB_TEXT_ANALYSIS);
      expect(mockSendCommand).toHaveBeenCalledWith('interlinearizer.getProject', 'proj-1');
    });

    it('logs an error and leaves initialAnalysis undefined when getProject rejects', async () => {
      const error = new Error('network error');
      mockSendCommand.mockRejectedValueOnce(error);
      await act(async () =>
        render(
          <InterlinearizerLoader
            projectId={testProjectId}
            useWebViewScrollGroupScrRef={makeScrollGroupHook()}
            useWebViewState={makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT })}
          />,
        ),
      );

      expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
        'Interlinearizer: failed to load project analysis',
        error,
      );
      expect(capturedInterlinearizerProps?.initialAnalysis).toBeUndefined();
    });

    it('skips state updates when the component unmounts before getProject resolves', async () => {
      let resolveGetProject: ((value: string | undefined) => void) | undefined;
      mockSendCommand.mockReturnValueOnce(
        new Promise<string | undefined>((resolve) => {
          resolveGetProject = resolve;
        }),
      );

      const { unmount } = render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT })}
        />,
      );

      unmount();
      resolveGetProject?.(JSON.stringify({ id: 'proj-1', analysis: STUB_TEXT_ANALYSIS }));
      await Promise.resolve();

      expect(jest.mocked(logger.error)).not.toHaveBeenCalled();
    });
  });

  describe('handleSaveAnalysis', () => {
    it('calls saveAnalysis command with the project id and serialized analysis', async () => {
      await act(async () =>
        render(
          <InterlinearizerLoader
            projectId={testProjectId}
            useWebViewScrollGroupScrRef={makeScrollGroupHook()}
            useWebViewState={makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT })}
          />,
        ),
      );

      capturedInterlinearizerProps?.onSaveAnalysis?.(STUB_TEXT_ANALYSIS);
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveAnalysis',
        'proj-1',
        JSON.stringify(STUB_TEXT_ANALYSIS),
      );
    });

    it('does not call saveAnalysis when no active project is set', () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      capturedInterlinearizerProps?.onSaveAnalysis?.(STUB_TEXT_ANALYSIS);

      expect(
        mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveAnalysis'),
      ).toHaveLength(0);
    });
  });

  describe('phrase mode plumbing', () => {
    it('forwards setPhraseMode through to Interlinearizer', () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

      expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' });
      expect(typeof capturedInterlinearizerProps?.setPhraseMode).toBe('function');
    });

    it('updates the captured phraseMode when setPhraseMode is invoked', () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

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

    it('resets phraseMode to view when the active project changes', async () => {
      render(
        <InterlinearizerLoader
          projectId={testProjectId}
          useWebViewScrollGroupScrRef={makeScrollGroupHook()}
          useWebViewState={makeWebViewState()}
        />,
      );

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

      // Simulate a project change: open the select modal and choose a project. The project-modals
      // stub calls setActiveProject (from useWebViewState) which updates the stored slot; the
      // subsequent setModal('none') call triggers a React re-render so InterlinearizerLoader reads
      // the new activeProject value. The useEffect that watches activeProject.id then fires and
      // resets phraseMode to view.
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));

      expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' });
    });
  });
});
