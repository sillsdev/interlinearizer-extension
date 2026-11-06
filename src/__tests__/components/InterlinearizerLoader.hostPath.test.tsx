/// <reference types="jest" />

import papi from '@papi/frontend';
import { useData, useProjectSetting, useSetting } from '@papi/frontend/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useGloss, useGlossDispatch } from '../../components/AnalysisStore';
import InterlinearizerLoader from '../../components/InterlinearizerLoader';
import { emptyPt9ImportReport } from '../../converters/pt9/report';
import type { SegmentationDispatch } from '../../components/SegmentationStore';
import useConcordanceEntries from '../../hooks/useConcordanceEntries';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import useLexiconRegistry from '../../hooks/useLexiconRegistry';
import useLostBoundaryDismissal from '../../hooks/useLostBoundaryDismissal';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';
import useProjectBookIds from '../../hooks/useProjectBookIds';
import useSegmentPages from '../../hooks/useSegmentPages';
import useSourceTextReader from '../../hooks/useSourceTextReader';
import useStaleAnalysisDismissal from '../../hooks/useStaleAnalysisDismissal';
import { fakeHost, STORED_PROJECT } from '../cache/fake-host';
import { BOOK, ref } from '../cache/session-source';
import { makeScrollGroupHook, makeWebViewState } from '../test-helpers';
import { makeSourceText, mockKeyAsValueLocalizedStrings } from './test-helpers';

jest.mock('../../utils/host-path', () => ({ hostPathEnabled: () => true }));
jest.mock('../../hooks/useConcordanceEntries');
jest.mock('../../hooks/useSourceTextReader');
jest.mock('../../hooks/useInterlinearizerBookData');
jest.mock('../../hooks/useLexiconRegistry');
jest.mock('../../hooks/useLostBoundaryDismissal');
jest.mock('../../hooks/useOptimisticBooleanSetting');
jest.mock('../../hooks/useProjectBookIds');
jest.mock('../../hooks/useSegmentPages');
jest.mock('../../hooks/useStaleAnalysisDismissal');
jest.mock('../../components/StaleAnalysesReporter', () => ({
  __esModule: true,
  default: () => undefined,
}));
let capturedStaleCoversDraft: boolean | undefined;

jest.mock('../../components/AnalysisCatalogPanel', () => ({
  __esModule: true,
  ANALYSIS_CATALOG_PANEL_STRING_KEYS: [],
  default: ({ staleCoversDraft }: { staleCoversDraft: boolean }) => {
    capturedStaleCoversDraft = staleCoversDraft;
    return <div data-testid="analysis-catalog-panel" />;
  },
}));
jest.mock('../../components/ContinuousView', () => ({
  __esModule: true,
  default: () => <div data-testid="continuous-view" />,
}));

let capturedBoundaries: SegmentationDispatch | undefined;

jest.mock('../../components/modals/ProjectModals', () => ({
  __esModule: true,
  /** Offers Open, New and a Paratext 9 import as buttons, in place of the project dialogs. */
  default: ({
    loadFromProject,
    newDraft,
    onImportPt9,
  }: {
    loadFromProject: (projectId: string) => Promise<void>;
    newDraft: (config: { analysisLanguages: string[] }) => Promise<void>;
    onImportPt9: () => void;
  }) => (
    <div>
      <button type="button" data-testid="open-project" onClick={() => loadFromProject('proj-de')}>
        Open
      </button>
      <button
        type="button"
        data-testid="new-draft"
        onClick={() => newDraft({ analysisLanguages: ['fr'] })}
      >
        New
      </button>
      <button type="button" data-testid="import-pt9" onClick={onImportPt9}>
        Import
      </button>
    </div>
  ),
}));

jest.mock('../../components/modals/DiscardChangesModal', () => ({
  __esModule: true,
  /** Confirms a whole-draft discard from one button, in place of the scope picker. */
  DiscardChangesModal: ({ onConfirm }: { onConfirm: (scope: 'book' | 'all') => void }) => (
    <button type="button" data-testid="discard-all" onClick={() => onConfirm('all')}>
      Discard draft
    </button>
  ),
}));

/** Shows the gloss of "earth", and writes one when clicked, as a token chip would. */
function EarthProbe() {
  const gloss = useGloss(ref('earth'));
  const write = useGlossDispatch();
  return (
    <button data-testid="earth" type="button" onClick={() => write(ref('earth'), 'earth', 'land')}>
      {gloss}
    </button>
  );
}

jest.mock('../../components/Interlinearizer', () => ({
  __esModule: true,
  default: ({ segmentationDispatch }: { segmentationDispatch: SegmentationDispatch }) => {
    capturedBoundaries = segmentationDispatch;
    return (
      <div data-testid="interlinearizer">
        <EarthProbe />
      </div>
    );
  },
}));

/** Serves the loader's other hooks as a project with {@link BOOK} open would. */
function mockLoaderHooks(): void {
  jest.mocked(useInterlinearizerBookData).mockReturnValue({
    book: BOOK,
    isLoading: false,
    bookError: undefined,
    writingSystem: 'und',
    reload: jest.fn(),
  });
  jest.mocked(useSegmentPages).mockReturnValue({
    pages: undefined,
    isLoading: false,
    error: undefined,
  });
  jest.mocked(useProjectBookIds).mockReturnValue({ bookIds: ['GEN'], isLoading: false });
  jest
    .mocked(useOptimisticBooleanSetting)
    .mockReturnValue({ value: false, onChange: jest.fn(), isLoading: false });
  jest.mocked(useLostBoundaryDismissal).mockReturnValue({
    undismissedLostBoundaries: [],
    onDismiss: jest.fn(),
  });
  jest.mocked(useStaleAnalysisDismissal).mockReturnValue({
    glossCount: 0,
    freeTranslationCount: 0,
    freeTranslationSegmentIds: [],
    onDismiss: jest.fn(),
  });
  jest.mocked(useLexiconRegistry).mockReturnValue({
    isForeign: () => true,
    resolverWith: () => undefined,
    resolveSense: async () => undefined,
    openChooser: undefined,
  });
  jest.mocked(useSourceTextReader).mockReturnValue(makeSourceText());
  jest.mocked(useConcordanceEntries).mockReturnValue([]);
  jest
    .mocked(useData)
    .mockReturnValue(
      new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
    );
  jest.mocked(useSetting).mockImplementation((key: string) => {
    if (key === 'platform.interfaceMode') return ['simple', jest.fn(), jest.fn(), false];
    return [[], jest.fn(), jest.fn(), false];
  });
  jest
    .mocked(useProjectSetting)
    .mockImplementation((_source, _key, defaultState) => [
      defaultState,
      jest.fn(),
      jest.fn(),
      false,
    ]);
  mockKeyAsValueLocalizedStrings();
}

/** The project the draft saves to, as the WebView's stored state holds it. */
const ACTIVE_PROJECT = {
  id: 'proj-1',
  sourceProjectId: 'src',
  analysisLanguages: ['en'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Renders the loader on the source `src` and waits for its session's view to show.
 *
 * @param state - What the WebView's stored state starts with.
 * @param others - Answers the commands that the fake host does not serve.
 */
async function renderLoaded(
  state: Record<string, unknown> = {},
  others: Parameters<typeof fakeHost>[0] = async () => undefined,
) {
  const host = await fakeHost(others);
  jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
  render(
    <InterlinearizerLoader
      projectId="src"
      webViewId="web-view-1"
      useWebViewScrollGroupScrRef={makeScrollGroupHook()}
      useWebViewState={makeWebViewState(state)}
      updateWebViewDefinition={jest.fn(() => true)}
    />,
  );
  await screen.findByTestId('earth');
  return host;
}

beforeEach(() => {
  capturedBoundaries = undefined;
  mockLoaderHooks();
});

describe('InterlinearizerLoader on the host path', () => {
  it("shows the session's analysis of the loaded book", async () => {
    await renderLoaded();

    expect(screen.getByTestId('earth')).toHaveTextContent('');
    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.openSession', {
      sourceProjectId: 'src',
    });
    expect(useSegmentPages).not.toHaveBeenCalledWith(expect.objectContaining({ verseBook: BOOK }));
  });

  it('writes a gloss through the session and shows it from the reply', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('earth'));

    await waitFor(() => expect(screen.getByTestId('earth')).toHaveTextContent('land'));
  });

  it('undoes an edit through the session from the undo key', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId('earth'));
    await waitFor(() => expect(screen.getByTestId('earth')).toHaveTextContent('land'));

    act(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });

    await waitFor(() => expect(screen.getByTestId('earth')).toHaveTextContent(''));
    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.undoEdit', {
      sessionId: expect.any(String),
      changeId: expect.any(String),
    });
  });

  it('hands the view boundary edits that the session makes', async () => {
    await renderLoaded();

    await act(async () => capturedBoundaries?.merge(ref('And')));

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.mergeSegments',
        expect.objectContaining({ secondSegmentStartRef: ref('And') }),
      ),
    );
  });

  it("tells the session the view's analysis language", async () => {
    await renderLoaded();

    expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.setAnalysisLanguage', {
      sessionId: expect.any(String),
      analysisLanguage: 'en',
    });
  });
});

describe('InterlinearizerLoader saving on the host path', () => {
  it('saves the draft to the active project through its session', async () => {
    await renderLoaded({ activeProject: ACTIVE_PROJECT });

    fireEvent.click(screen.getByTestId('tab-toolbar-save'));

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraftToProject',
        'src',
        'proj-1',
        undefined,
        expect.any(String),
      ),
    );
  });
});

describe('InterlinearizerLoader starting over on the host path', () => {
  it('opens a project by sending the host its id, reading no project', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('open-project'));

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.startDraftOver', {
        sourceProjectId: 'src',
        from: { interlinearProjectId: STORED_PROJECT.id },
      }),
    );
    await screen.findByTestId('earth');
    expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
      'interlinearizer.getProject',
      expect.anything(),
    );
  });

  it('starts a new draft by sending the host its configuration', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByTestId('new-draft'));

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.startDraftOver', {
        sourceProjectId: 'src',
        from: { analysisLanguages: ['fr'] },
      }),
    );
  });
});

describe('InterlinearizerLoader discarding on the host path', () => {
  it("discards the draft through its session, leaving the saved project's content to the host", async () => {
    await renderLoaded({ activeProject: ACTIVE_PROJECT });

    fireEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
    fireEvent.click(screen.getByTestId('discard-all'));

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith('interlinearizer.discardAll', {
        sessionId: expect.any(String),
        changeId: expect.any(String),
      }),
    );
    expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
      'interlinearizer.getProject',
      expect.anything(),
    );
  });
});

describe('InterlinearizerLoader opening a Paratext 9 import on the host path', () => {
  const IMPORT_SUMMARY = {
    ...ACTIVE_PROJECT,
    id: 'import-1',
    pt9Import: { fileHashes: {}, importedAt: '2026-01-01T00:00:00.000Z' },
  };

  it("opens the report's import from its summary, reading no project", async () => {
    await renderLoaded({}, async (command) => {
      if (command === 'interlinearizer.importPt9Project')
        return JSON.stringify({
          outcome: 'imported',
          projectId: IMPORT_SUMMARY.id,
          report: emptyPt9ImportReport(),
        });
      if (command === 'interlinearizer.getProjectSummary') return JSON.stringify(IMPORT_SUMMARY);
      return undefined;
    });

    fireEvent.click(screen.getByTestId('import-pt9'));
    fireEvent.click(
      await screen.findByRole('button', { name: '%interlinearizer_pt9ImportModal_open%' }),
    );

    await screen.findByTestId('pt9-import-banner');
    expect(papi.commands.sendCommand).toHaveBeenCalledWith(
      'interlinearizer.getProjectSummary',
      IMPORT_SUMMARY.id,
    );
    expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
      'interlinearizer.getProject',
      expect.anything(),
    );
  });
});

describe('InterlinearizerLoader stale filter on the host path', () => {
  /** The latest wanted-text listener that the loader handed the source-text reader. */
  const latestOnWanted = () => jest.mocked(useSourceTextReader).mock.lastCall?.[0].onWanted;

  it("asks nothing of the session's whole-text read until the text is wanted", async () => {
    await fakeHost();
    render(
      <InterlinearizerLoader
        projectId="src"
        webViewId="web-view-1"
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState({ sidePanel: 'catalog' })}
        updateWebViewDefinition={jest.fn(() => true)}
      />,
    );

    await waitFor(() => expect(latestOnWanted()).toBeDefined());
    expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
      'interlinearizer.getTextReadStatus',
      expect.anything(),
    );
  });

  it("covers the whole draft once the session's whole-text read has read every book", async () => {
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
    await fakeHost(async (command) =>
      command === 'interlinearizer.getTextReadStatus'
        ? JSON.stringify({ booksRead: 1, bookCount: 1, failedBookIds: [] })
        : undefined,
    );
    render(
      <InterlinearizerLoader
        projectId="src"
        webViewId="web-view-1"
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState({ sidePanel: 'catalog' })}
        updateWebViewDefinition={jest.fn(() => true)}
      />,
    );

    await waitFor(() => expect(latestOnWanted()).toBeDefined());
    act(() => latestOnWanted()?.());

    await waitFor(() => expect(capturedStaleCoversDraft).toBe(true));
  });
});

describe('InterlinearizerLoader on the host path with no book', () => {
  it("asks the session for no outline of a book whose text didn't load", async () => {
    await fakeHost();
    jest.mocked(useInterlinearizerBookData).mockReturnValue({
      book: undefined,
      isLoading: false,
      bookError: 'no such book',
      writingSystem: 'und',
      reload: jest.fn(),
    });
    render(
      <InterlinearizerLoader
        projectId="src"
        webViewId="web-view-1"
        useWebViewScrollGroupScrRef={makeScrollGroupHook()}
        useWebViewState={makeWebViewState()}
        updateWebViewDefinition={jest.fn(() => true)}
      />,
    );

    await waitFor(() =>
      expect(papi.commands.sendCommand).toHaveBeenCalledWith(
        'interlinearizer.getFullAnalysis',
        expect.anything(),
      ),
    );
    expect(papi.commands.sendCommand).not.toHaveBeenCalledWith(
      'interlinearizer.getBookOutline',
      expect.anything(),
      expect.anything(),
    );
  });
});
