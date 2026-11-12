/// <reference types="jest" />
/// <reference types="@testing-library/jest-dom" />

import papi, { logger } from '@papi/frontend';
import { useData, useLocalizedStrings, useProjectSetting, useSetting } from '@papi/frontend/react';
import type { SerializedVerseRef } from '@sillsdev/scripture';
import { useEvent } from 'platform-bible-react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  Book,
  DraftProject,
  PhraseAnalysisLink,
  TextAnalysis,
  TokenSnapshot,
} from 'interlinearizer';
import {
  useEffect as useReactEffect,
  useMemo as useReactMemo,
  useState as useReactState,
} from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useAnalysis, useGlossDispatch, usePhraseDispatch } from '../../components/AnalysisStore';
import { useInterlinearNav, type RecenterRequest } from '../../components/InterlinearNavContext';
import InterlinearizerLoader, {
  BOOK_NAME_TIMEOUT_MS,
  UNDO_NOTIFICATION_DURATION_MS,
} from '../../components/InterlinearizerLoader';
import { RECENTER_FADE_MS } from '../../components/recenter-fade';
import useConcordanceEntries from '../../hooks/useConcordanceEntries';
import useSourceTextReader from '../../hooks/useSourceTextReader';
import useInterlinearizerBookData from '../../hooks/useInterlinearizerBookData';
import type { SegmentPages } from '../../types/segment-pages';
import { DraftRepository } from '../../services/draftRepository';
import { ANALYSIS_CHANGED_EVENT, fakeHost } from '../cache/fake-host';
import useLexiconRegistry from '../../hooks/useLexiconRegistry';
import useLostBoundaryDismissal from '../../hooks/useLostBoundaryDismissal';
import useOptimisticBooleanSetting from '../../hooks/useOptimisticBooleanSetting';
import useProjectBookIds from '../../hooks/useProjectBookIds';
import useStaleAnalysisDismissal from '../../hooks/useStaleAnalysisDismissal';
import type { StaleAnalysesReport } from '../../components/StaleAnalysesReporter';
import type { DraftCopyResult } from '../../types/project-api';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { PT9_MANIFEST_TIMEOUT_MS } from '../../utils/pt9-manifest';
import type { PhraseMode } from '../../types/phrase-mode';
import type { ViewOptions } from '../../types/view-options';
import type { SegmentationDispatch } from '../../components/SegmentationStore';
import {
  EMPTY_GEN_BOOK,
  FIXTURE_STAMPS,
  GEN_1_1_BOOK,
  getMockedPdpGet,
  makePunctToken,
  makeScrollGroupHook,
  makeSegment,
  makeVerseBook,
  makeWebViewState,
  makeWordToken,
  type ScrollGroupTuple,
  silentLogger,
} from '../test-helpers';
import { makeSourceText, mockKeyAsValueLocalizedStrings } from './test-helpers';

jest.mock('../../hooks/useConcordanceEntries');
jest.mock('../../hooks/useSourceTextReader');
jest.mock('../../hooks/useInterlinearizerBookData');
jest.mock('../../hooks/useLexiconRegistry');
jest.mock('../../hooks/useLostBoundaryDismissal');
jest.mock('../../hooks/useOptimisticBooleanSetting');
jest.mock('../../hooks/useProjectBookIds');
jest.mock('../../hooks/useStaleAnalysisDismissal');

/** What the loader last handed the stale-analyses reporter, `undefined` until it mounts one. */
let capturedReporterProps:
  { book: Book; onReport: (report: StaleAnalysesReport | undefined) => void } | undefined;

// Stubbed to record where the loader mounts it, which is all these tests ask of it.
jest.mock('../../components/StaleAnalysesReporter', () => ({
  __esModule: true,
  default: (props: NonNullable<typeof capturedReporterProps>) => {
    capturedReporterProps = props;
    return undefined;
  },
}));

jest.mock('../../components/BookNotInProjectView', () => ({
  __esModule: true,
  default: ({
    projectId,
    webViewId,
    isPowerMode,
  }: {
    projectId: string;
    webViewId: string;
    isPowerMode: boolean;
  }) => (
    <div
      data-testid="book-not-in-project"
      data-project-id={projectId}
      data-web-view-id={webViewId}
      data-power-mode={String(isPowerMode)}
    />
  ),
}));

jest.mock('../../components/controls/ViewOptionsDropdown', () => ({
  __esModule: true,
  default: ({
    continuousScroll,
    onContinuousScrollChange,
    showMorphology,
    onShowMorphologyChange,
    showFreeTranslation,
    onShowFreeTranslationChange,
  }: {
    continuousScroll: boolean;
    onContinuousScrollChange: (v: boolean) => void;
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

jest.mock('../../components/controls/AnalysisLanguageSelect', () => ({
  __esModule: true,
  default: ({
    languages,
    onValueChange,
  }: {
    languages: readonly string[];
    onValueChange: (tag: string) => void;
  }) => (
    <div data-testid="analysis-language-select">
      {languages.map((tag) => (
        <button
          data-testid={`analysis-language-${tag}`}
          key={tag}
          onClick={() => onValueChange(tag)}
          type="button"
        >
          {tag}
        </button>
      ))}
    </div>
  ),
}));

jest.mock('../../components/controls/ScriptureNavControls', () => ({
  __esModule: true,
  default: ({ activeBookIds }: { activeBookIds?: string[] }) => (
    <div data-testid="scripture-nav-controls" data-active-book-ids={activeBookIds?.join(',')} />
  ),
}));

jest.mock('../../components/modals/DiscardChangesModal', () => ({
  __esModule: true,
  /**
   * Minimal DiscardChangesModal stand-in exposing per-scope confirm buttons and cancel so tests can
   * drive the loader's discard handlers without the real dialog's localization or scope-picker UI.
   */
  DiscardChangesModal: ({
    hasActiveBook,
    isSubmitting,
    onConfirm,
    onCancel,
  }: {
    hasActiveBook: boolean;
    isSubmitting: boolean;
    onConfirm: (scope: 'book' | 'all') => void;
    onCancel: () => void;
  }) => (
    <div
      data-testid="discard-changes-modal-panel"
      data-has-active-book={String(hasActiveBook)}
      data-is-submitting={String(isSubmitting)}
    >
      <button
        type="button"
        data-testid="discard-changes-confirm-book"
        onClick={() => onConfirm('book')}
      >
        Discard book
      </button>
      <button
        type="button"
        data-testid="discard-changes-confirm-all"
        onClick={() => onConfirm('all')}
      >
        Discard draft
      </button>
      <button type="button" data-testid="discard-changes-modal-cancel" onClick={onCancel}>
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
  unmergeableStarts?: ReadonlySet<string>;
  pages: SegmentPages;
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
  /** Called with whether any gloss input holds uncommitted text. */
  onPendingEditsChange?: (pending: boolean) => void;
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
    SessionAnalysisProvider(props: CapturedStoreProps) {
      capturedStoreProps = props;
      return createElement(actual.SessionAnalysisProvider, props);
    },
  };
});

/**
 * Whether the view stub should mount {@link StoreProbe}. Off by default, because the probe's hooks
 * throw outside a {@link SessionAnalysisProvider}. Most tests here neither render one nor care about
 * the store.
 */
let mountStoreProbe = false;

/** The analysis the store the probe is mounted in holds. */
let probeAnalysis: TextAnalysis | undefined;

/** Creates a phrase through the store that the probe is mounted in. */
let probeCreatePhrase: ((tokens: TokenSnapshot[]) => void) | undefined;

/** The token a pending focus request names in GEN, read by the probe. */
let probeFocusRequest: string | undefined;

/** The latest recenter request, read by the probe. */
let probeRecenterRequest: RecenterRequest | undefined;

/** Publishes the word the reader focused, as the book view does. */
let probePublishFocus: ((tokenRef: string | undefined) => void) | undefined;

/** Writes a gloss through the store the probe is mounted in. */
let probeWriteGloss: ((tokenRef: string, surfaceText: string, value: string) => void) | undefined;

/**
 * Publishes the store it is mounted in, and a way to write into it, so a test can tell whether a
 * book change replaced the store or left it alone. Renders no markup.
 */
function StoreProbe() {
  probeAnalysis = useAnalysis();
  probeWriteGloss = useGlossDispatch();
  probeCreatePhrase = usePhraseDispatch().createPhrase;
  probeFocusRequest = useInterlinearNav().peekFocusRequest('GEN');
  probeRecenterRequest = useInterlinearNav().recenterRequest;
  probePublishFocus = useInterlinearNav().publishedFocus.publish;
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

/** An approved analysis of `surfaceText`, written against the token at `tokenRef`. */
function analysisApprovingAt(tokenRef: string, surfaceText: string): TextAnalysis {
  return {
    ...emptyAnalysis(),
    tokenAnalyses: [{ ...FIXTURE_STAMPS, id: 'ta-1', surfaceText }],
    tokenAnalysisLinks: [
      {
        id: 'tl-1',
        ...FIXTURE_STAMPS,
        analysisId: 'ta-1',
        status: 'approved',
        token: { tokenRef, surfaceText },
      },
    ],
  };
}

/** A one-verse book with a second word to split before. */
const ALPHA_BETA_BOOK: Book = {
  ...EMPTY_GEN_BOOK,
  segments: [
    makeSegment('GEN 1:1', 'Alpha beta.', [
      makeWordToken('GEN 1:1:0', 'Alpha'),
      makeWordToken('GEN 1:1:6', 'beta', 6),
    ]),
  ],
};

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

/** Answers each command that the fake host does not serve; `undefined` unless a test says else. */
const otherCommands = jest.fn<Promise<unknown>, unknown[]>();

/** The book the fake host pages, which follows the book a test serves the view. */
let hostBook: Book = GEN_1_1_BOOK;

/** The fake host that serves the view's session. */
let host: Awaited<ReturnType<typeof fakeHost>>;

beforeEach(async () => {
  hostBook = GEN_1_1_BOOK;
  otherCommands.mockResolvedValue(undefined);
  host = await fakeHost(
    async (command, args) => {
      const answer = await otherCommands(command, ...args);
      return typeof answer === 'string' ? answer : undefined;
    },
    undefined,
    { book: GEN_1_1_BOOK, textOf: () => hostBook },
  );
});

/**
 * Lets every command the view has sent the fake host finish, and the view render its reply.
 *
 * @param action - Run first in the same `act`, so that a reply landing before the flush starts is
 *   still inside it.
 */
async function flushHost(action?: () => unknown): Promise<void> {
  // Microtasks only, so that a test on fake timers flushes as surely as one on real timers.
  await act(async () => {
    await action?.();
    for (let turn = 0; turn < 200; turn += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve();
    }
  });
}

/** The commands of the edits the view has sent its session, in order. */
function editsSent(): unknown[] {
  return mockSendCommand.mock.calls
    .filter(([, args]) => typeof args === 'object' && !!args && 'changeId' in args)
    .map(([command]) => command);
}

/**
 * Answers a Save of the session's draft into a project as the host does: marks the stored draft
 * clean and resolves to `project` as JSON.
 */
async function answerSave(project: object, args: unknown[]): Promise<string> {
  const sessionId = args[1];
  if (typeof sessionId !== 'string') throw new Error('Expected a Save under a session');
  await host.sessions.run(sessionId, (session) => session.repository.markClean());
  return JSON.stringify(project);
}

/** Stores `draft` as its source's draft, as the session that the view opens finds it. */
async function seedDraft(draft: DraftProject): Promise<void> {
  await new DraftRepository(host.storage, draft.sourceProjectId, silentLogger()).startOver(draft);
}

const testProjectId = 'test-project-id';
const testWebViewId = 'test-web-view-id';

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

jest.mock('../../components/modals/ProjectModals', () => ({
  __esModule: true,
  /**
   * Minimal ProjectModals stand-in that drives modal state and active-project state through the
   * same `useWebViewState` hook the real component uses, so tests can assert on state transitions
   * without mounting the full modal tree. Accepts (and mostly ignores) the draft-related props the
   * loader passes; `hasUnsavedWork` is surfaced as a `data-*` attribute so that tests can assert
   * that the loader feeds it the combined committed-and-pending unsaved state.
   */
  default: function StubProjectModals({
    modal,
    setModal,
    activeProject,
    defaultAnalysisLanguage,
    hasUnsavedWork,
    onImportPt9,
    onOpenImport,
    openRequest,
    useWebViewState,
    sourceShortName,
  }: {
    modal: string;
    setModal: (m: string) => void;
    sourceShortName: string;
    activeProject: MockProject | undefined;
    defaultAnalysisLanguage?: string;
    hasUnsavedWork: boolean;
    getDraftSnapshot: () => DraftProject | undefined;
    commitDraft: (copy: (snapshot: DraftProject) => Promise<DraftCopyResult>) => Promise<boolean>;
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
        data-source-short-name={sourceShortName}
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
      webViewId={testWebViewId}
      useWebViewScrollGroupScrRef={options.useWebViewScrollGroupScrRef ?? makeScrollGroupHook()}
      useWebViewState={options.useWebViewState ?? makeWebViewState()}
      updateWebViewDefinition={updateWebViewDefinition}
    />,
  );
  return { ...result, updateWebViewDefinition };
}

/** Has the source text report itself unread, as it is until something asks for it. */
function mockUnreadSourceText(): void {
  jest.mocked(useSourceTextReader).mockReturnValue(makeSourceText());
  jest.mocked(useConcordanceEntries).mockReturnValue([]);
}

/** Configures useInterlinearizerBookData to return the given state. */
function mockBookData(
  overrides: Partial<{
    book: Book | undefined;
    isLoading: boolean;
    bookError: string | undefined;
    writingSystem: string;
    reload: () => void;
  }> = {},
): void {
  const data = {
    book: GEN_1_1_BOOK,
    isLoading: false,
    bookError: undefined,
    writingSystem: 'und',
    reload: jest.fn(),
    ...overrides,
  };
  if (data.book) hostBook = data.book;
  jest.mocked(useInterlinearizerBookData).mockReturnValue(data);
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
 * Returns the default the loader last passed to {@link useOptimisticBooleanSetting} for `key`, or
 * `undefined` when it never asked for that setting.
 */
function lastSettingDefault(key: string): boolean | undefined {
  return jest
    .mocked(useOptimisticBooleanSetting)
    .mock.calls.filter(([, calledKey]) => calledKey === key)
    .at(-1)?.[2];
}

/** An analysis holding one segment's free translation. */
function analysisWithFreeTranslation(): TextAnalysis {
  const analysis = emptyAnalysis();
  analysis.segmentAnalyses.push({
    ...FIXTURE_STAMPS,
    id: 'sa-1',
    surfaceText: 'In the beginning God created the heavens and the earth.',
    freeTranslation: { en: 'At first God made everything.' },
  });
  return analysis;
}

/**
 * Configures `useSetting` to return per-key values for `platform.interfaceMode` and
 * `platform.interfaceLanguage`.
 *
 * @param interfaceMode - Value for `platform.interfaceMode`; defaults to `'simple'`.
 * @param interfaceLanguage - Value for `platform.interfaceLanguage`; defaults to `[]`.
 * @param isInterfaceModeLoading - Whether `platform.interfaceMode` is still loading.
 * @throws {Error} When `useSetting` is called with any key other than `platform.interfaceMode` or
 *   `platform.interfaceLanguage` (message: `useSetting mock: unexpected key "<key>"`).
 */
function mockSettings(
  interfaceMode: 'simple' | 'power' = 'simple',
  interfaceLanguage: string[] = [],
  isInterfaceModeLoading = false,
): void {
  jest.mocked(useSetting).mockImplementation((key: string) => {
    if (key === 'platform.interfaceMode')
      return [interfaceMode, jest.fn(), jest.fn(), isInterfaceModeLoading];
    if (key === 'platform.interfaceLanguage')
      return [interfaceLanguage, jest.fn(), jest.fn(), false];
    throw new Error(`useSetting mock: unexpected key "${key}"`);
  });
}

/** Configures `useProjectSetting` to report `shortName` as the source project's `platform.name`. */
function mockSourceShortName(shortName: string): void {
  jest
    .mocked(useProjectSetting)
    .mockImplementation((_source, key, defaultState) => [
      key === 'platform.name' ? shortName : defaultState,
      jest.fn(),
      jest.fn(),
      false,
    ]);
}

/**
 * Stubs {@link useLostBoundaryDismissal} to report the given lost anchors as undismissed.
 *
 * @returns The dismiss callback the stub hands the banner, so the wiring can be asserted on.
 */
function mockLostBoundaries(undismissedLostBoundaries: readonly string[]): jest.Mock {
  const onDismiss = jest.fn();
  jest.mocked(useLostBoundaryDismissal).mockReturnValue({ undismissedLostBoundaries, onDismiss });
  return onDismiss;
}

/**
 * Serves the stale analyses the notice has not been dismissed for, none unless given.
 *
 * @returns The dismissal handler served.
 */
function mockStaleAnalyses(
  undismissed: Partial<{
    glossCount: number;
    freeTranslationCount: number;
    freeTranslationSegmentIds: readonly string[];
  }> = {},
): jest.Mock {
  const onDismiss = jest.fn();
  jest.mocked(useStaleAnalysisDismissal).mockReturnValue({
    glossCount: 0,
    freeTranslationCount: 0,
    freeTranslationSegmentIds: [],
    ...undismissed,
    onDismiss,
  });
  return onDismiss;
}

/**
 * Serves a lexicon registry offering `openChooser`, or none when it is omitted - which is a project
 * that already has a lexicon, or one with no lexicon software to reach. Only the chooser is served:
 * nothing else the registry answers reaches this component.
 */
function mockLexiconRegistry(openChooser?: () => Promise<boolean>) {
  jest.mocked(useLexiconRegistry).mockReturnValue({
    isForeign: () => true,
    resolverWith: () => undefined,
    resolveSense: async () => undefined,
    openChooser,
  });
}

/**
 * Stubs {@link useLocalizedStrings} the way the real hook behaves: each lookup echoes its keys back
 * until resolved. A resolved key reads as itself without its `%` marks, unless `overrides` names
 * it.
 *
 * @returns Resolves every lookup mounted and not yet resolved.
 */
function mockLocalizedStringsResolvedOnDemand(
  overrides: Record<string, string> = {},
): () => Promise<void> {
  const pending = new Set<() => void>();
  jest.mocked(useLocalizedStrings).mockImplementation(function useStub(keys: readonly string[]) {
    const unresolved = useReactMemo(() => Object.fromEntries(keys.map((k) => [k, k])), [keys]);
    const [resolved, setResolved] = useReactState<{
      keys: readonly string[];
      strings: Record<string, string>;
    }>();
    useReactEffect(() => {
      const resolve = () =>
        setResolved({
          keys,
          strings: Object.fromEntries(keys.map((k) => [k, overrides[k] ?? k.slice(1, -1)])),
        });
      pending.add(resolve);
      return () => {
        pending.delete(resolve);
      };
    }, [keys]);
    return resolved?.keys === keys ? [resolved.strings, false] : [unresolved, true];
  });
  return async () => {
    await act(async () => {
      pending.forEach((resolve) => resolve());
      pending.clear();
    });
  };
}

/** Every `%…%` localize key showing anywhere in `element`, its text or its attributes. */
function rawKeysIn(element: HTMLElement): string[] {
  return element.outerHTML.match(/%[\w.]+%/g) ?? [];
}

function mockProjectBookIds(bookIds: string[] | undefined, isLoading = false): void {
  jest.mocked(useProjectBookIds).mockReturnValue({ bookIds, isLoading });
}

describe('InterlinearizerLoader', () => {
  beforeEach(() => {
    mockProjectBookIds(undefined);
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
    capturedInterlinearizerProps = undefined;
    capturedStoreProps = undefined;
    interlinearizerMountCount = 0;
    mockBookData();
    mockOptimisticSetting();
    mockLostBoundaries([]);
    mockStaleAnalyses();
    capturedReporterProps = undefined;
    mockLexiconRegistry();
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    mockKeyAsValueLocalizedStrings({
      '%interlinearizer_tabTitle%': 'Interlinearizer: {projectName}',
    });
    mockSettings();
    mockSourceShortName('WEB');
    mockUnreadSourceText();
  });

  it('shows nav controls when interface mode is power', async () => {
    mockSettings('power');
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('scripture-nav-controls')).toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('hides nav controls when interface mode is simple', async () => {
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.queryByTestId('scripture-nav-controls')).not.toBeInTheDocument();
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('resolves a verse-0 reference to verse 1 when the book has no verse-0 segment', async () => {
    mockBookData({
      book: makeVerseBook([
        { sid: 'GEN 3:1', text: 'Now the serpent.' },
        { sid: 'GEN 3:2', text: 'And the woman said.' },
      ]),
    });

    await flushHost(async () => {
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

  it("resolves a verse-0 reference to the chapter's earliest verse when it lacks verse 1", async () => {
    mockBookData({
      book: makeVerseBook([
        { sid: 'GEN 2:25', text: 'And they were not ashamed.' },
        { sid: 'GEN 3:3', text: 'But of the fruit.' },
        { sid: 'GEN 3:2', text: 'And the woman said.' },
      ]),
    });

    await flushHost(async () => {
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
      verseNum: 2,
    });
  });

  it('keeps a verse-0 reference to a chapter with no verse starts', async () => {
    await flushHost(async () => {
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
      verseNum: 0,
    });
  });

  it('keeps a verse-0 reference when the book has a verse-0 (superscription) segment', async () => {
    const bookWithSuperscription: Book = {
      ...EMPTY_GEN_BOOK,
      id: 'PSA',
      bookRef: 'PSA',
      segments: [makeSegment('PSA 3:0', 'A Psalm by David.', [])],
    };
    mockBookData({ book: bookWithSuperscription });

    await flushHost(async () => {
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

  it('keeps a verse-0 reference when the chapter opens with a heading', async () => {
    mockBookData({
      book: makeVerseBook([
        { heading: 's1', verseId: 'GEN 3:0', text: 'The Fall' },
        { sid: 'GEN 3:1', text: 'Now the serpent.' },
      ]),
    });

    await flushHost(async () => {
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
      verseNum: 0,
    });
  });

  it('resolves an out-of-range verse to the last segment of the same chapter', async () => {
    // The host's next-verse button emits verseNum + 1 without clamping, so bumping forward from
    // the last verse of a chapter delivers a verse past the chapter's end. The loader resolves it
    // to the chapter's last segment rather than letting the views fall back to the start of the
    // book. Chapter 4 exists so the test proves resolution stays within the requested chapter.
    const multiSegmentBook: Book = {
      ...EMPTY_GEN_BOOK,
      segments: [
        makeSegment('GEN 3:1', 'First verse.', []),
        makeSegment('GEN 3:2', 'Last verse of the chapter.', []),
        makeSegment('GEN 4:1', 'Next chapter.', []),
      ],
    };
    mockBookData({ book: multiSegmentBook });

    await flushHost(async () => {
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
      ...EMPTY_GEN_BOOK,
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

    await flushHost(async () => {
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
      ...EMPTY_GEN_BOOK,
      segments: [
        makeSegment('GEN 3:1', 'First verse.', []),
        makeSegment('GEN 3:3', 'Verse after the gap.', []),
      ],
    };
    mockBookData({ book: gappedBook });

    await flushHost(async () => {
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
      ...EMPTY_GEN_BOOK,
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

    await flushHost(async () => {
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

    await flushHost(async () => {
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
    await flushHost(async () => {
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
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
  });

  it('leaves the loading text blank while its localize key is unresolved', async () => {
    // The key-as-value stub stands in for PAPI's pre-resolution state, where each key maps to
    // itself — rendering that verbatim would flash the bare key at the user.
    mockBookData({ book: undefined, isLoading: true });
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('loading-indicator')).toBeEmptyDOMElement();
  });

  it('shows the loading text once its localize key resolves', async () => {
    mockKeyAsValueLocalizedStrings({ '%interlinearizer_loading%': 'Loading…' });
    mockBookData({ book: undefined, isLoading: true });
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('loading-indicator')).toHaveTextContent('Loading…');
  });

  it('shows an error heading and message when bookError is set', async () => {
    mockBookData({ book: undefined, bookError: 'Project not found' });
    await flushHost(async () => {
      renderLoader();
    });

    expect(
      screen.getByRole('heading', { name: '%interlinearizer_error_load_book_heading%' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  describe('when the platform cannot find the source project', () => {
    beforeEach(() => {
      // The book never arrives for a missing project, because core's project hooks never settle.
      mockBookData({ book: undefined, isLoading: true });
      jest
        .mocked(papi.projectLookup.getMetadataForProject)
        .mockRejectedValue(new Error(`No project found with ID ${testProjectId}`));
    });

    it('shows the project-unavailable panel instead of Loading', async () => {
      await act(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('project-unavailable')).toHaveTextContent(
        '%interlinearizer_error_projectUnavailable%',
      );
      expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
      expect(papi.projectLookup.getMetadataForProject).toHaveBeenCalledWith(testProjectId);
    });

    it('shows the missing-book view when the book list loads despite the failed lookup', async () => {
      mockProjectBookIds(['PHP']);
      await act(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('book-not-in-project')).toBeInTheDocument();
      expect(screen.queryByTestId('project-unavailable')).not.toBeInTheDocument();
    });

    it('shows only the load error when the book list loads despite the failed lookup', async () => {
      mockProjectBookIds(['GEN']);
      mockBookData({ book: undefined, bookError: 'Book GEN could not be read' });
      await act(async () => {
        renderLoader();
      });

      expect(screen.getByText('Book GEN could not be read')).toBeInTheDocument();
      expect(screen.queryByTestId('project-unavailable')).not.toBeInTheDocument();
    });

    it('shows the book when it loads despite the failed lookup', async () => {
      mockBookData();
      await act(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
      expect(screen.queryByTestId('project-unavailable')).not.toBeInTheDocument();
    });

    it('keeps the panel hidden when a later book fails to load', async () => {
      mockBookData();
      const view = await act(async () => renderLoader());

      mockBookData({ book: undefined, bookError: 'Book EXO not found' });
      await act(async () => {
        view.rerender(
          <InterlinearizerLoader
            projectId={testProjectId}
            webViewId={testWebViewId}
            useWebViewScrollGroupScrRef={makeScrollGroupHook()}
            useWebViewState={makeWebViewState()}
            updateWebViewDefinition={view.updateWebViewDefinition}
          />,
        );
      });

      expect(screen.getByText('Book EXO not found')).toBeInTheDocument();
      expect(screen.queryByTestId('project-unavailable')).not.toBeInTheDocument();
    });

    it('waits for localization before showing the panel', async () => {
      jest
        .mocked(useLocalizedStrings)
        .mockImplementation((keys: readonly string[]) => [
          Object.fromEntries(keys.map((key) => [key, key])),
          true,
        ]);
      await act(async () => {
        renderLoader();
      });

      expect(screen.queryByTestId('project-unavailable')).not.toBeInTheDocument();
      expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
    });
  });

  it('keeps showing Loading when the source project is found', async () => {
    mockBookData({ book: undefined, isLoading: true });
    jest.mocked(papi.projectLookup.getMetadataForProject).mockResolvedValue({
      id: testProjectId,
      projectInterfaces: [],
      pdpFactoryInfo: {},
    });
    await act(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId('project-unavailable')).not.toBeInTheDocument();
  });

  describe('segment pages', () => {
    it("hands the view the session's pages of the loaded book", async () => {
      await flushHost(async () => {
        renderLoader();
      });

      expect(capturedInterlinearizerProps?.pages.outline.map(({ id }) => id)).toEqual(
        GEN_1_1_BOOK.segments.map(({ id }) => id),
      );
    });
  });

  describe('when the source project lacks the book', () => {
    beforeEach(() => {
      mockProjectBookIds(['PHP']);
    });

    it('shows the missing-book view instead of the load error', async () => {
      mockBookData({ book: undefined, bookError: 'Book GEN not found' });
      await flushHost(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('book-not-in-project')).toBeInTheDocument();
      expect(screen.queryByText('Book GEN not found')).not.toBeInTheDocument();
    });

    it('shows the missing-book view instead of the loading indicator', async () => {
      mockBookData({ book: undefined, isLoading: true });
      await flushHost(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('book-not-in-project')).toBeInTheDocument();
      expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
    });

    it('hands the missing-book view the project, the web view, and the interface mode', async () => {
      mockSettings('power');
      await flushHost(async () => {
        renderLoader();
      });

      const view = screen.getByTestId('book-not-in-project');
      expect(view).toHaveAttribute('data-project-id', testProjectId);
      expect(view).toHaveAttribute('data-web-view-id', testWebViewId);
      expect(view).toHaveAttribute('data-power-mode', 'true');
    });
  });

  it('renders the book when the source project has it', async () => {
    mockProjectBookIds(['GEN', 'PHP']);
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
    expect(screen.queryByTestId('book-not-in-project')).not.toBeInTheDocument();
  });

  it("limits the book picker to the source project's books", async () => {
    mockSettings('power');
    mockProjectBookIds(['GEN', 'PHP']);
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('scripture-nav-controls')).toHaveAttribute(
      'data-active-book-ids',
      'GEN,PHP',
    );
  });

  it("hides the book picker while the source project's books are loading", async () => {
    mockSettings('power');
    mockProjectBookIds(undefined, true);
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.queryByTestId('scripture-nav-controls')).not.toBeInTheDocument();
  });

  it("offers the whole canon when the source project's books could not be listed", async () => {
    mockSettings('power');
    mockProjectBookIds(undefined);
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('scripture-nav-controls')).not.toHaveAttribute(
      'data-active-book-ids',
    );
  });

  it('passes the checked value from useOptimisticBooleanSetting to ViewOptionsDropdown', async () => {
    mockOptimisticSetting(true);
    await flushHost(async () => {
      renderLoader();
    });

    const toggle = screen.getByTestId('continuous-scroll-toggle');
    expect(toggle).toHaveAttribute('data-checked', 'true');
  });

  it('gates rendering until the persisted display settings have loaded', async () => {
    mockOptimisticSetting(false, jest.fn(), true);
    await flushHost(async () => {
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
    await flushHost(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('continuous-scroll-toggle'));
    expect(onChangeByKey.get('interlinearizer.continuousScroll')).toHaveBeenCalledWith(true);
  });

  it('passes the view-option settings to Interlinearizer', async () => {
    mockOptimisticSetting(true);
    await flushHost(async () => {
      renderLoader();
    });

    expect(capturedInterlinearizerProps?.viewOptions).toEqual({
      showMorphology: true,
      showFreeTranslation: true,
    });
  });

  it('defaults continuous scroll to off', async () => {
    await flushHost(async () => {
      renderLoader();
    });

    expect(lastSettingDefault('interlinearizer.continuousScroll')).toBe(false);
  });

  it('defaults morphology to off in the simple interface mode', async () => {
    await flushHost(async () => {
      renderLoader();
    });

    expect(lastSettingDefault('interlinearizer.showMorphology')).toBe(false);
  });

  it('defaults morphology to on in the power interface mode', async () => {
    mockSettings('power');
    await flushHost(async () => {
      renderLoader();
    });

    expect(lastSettingDefault('interlinearizer.showMorphology')).toBe(true);
  });

  it('defaults morphology to off when the interface mode cannot be read', async () => {
    jest.mocked(useSetting).mockImplementation((key: string) => {
      if (key === 'platform.interfaceMode')
        return [{ message: 'unavailable', platformErrorVersion: 1 }, jest.fn(), jest.fn(), false];
      return [[], jest.fn(), jest.fn(), false];
    });
    await flushHost(async () => {
      renderLoader();
    });

    expect(lastSettingDefault('interlinearizer.showMorphology')).toBe(false);
  });

  it('gates rendering until the interface mode has loaded', async () => {
    // Morphology defaults from the mode, so a view painted first would flash the wrong default.
    mockSettings('power', [], true);
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument();
  });

  it('defaults free translation to off for a draft holding none', async () => {
    await flushHost(async () => {
      renderLoader();
    });

    expect(lastSettingDefault('interlinearizer.showFreeTranslation')).toBe(false);
  });

  it('defaults free translation to on for a draft already holding one', async () => {
    await seedDraft({ ...emptyDraft(testProjectId), analysis: analysisWithFreeTranslation() });
    await flushHost(async () => {
      renderLoader();
    });

    expect(lastSettingDefault('interlinearizer.showFreeTranslation')).toBe(true);
  });

  it('wires ViewOptionsDropdown show-morphology to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await flushHost(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('show-morphology-toggle'));
    expect(onChangeByKey.get('interlinearizer.showMorphology')).toHaveBeenCalledWith(true);
  });

  it('passes a morphology change through to the view', async () => {
    // The view renders from its own copy of the setting rather than from the switch's, so a change
    // that never reached that copy would leave the morpheme boxes off however the switch looked.
    jest.mocked(useOptimisticBooleanSetting).mockImplementation(() => {
      // Mirrors the real hook's optimistic update; a fixed-value mock could never move the switch.
      // eslint-disable-next-line react-hooks/rules-of-hooks -- mock impl stands in for a hook
      const [value, setValue] = useReactState(false);
      return { value, onChange: setValue, isLoading: false };
    });
    await flushHost(async () => {
      renderLoader();
    });
    expect(capturedInterlinearizerProps?.viewOptions.showMorphology).toBe(false);

    await userEvent.click(screen.getByTestId('show-morphology-toggle'));

    expect(capturedInterlinearizerProps?.viewOptions.showMorphology).toBe(true);
  });

  it('holds the view at full opacity once a morphology change has been applied', async () => {
    // The dim marks a change still rendering, so a settled view carrying it would read as
    // permanently busy.
    mockOptimisticSetting();
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('pending-view-wrapper')).toHaveStyle({ opacity: '1' });
  });

  it('wires ViewOptionsDropdown show-free-translation to onChange from useOptimisticBooleanSetting', async () => {
    const onChangeByKey = mockOptimisticSetting();
    await flushHost(async () => {
      renderLoader();
    });

    await userEvent.click(screen.getByTestId('show-free-translation-toggle'));
    expect(onChangeByKey.get('interlinearizer.showFreeTranslation')).toHaveBeenCalledWith(true);
  });

  it('passes continuousScroll=true to Interlinearizer when the setting is true', async () => {
    mockOptimisticSetting(true);
    await flushHost(async () => {
      renderLoader();
    });

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(true);
  });

  it('passes continuousScroll=false to Interlinearizer when the setting is false', async () => {
    await flushHost(async () => {
      renderLoader();
    });

    expect(capturedInterlinearizerProps?.continuousScroll).toBe(false);
    expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
  });

  it('takes analysisLanguage from the draft analysisLanguages, not the active project', async () => {
    // The draft owns the analysis language; a draft configured for French must win even when
    // the active project's summary lists a different language.
    await seedDraft({ ...emptyDraft(testProjectId), analysisLanguages: ['fr'] });
    await act(async () =>
      renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
    );

    expect(capturedStoreProps?.analysisLanguage).toBe('fr');
  });

  it('falls back to the first interfaceLanguage tag when the draft has no analysis language', async () => {
    // A brand-new source seeds the draft's analysis language from the platform UI language.
    mockSettings('simple', ['fr', 'en']);
    await flushHost(async () => {
      renderLoader();
    });

    expect(capturedStoreProps?.analysisLanguage).toBe('fr');
  });

  it('passes the platform language to ProjectModals as defaultAnalysisLanguage', async () => {
    mockSettings('simple', ['de']);
    await flushHost(async () => {
      renderLoader();
    });

    expect(screen.getByTestId('project-modals')).toHaveAttribute('data-default-lang', 'de');
  });

  it('falls back to "und" as analysisLanguage when the draft has no language and interfaceLanguage is empty', async () => {
    await flushHost(async () => {
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
                blankMorphemeForm: 0,
              },
              drops: [],
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
        identicalPayloadsMerged: 0,
        identicalPhrasePayloadsMerged: 0,
        duplicateLinksDropped: 0,
        duplicatePhraseLinksDropped: 0,
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
        droppedBlankForm: 0,
      },
      filesPt9NeverLoads: [],
      filesTooLargeToRead: [],
    };

    const FRESH_IMPORT_SUMMARY = { ...STUB_IMPORT_PROJECT, updatedAt: '2026-08-21T00:00:00Z' };

    /**
     * Routes the loader's commands for these tests: draft loads stay empty, and the stored import
     * loads with an empty analysis. Its summary reads as the fresh one, and the import and copy
     * commands resolve as configured.
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
      otherCommands.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProject')
          return JSON.stringify({ ...FRESH_IMPORT_SUMMARY, analysis: emptyAnalysis() });
        if (args[0] === 'interlinearizer.getProjectSummary')
          return JSON.stringify(FRESH_IMPORT_SUMMARY);
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

    it('withholds the view options until the import’s analysis arrives', async () => {
      // The import's session never opens, so its analysis never arrives.
      mockSendCommand.mockImplementation(() => new Promise(() => {}));
      await renderImportView();

      expect(screen.queryByTestId('view-options-dropdown')).not.toBeInTheDocument();
    });

    it('shows the view options once the import’s analysis arrives', async () => {
      mockImportCommands();
      await renderImportView();

      expect(await screen.findByTestId('view-options-dropdown')).toBeInTheDocument();
    });

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
      await flushHost();

      expect(screen.queryByTestId('pt9-import-banner')).not.toBeInTheDocument();
    });

    it('opens the delete confirmation from the Delete menu item while an import is open', async () => {
      mockImportCommands();
      await renderImportView();

      await userEvent.click(screen.getByTestId('tab-toolbar-delete-project'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'delete');
    });

    it('silences Save, Save As, and Discard Unsaved Changes while an import is open', async () => {
      mockImportCommands();
      await renderImportView();
      mockSendCommand.mockClear();

      await userEvent.click(screen.getByTestId('tab-toolbar-save'));
      await userEvent.click(screen.getByTestId('tab-toolbar-save-as'));
      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
      await flushHost();

      expect(mockSendCommand).not.toHaveBeenCalled();
      expect(screen.queryByTestId('save-as-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('discard-changes-modal-panel')).not.toBeInTheDocument();
    });

    /**
     * A probe response carrying these change tokens, with every file small enough to retrieve,
     * which is what these flows assume.
     */
    function probeOf(hashes: Record<string, string>) {
      return {
        maxReadBytes: 52_428_800,
        files: Object.fromEntries(
          Object.entries(hashes).map(([filePath, hash]) => [filePath, { hash, sizeBytes: 1024 }]),
        ),
      };
    }

    /** Points the frontend PDP mock at a manifest, so the offer probe answers `available`. */
    function mockOfferProbe(manifest: Record<string, string> = { 'Interlinear_en/x.xml': 'h' }) {
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: jest.fn().mockResolvedValue(probeOf(manifest)),
      });
    }

    it('offers the first-open conversion and runs the import on Yes', async () => {
      mockOfferProbe();
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await flushHost(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });
      expect(screen.getByTestId('pt9-convert-prompt-message')).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportPrompt_yes%' }),
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
      await flushHost(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });
      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportPrompt_yes%' }),
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

    it('stores the empty draft and runs no import on No', async () => {
      mockOfferProbe();
      mockImportCommands();
      await flushHost(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportPrompt_no%' }),
      );
      await flushHost();

      expect(screen.queryByTestId('pt9-convert-prompt-message')).not.toBeInTheDocument();
      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.startDraftOver',
        expect.objectContaining({ sourceProjectId: testProjectId }),
      );
      expect(mockSendCommand).not.toHaveBeenCalledWith(
        'interlinearizer.importPt9Project',
        expect.anything(),
      );
    });

    it('holds the offer while the draft is still loading', async () => {
      mockOfferProbe();
      // The session never opens, so the draft never loads.
      mockSendCommand.mockImplementation(() => new Promise(() => {}));
      await flushHost(async () => {
        renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
      });

      expect(screen.queryByTestId('pt9-convert-prompt-message')).not.toBeInTheDocument();
    });

    it('never offers when the probe finds no convertible data', async () => {
      mockOfferProbe({});
      mockImportCommands();
      await flushHost(async () => {
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
        await flushHost(async () => {
          renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
        });
        expect(screen.queryByTestId('pt9-checking')).not.toBeInTheDocument();

        await flushHost(async () => {
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
        await flushHost(async () => {
          renderLoader({ useWebViewState: makeWebViewState({ offerPt9Import: true }) });
        });

        await flushHost(async () => {
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
      await flushHost(async () => {
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
      await flushHost(async () => {
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

    /** Imports from the select modal and opens the fresh import from its report. */
    async function openFreshImport(): Promise<void> {
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
        screen.getByRole('button', { name: '%interlinearizer_pt9ImportModal_open%' }),
      );
    }

    it('explains the read-only import once it opens from the report', async () => {
      await openFreshImport();

      expect(screen.getByTestId('pt9-read-only-intro-title')).toBeInTheDocument();
    });

    it('moves from the read-only explanation to the copy dialog', async () => {
      await openFreshImport();

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ReadOnlyIntro_copy%' }),
      );
      await flushHost();

      expect(screen.queryByTestId('pt9-read-only-intro-title')).not.toBeInTheDocument();
      expect(screen.getByTestId('copy-to-editable-modal-title')).toBeInTheDocument();
    });

    it('leaves the import open read-only when the explanation is answered View read-only', async () => {
      await openFreshImport();

      await userEvent.click(
        screen.getByRole('button', { name: '%interlinearizer_pt9ReadOnlyIntro_view%' }),
      );
      await flushHost();

      expect(screen.queryByTestId('pt9-read-only-intro-title')).not.toBeInTheDocument();
      expect(screen.queryByTestId('copy-to-editable-modal-title')).not.toBeInTheDocument();
      expect(screen.getByTestId('pt9-import-banner')).toBeInTheDocument();
    });

    it('returns to the select modal when an import report is closed', async () => {
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', report: IMPORT_REPORT },
      });
      await flushHost(async () => {
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
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      const error = await screen.findByTestId('pt9-import-error');
      expect(error).toHaveTextContent('%interlinearizer_pt9ImportModal_failed%');
    });

    it('names the never-loaded files when a first import converts nothing', async () => {
      mockImportCommands({
        importResult: {
          outcome: 'notConverted',
          filesTooLargeToRead: [],
          filesPt9NeverLoads: ['Interlinear_en/Interlinear_en_opy.xml'],
        },
      });
      await act(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      expect(await screen.findByTestId('pt9-import-error')).toBeInTheDocument();
      expect(screen.getByTestId('pt9-files-never-loaded')).toBeInTheDocument();
    });

    it('shows the friendly too-large message when the platform refuses the oversized payload', async () => {
      mockImportCommands({
        importError: new Error(
          "PT9 interlinear data is too large: the project's interlinear files total 60000000 bytes",
        ),
      });
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      const error = await screen.findByTestId('pt9-import-error');
      expect(error).toHaveTextContent('%interlinearizer_pt9ImportModal_tooLarge%');
    });

    it('syncs from the banner and shows the report with Close only', async () => {
      mockImportCommands({
        importResult: {
          outcome: 'imported',
          projectId: 'import-1',
          report: IMPORT_REPORT,
          summary: FRESH_IMPORT_SUMMARY,
        },
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
      await flushHost();

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.queryByTestId('pt9-import-report')).not.toBeInTheDocument();
    });

    it('names the oversized files when a sync could read none of them', async () => {
      mockImportCommands({
        importResult: {
          outcome: 'staleKept',
          staleReason: 'allFilesTooLarge',
          projectId: 'import-1',
          filesTooLargeToRead: [
            {
              path: 'Interlinear_en/Interlinear_en_PSA.xml',
              bookId: 'PSA',
              glossLanguage: 'en',
              sizeBytes: 90_000_000,
              maxResponseBytes: 83_886_080,
            },
          ],
        },
      });
      await renderImportView();

      await userEvent.click(screen.getByTestId('pt9-sync-button'));

      expect(screen.getByTestId('pt9-import-stale-kept')).toBeInTheDocument();
      expect(screen.getByTestId('pt9-files-too-large')).toBeInTheDocument();
    });

    it('names the never-loaded files when a sync converts no gloss language', async () => {
      mockImportCommands({
        importResult: {
          outcome: 'staleKept',
          staleReason: 'noGlossLanguage',
          projectId: 'import-1',
          filesTooLargeToRead: [],
          filesPt9NeverLoads: ['Interlinear_en/Interlinear_en_opy.xml'],
        },
      });
      await renderImportView();

      await userEvent.click(screen.getByTestId('pt9-sync-button'));

      expect(screen.getByTestId('pt9-import-stale-kept')).toBeInTheDocument();
      expect(screen.getByTestId('pt9-files-never-loaded')).toBeInTheDocument();
    });

    it('opens an unchanged import directly from the select modal', async () => {
      mockImportCommands();
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => probeOf({ 'Lexicon.xml': 'aaaa1111' }),
      });
      await flushHost(async () => {
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
      expect(screen.queryByTestId('pt9-read-only-intro-title')).not.toBeInTheDocument();
    });

    it('auto-syncs a changed import before opening, with no report step', async () => {
      mockImportCommands({
        importResult: { outcome: 'imported', projectId: 'import-1', summary: FRESH_IMPORT_SUMMARY },
      });
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => probeOf({ 'Lexicon.xml': 'bbbb2222' }),
      });
      await flushHost(async () => {
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
      otherCommands.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.importPt9Project') return new Promise<string>(() => {});
        return JSON.stringify(emptyDraft(testProjectId));
      });
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => probeOf({ 'Lexicon.xml': 'bbbb2222' }),
      });
      await flushHost(async () => {
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
        await flushHost(async () => {
          renderLoader();
        });
        fireEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
        await flushHost();
        fireEvent.click(screen.getByTestId('select-modal-open-import'));
        await flushHost();
        expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'select');

        await flushHost(async () => {
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
      await flushHost(async () => {
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
        '%interlinearizer_copyModal_defaultDescription%',
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
        getPt9InterlinearManifest: async () => probeOf({}),
      });
      await flushHost(async () => {
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
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));

      expect(await screen.findByTestId('pt9-import-error')).toBeInTheDocument();
    });

    it('opens the stored import when an open-path sync returns a malformed result', async () => {
      mockImportCommands({ importResult: 42 });
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => probeOf({ 'Lexicon.xml': 'bbbb2222' }),
      });
      await flushHost(async () => {
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

    it('offers no undo or redo buttons in the import view', async () => {
      mockImportCommands();
      await renderImportView();

      expect(screen.queryByRole('button', { name: '%undoButton_tooltip%' })).toBeNull();
      expect(screen.queryByRole('button', { name: '%redoButton_tooltip%' })).toBeNull();
    });

    it('leaves the draft alone on Ctrl+Z while an import is showing', async () => {
      mockImportCommands();
      mockPdpGet.mockResolvedValue({
        getPt9InterlinearManifest: async () => probeOf({ 'Lexicon.xml': 'aaaa1111' }),
      });
      mockBookData({ book: ALPHA_BETA_BOOK });
      jest.useFakeTimers();
      await flushHost(async () => renderLoader());
      await flushHost(() => capturedInterlinearizerProps?.segmentationDispatch.split('GEN 1:1:6'));
      act(() => jest.advanceTimersByTime(300));
      fireEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await act(async () => fireEvent.click(screen.getByTestId('select-modal-open-import')));
      await screen.findByTestId('pt9-import-banner');
      mockSendCommand.mockClear();

      act(() => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });
      act(() => jest.advanceTimersByTime(300));
      jest.useRealTimers();

      expect(mockSendCommand).not.toHaveBeenCalledWith(
        'interlinearizer.undoEdit',
        expect.anything(),
      );
    });

    it('hands the import view a segmentation dispatch that cannot write the draft', async () => {
      mockImportCommands();
      await renderImportView();
      mockSendCommand.mockClear();

      await flushHost(() => {
        capturedInterlinearizerProps?.segmentationDispatch.merge('GEN 1:2:0');
        capturedInterlinearizerProps?.segmentationDispatch.split('GEN 1:1:2');
        capturedInterlinearizerProps?.segmentationDispatch.move('GEN 1:1:2', 'GEN 1:1:4');
      });

      expect(mockSendCommand).not.toHaveBeenCalled();
    });

    it('drops a phrase mode entered on the draft when an import opens', async () => {
      mockImportCommands();
      await flushHost(async () => {
        renderLoader();
      });
      await flushHost(() => {
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

      await flushHost(() => {
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

    it('shows the in-modal failure when the import result carries no valid report', async () => {
      mockImportCommands({ importResult: { outcome: 'imported', projectId: 'import-1' } });
      await flushHost(async () => {
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
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-import-pt9'));
      await screen.findByTestId('pt9-import-report');

      jest.mocked(papi.notifications.send).mockRejectedValue(new Error('ui offline'));
      otherCommands.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.getProjectSummary'
          ? undefined
          : JSON.stringify(emptyDraft(testProjectId)),
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
      otherCommands.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProjectSummary' && imported) {
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
      await flushHost(async () => {
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

      await flushHost(async () => {
        releaseSummary?.();
      });

      // The select modal the user went back to is still theirs, and no project has been switched in.
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'select');
      expect(screen.getByTestId('project-modals')).not.toHaveAttribute('data-active-project-name');
    });

    it('notifies and stays on the report when the Open fetch rejects', async () => {
      jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
      let imported = false;
      otherCommands.mockImplementation(async (...args) => {
        if (args[0] === 'interlinearizer.getProjectSummary' && imported)
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
      await flushHost(async () => {
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
      await flushHost();

      expect(screen.queryByTestId('copy-to-editable-modal-title')).not.toBeInTheDocument();
      expect(mockSendCommand).not.toHaveBeenCalledWith(
        'interlinearizer.createEditableCopy',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('logs and keeps the dialog when the copy command rejects', async () => {
      otherCommands.mockImplementation(async (...args) => {
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
  });

  describe('modal interactions', () => {
    it('opens the select modal when the project menu selectProject item is clicked', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));

      expect(screen.getByTestId('select-modal')).toBeInTheDocument();
    });

    it('opens the create modal directly when the openNewProjectModal menu item is clicked', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));
      await flushHost();

      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('closes the create modal without showing another when close is clicked from menu source', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));
      await userEvent.click(screen.getByTestId('create-modal-close'));
      await flushHost();

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('closes the select modal when its close button is clicked', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-close'));
      await flushHost();

      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('opens the create modal from the select modal create-new button', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));

      expect(screen.getByTestId('create-modal')).toBeInTheDocument();
    });

    it('closes all modals after a project is created from the select modal', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-create-new'));
      await userEvent.click(screen.getByTestId('create-modal-created'));
      await flushHost();

      expect(screen.queryByTestId('create-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('sets the active project and closes the select modal when a project is selected', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await flushHost();

      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
      // After selection the view-project-info button becomes available, confirming activeProject is set
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('opens the metadata modal from the openProjectInfoModal menu item when a project is active', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      // Select a project so activeProject is set
      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));

      expect(screen.getByTestId('metadata-modal')).toBeInTheDocument();
    });

    it('does not open the metadata modal from openProjectInfoModal when no project is active', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await flushHost();

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
    });

    it('dismisses to none when metadata is closed after being opened from the menu', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-close'));
      await flushHost();

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-modal')).not.toBeInTheDocument();
    });

    it('dismisses to none and clears active project when the active project is deleted from the menu', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-deleted'));
      await flushHost();

      expect(screen.queryByTestId('metadata-modal')).not.toBeInTheDocument();
      // The deleted project was the active one, so the loader should now pass `activeProject:
      // undefined` down to ProjectModals (the stub omits the attribute when there is no name).
      expect(screen.getByTestId('project-modals')).not.toHaveAttribute('data-active-project-name');
    });

    it('opens the delete confirmation from the Delete menu item when a project is active', async () => {
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
      );

      await userEvent.click(screen.getByTestId('tab-toolbar-delete-project'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'delete');
    });

    it('does not open the delete confirmation from the Delete menu item when no project is active', async () => {
      await act(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-delete-project'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
    });

    describe('the Delete item', () => {
      /** Serves a project menu holding the Delete item and one that is never filtered out. */
      function serveMenuWithDeleteItem() {
        const menu = {
          topMenu: {
            label: 'top',
            items: [
              {
                command: 'interlinearizer.openDeleteProjectModal',
                label: 'Delete',
                group: 'interlinearizer.draftActions',
                order: 2,
                localizeNotes: '',
              },
              {
                command: 'interlinearizer.openSelectProjectModal',
                label: 'Select',
                group: 'interlinearizer.projectActions',
                order: 1,
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
            new Proxy({}, { get: () => jest.fn().mockReturnValue([menu, jest.fn(), false]) }),
          );
      }

      it('is offered while a project is active', async () => {
        serveMenuWithDeleteItem();
        await act(async () =>
          renderLoader({
            useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }),
          }),
        );

        expect(screen.getByTestId('tab-toolbar')).toHaveAttribute(
          'data-project-menu-commands',
          'interlinearizer.openDeleteProjectModal interlinearizer.openSelectProjectModal',
        );
      });

      it('is gone while no project is active', async () => {
        serveMenuWithDeleteItem();
        await act(async () => {
          renderLoader();
        });

        expect(screen.getByTestId('tab-toolbar')).toHaveAttribute(
          'data-project-menu-commands',
          'interlinearizer.openSelectProjectModal',
        );
      });
    });

    it("hands the project dialogs the source project's short name", async () => {
      mockSourceShortName('SRC');
      await act(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-source-short-name', 'SRC');
    });

    it('hands the project dialogs the project ID while the short name cannot be read', async () => {
      jest
        .mocked(useProjectSetting)
        .mockImplementation((_source, key, defaultState) => [
          key === 'platform.name'
            ? { message: 'Setting failed', platformErrorVersion: 1 }
            : defaultState,
          jest.fn(),
          jest.fn(),
          false,
        ]);
      await act(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-source-short-name',
        testProjectId,
      );
    });

    it('updates the active project name when its metadata is saved', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-project-menu'));
      await userEvent.click(screen.getByTestId('select-modal-select'));
      await userEvent.click(screen.getByTestId('tab-toolbar-view-project-info'));
      await userEvent.click(screen.getByTestId('metadata-modal-saved'));
      await flushHost();

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
      await flushHost(async () => {
        renderLoader();
      });

      expect(screen.getByTestId('tab-toolbar')).toBeInTheDocument();
    });

    describe('the lexicon chooser item', () => {
      /** Serves a project menu holding the chooser item and one that is never filtered out. */
      function serveMenuWithChooserItem() {
        const menu = {
          topMenu: {
            label: 'top',
            items: [
              {
                command: 'interlinearizer.openLexiconChooser',
                label: 'Lexicon',
                group: 'interlinearizer.lexiconActions',
                order: 1,
                localizeNotes: '',
              },
              {
                command: 'interlinearizer.openSelectProjectModal',
                label: 'Select',
                group: 'interlinearizer.projectActions',
                order: 1,
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
            new Proxy({}, { get: () => jest.fn().mockReturnValue([menu, jest.fn(), false]) }),
          );
      }

      it('is offered while a lexicon can be linked', async () => {
        serveMenuWithChooserItem();
        mockLexiconRegistry(jest.fn(async () => true));
        await flushHost(async () => {
          renderLoader();
        });

        expect(screen.getByTestId('tab-toolbar')).toHaveAttribute(
          'data-project-menu-commands',
          'interlinearizer.openLexiconChooser interlinearizer.openSelectProjectModal',
        );
      });

      it('is gone where there is no lexicon to offer, rather than shown doing nothing', async () => {
        serveMenuWithChooserItem();
        await flushHost(async () => {
          renderLoader();
        });

        expect(screen.getByTestId('tab-toolbar')).toHaveAttribute(
          'data-project-menu-commands',
          'interlinearizer.openSelectProjectModal',
        );
      });

      it('opens the chooser when it is chosen', async () => {
        const openChooser = jest.fn(async () => true);
        mockLexiconRegistry(openChooser);
        await flushHost(async () => {
          renderLoader();
        });

        await userEvent.click(screen.getByTestId('tab-toolbar-lexicon-chooser'));
        await flushHost();

        expect(openChooser).toHaveBeenCalled();
        expect(jest.mocked(papi.notifications.send)).not.toHaveBeenCalled();
      });

      it('says so when the chooser does not open', async () => {
        mockLexiconRegistry(jest.fn(async () => false));
        jest.mocked(papi.notifications.send).mockRejectedValue(new Error('ui offline'));
        await flushHost(async () => {
          renderLoader();
        });

        await userEvent.click(screen.getByTestId('tab-toolbar-lexicon-chooser'));

        await waitFor(() =>
          expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
            message: '%interlinearizer_error_openLexiconChooser_failed%',
            severity: 'error',
          }),
        );
      });
    });
  });

  describe('segmentation dispatch', () => {
    /** A two-verse book so boundary edits produce real, non-default deltas. */
    const TWO_VERSE_BOOK: Book = {
      ...EMPTY_GEN_BOOK,
      segments: [
        makeSegment('GEN 1:1', 'Alpha beta.', [
          makeWordToken('GEN 1:1:0', 'Alpha'),
          makeWordToken('GEN 1:1:6', 'beta', 6),
        ]),
        makeSegment('GEN 1:2', 'Gamma.', [makeWordToken('GEN 1:2:0', 'Gamma')]),
      ],
    };

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

    it('sends split, merge, and move boundary edits made through the dispatch to the session', async () => {
      mockBookData({ book: TWO_VERSE_BOOK });
      await flushHost(async () => {
        renderLoader();
      });
      const dispatch = getSegmentationDispatch();

      await flushHost(() => dispatch.split('GEN 1:1:6'));
      await flushHost(() => dispatch.merge('GEN 1:2:0'));
      await flushHost(() => dispatch.move('GEN 1:2:0', 'GEN 1:1:6'));

      expect(editsSent()).toEqual([
        'interlinearizer.splitSegment',
        'interlinearizer.mergeSegments',
        'interlinearizer.moveBoundary',
      ]);
    });

    it('re-renders the interlinearizer with the new segments in place after a boundary edit', async () => {
      // The resegmented book is derived from the draft's ref-held segmentation, so the new `book`
      // prop reaches the interlinearizer only because a boundary change bumps a dedicated version.
      // Assert the split reaches the rendered `book` (verse 1 becomes two segments) without a
      // remount.
      mockBookData({ book: TWO_VERSE_BOOK });
      await flushHost(async () => {
        renderLoader();
      });
      const dispatch = getSegmentationDispatch();
      expect(capturedInterlinearizerProps?.book.segments).toHaveLength(2);
      const mountsBefore = interlinearizerMountCount;

      await flushHost(() => dispatch.split('GEN 1:1:6'));

      // Verse 1 is now two segments (before/after "beta"), so the book has three segments total, and
      // the interlinearizer was updated in place rather than remounted.
      expect(capturedInterlinearizerProps?.book.segments).toHaveLength(3);
      expect(interlinearizerMountCount).toBe(mountsBefore);
    });

    it('saves a boundary edit to the active project and clears the unsaved marker', async () => {
      mockBookData({ book: TWO_VERSE_BOOK });
      otherCommands.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.saveDraftToProject'
          ? answerSave({ ...STUB_ACTIVE_PROJECT, updatedAt: '2026-02-01T00:00:00Z' }, args)
          : undefined,
      );
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader({
          useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }),
        });
      });
      const dispatch = getSegmentationDispatch();

      // A boundary edit dirties the draft, so the tab marker lights up.
      await flushHost(() => dispatch.merge('GEN 1:2:0'));
      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({
        title: 'Interlinearizer: WEB ●',
      });

      result?.updateWebViewDefinition.mockClear();
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(mockSendCommand).toHaveBeenCalledWith(
        'interlinearizer.saveDraftToProject',
        expect.any(String),
        testProjectId,
        'proj-1',
      );
      await waitFor(() =>
        expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({
          title: 'Interlinearizer: WEB',
        }),
      );
    });

    /** Stores a draft carrying `segmentation`. */
    async function mockDraftWithSegmentation(
      segmentation: DraftProject['segmentation'],
    ): Promise<void> {
      await seedDraft({ ...emptyDraft(testProjectId), segmentation });
    }

    it('persists nothing when every stored split still names its word', async () => {
      await mockDraftWithSegmentation({
        removedVerseStarts: [],
        addedStarts: [{ tokenRef: 'GEN 1:1:6', surfaceText: 'beta' }],
      });
      mockBookData({ book: TWO_VERSE_BOOK });
      jest.useFakeTimers();
      await flushHost(async () => {
        renderLoader();
      });
      await flushHost(() => jest.advanceTimersByTime(300));
      jest.useRealTimers();

      expect(capturedInterlinearizerProps?.book.segments).toHaveLength(3);
      expect(editsSent()).toEqual([]);
    });
  });

  describe('former boundaries', () => {
    /**
     * A four-verse book covering every former-boundary shape: a word-initial verse (1:3), a verse
     * that begins with punctuation so its first word token differs from its first token (1:2), a
     * verse with no word token at all (1:4), and a token-less verse (1:5).
     */
    const BOUNDARY_SHAPES_BOOK: Book = {
      ...EMPTY_GEN_BOOK,
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

    it('passes an empty formerBoundaries map before any boundary edit', async () => {
      await renderBoundaryBook();

      expect(capturedInterlinearizerProps?.formerBoundaries.size).toBe(0);
    });

    it("passes the verse book's unmergeable starts", async () => {
      await renderBoundaryBook();

      expect(capturedInterlinearizerProps?.unmergeableStarts).toEqual(new Set(['GEN 1:1:0']));
    });

    it('maps a merged word-initial verse start to itself and bumps segmentationVersion', async () => {
      const dispatch = await renderBoundaryBook();
      const versionBefore = capturedInterlinearizerProps?.pages.segmentationVersion ?? 0;

      // Merge verse 3 into verse 2: the verse begins with a word token, so the split anchor (its
      // first word token) and the removed default start are the same ref.
      await flushHost(() => dispatch.merge('GEN 1:3:0'));

      expect(capturedInterlinearizerProps?.formerBoundaries.get('GEN 1:3:0')).toBe('GEN 1:3:0');
      expect(capturedInterlinearizerProps?.pages.segmentationVersion).toBeGreaterThan(
        versionBefore,
      );
    });

    it('keys a punct-initial merged verse by its first word token, mapped to the removed start', async () => {
      const dispatch = await renderBoundaryBook();

      // Merge verse 2 into verse 1: the verse opens with a quote mark, so the boundary slot's word
      // anchor (the first word token) differs from the removed default start (the punct token).
      await flushHost(() => dispatch.merge('GEN 1:2:0'));

      expect(capturedInterlinearizerProps?.formerBoundaries.get('GEN 1:2:1')).toBe('GEN 1:2:0');
      expect(capturedInterlinearizerProps?.formerBoundaries.has('GEN 1:2:0')).toBe(false);
    });

    it('skips a merged-away verse that has no word token', async () => {
      const dispatch = await renderBoundaryBook();

      // Merge verse 4 (punctuation only) into verse 3: with no word token there is no split anchor
      // to key the former boundary by, so the verse contributes no map entry.
      await flushHost(() => dispatch.merge('GEN 1:4:0'));

      expect(capturedInterlinearizerProps?.formerBoundaries.size).toBe(0);
    });

    it('does not map verses whose default start was not merged away', async () => {
      const dispatch = await renderBoundaryBook();

      // Only verse 3 is merged; the other verses keep their default boundaries and must stay out
      // of the map so their slots do not render former-boundary ticks.
      await flushHost(() => dispatch.merge('GEN 1:3:0'));

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
          webViewId={testWebViewId}
          useWebViewScrollGroupScrRef={scrollGroupHook}
          useWebViewState={webViewState}
          updateWebViewDefinition={updateWebViewDefinition}
        />
      );
      let view: ReturnType<typeof render> | undefined;
      await flushHost(async () => {
        view = render(buildUi());
      });
      const dispatch = capturedInterlinearizerProps?.segmentationDispatch;
      if (!dispatch) throw new Error('expected a captured segmentationDispatch');
      // Merge so the draft's delta has a removed verse start.
      await flushHost(() => dispatch.merge('GEN 1:3:0'));
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
    /**
     * Renders the loader on a loaded book, parked on GEN unless a `scrRef` elsewhere asks for a
     * cross-book swap.
     */
    async function renderOnLoadedBook(scrRef?: SerializedVerseRef): Promise<void> {
      mockBookData({ book: GEN_1_1_BOOK });
      await act(async () => {
        renderLoader({ useWebViewScrollGroupScrRef: makeScrollGroupHook(scrRef) });
      });
    }

    it('shows the banner when the hook reports an undismissed loss', async () => {
      mockLostBoundaries(['GEN 1:9:0']);

      await renderOnLoadedBook();

      expect(screen.getByTestId('lost-boundaries-banner')).toBeInTheDocument();
    });

    it('does not show the banner when the hook reports no loss', async () => {
      await renderOnLoadedBook();

      expect(screen.queryByTestId('lost-boundaries-banner')).not.toBeInTheDocument();
    });

    it('holds the banner back until the localized strings resolve', async () => {
      jest
        .mocked(useLocalizedStrings)
        .mockImplementation((keys: readonly string[]) => [
          Object.fromEntries(keys.map((k) => [k, k])),
          true,
        ]);
      mockLostBoundaries(['GEN 1:9:0']);

      await renderOnLoadedBook();

      expect(screen.queryByTestId('lost-boundaries-banner')).not.toBeInTheDocument();
    });

    it('holds the banner back during a cross-book swap', async () => {
      // A swap is mid-flight when scrRef already names EXO but the loaded book is still GEN, whose
      // anchors are the ones lost.
      mockLostBoundaries(['GEN 1:9:0']);

      await renderOnLoadedBook({ book: 'EXO', chapterNum: 1, verseNum: 1 });

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
      mockLostBoundaries(['GEN 1:9:0', 'GEN 1:1:99']);

      await renderOnLoadedBook();

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
      mockLostBoundaries(['GEN 1:9:0']);

      await renderOnLoadedBook();

      expect(screen.getByTestId('lost-boundaries-banner')).toHaveTextContent('just the one');
    });

    it('dismisses through the hook when the banner close button is clicked', async () => {
      const onDismiss = mockLostBoundaries(['GEN 1:9:0']);
      await renderOnLoadedBook();

      await userEvent.click(screen.getByTestId('lost-boundaries-dismiss'));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('leaves the draft untouched when the banner is dismissed', async () => {
      mockLostBoundaries(['GEN 1:9:0']);
      await renderOnLoadedBook();

      await userEvent.click(screen.getByTestId('lost-boundaries-dismiss'));

      // The banner is read-only: the anchors themselves stay for a source that reverts.
      expect(editsSent()).toEqual([]);
    });
  });

  describe('stale analyses notice', () => {
    /** Genesis 1:1–3, verse 2 emptied of its words. */
    const THREE_VERSE_BOOK: Book = {
      ...GEN_1_1_BOOK,
      segments: [
        makeSegment('GEN 1:1', 'In the beginning.', [makeWordToken('GEN 1:1:0', 'In')]),
        makeSegment('GEN 1:2', '', []),
        makeSegment('GEN 1:3', 'And God said.', [makeWordToken('GEN 1:3:0', 'And')]),
      ],
    };

    /** Genesis 1:1–3, verse 2 resuming after a mid-verse heading with only its closing stop. */
    const RESUMED_PUNCTUATION_BOOK: Book = {
      ...GEN_1_1_BOOK,
      segments: [
        makeSegment('GEN 1:1', 'In the beginning.', [makeWordToken('GEN 1:1:0', 'In')]),
        makeSegment('GEN 1:2', 'God said', [makeWordToken('GEN 1:2:0', 'God')]),
        {
          ...makeSegment('GEN 1:2', '.', [makePunctToken('GEN 1:2:9')]),
          id: 'GEN 1:2:9',
          startRef: { book: 'GEN', chapter: 1, verse: 2, charIndex: 9 },
        },
        makeSegment('GEN 1:3', 'And God said.', [makeWordToken('GEN 1:3:0', 'And')]),
      ],
    };

    /**
     * Renders the loader on `book` parked at `verseNum` of Genesis 1, the scroll group's reference
     * held in state so each step starts from where the last one took the reader.
     *
     * @returns A way to move the reader to another verse of Genesis 1.
     */
    async function renderWithHeldScrRef(
      book: Book,
      verseNum: number,
    ): Promise<(toVerse: number) => void> {
      mountStoreProbe = true;
      mockBookData({ book });
      let setHeldScrRef: (scrRef: SerializedVerseRef) => void = () => {};
      const useScrollGroup = (): ScrollGroupTuple => {
        // eslint-disable-next-line react-hooks/rules-of-hooks -- stands in for the host's hook
        const [scrRef, setScrRef] = useReactState<SerializedVerseRef>({
          book: 'GEN',
          chapterNum: 1,
          verseNum,
        });
        setHeldScrRef = setScrRef;
        return [scrRef, setScrRef, undefined, () => {}, undefined];
      };
      await act(async () => {
        renderLoader({ useWebViewScrollGroupScrRef: useScrollGroup });
      });
      return (toVerse) =>
        act(() => setHeldScrRef({ book: 'GEN', chapterNum: 1, verseNum: toVerse }));
    }

    /** A stale place of `analysisId` at `tokenRef`, whose word read differently when glossed. */
    function staleAt(analysisId: string, tokenRef: string) {
      return {
        id: `${tokenRef}:${analysisId}`,
        ...FIXTURE_STAMPS,
        analysisId,
        status: 'stale' as const,
        token: { tokenRef, surfaceText: 'Formerly' },
      };
    }

    /** Analyses stale in GEN and in EXO, and another applied in GEN. */
    const STALE_IN_TWO_BOOKS: TextAnalysis = {
      ...emptyAnalysis(),
      tokenAnalyses: [
        { ...FIXTURE_STAMPS, id: 'ta-gen', surfaceText: 'Formerly' },
        { ...FIXTURE_STAMPS, id: 'ta-exo', surfaceText: 'Formerly' },
        { ...FIXTURE_STAMPS, id: 'ta-live', surfaceText: 'In' },
      ],
      tokenAnalysisLinks: [
        staleAt('ta-gen', 'GEN 1:1:0'),
        staleAt('ta-exo', 'EXO 1:1:0'),
        {
          id: 'tl-2',
          ...FIXTURE_STAMPS,
          analysisId: 'ta-live',
          status: 'approved',
          token: { tokenRef: 'GEN 1:1:0', surfaceText: 'In' },
        },
      ],
    };

    afterEach(() => {
      mountStoreProbe = false;
    });

    /**
     * Renders the loader on a loaded book, parked on GEN 1:1 unless a `scrRef` elsewhere asks for a
     * cross-book swap.
     *
     * @returns The spy on the scroll group's reference setter.
     */
    async function renderOnLoadedBook(
      options: { book?: Book; scrRef?: SerializedVerseRef } = {},
    ): Promise<jest.Mock> {
      const setScrRef = jest.fn();
      mockBookData({ book: options.book ?? GEN_1_1_BOOK });
      await act(async () => {
        renderLoader({
          useWebViewScrollGroupScrRef: makeScrollGroupHook(options.scrRef, setScrRef),
        });
      });
      return setScrRef;
    }

    /** Overrides one localized template, echoing every other key. */
    function mockTemplate(key: string, template: string): void {
      mockKeyAsValueLocalizedStrings({ [key]: template });
    }

    it('reports on the loaded book from inside the draft’s store', async () => {
      await renderOnLoadedBook();

      expect(capturedReporterProps?.book).toBe(GEN_1_1_BOOK);
    });

    it('reports on no book while one is loading', async () => {
      mockBookData({ book: undefined, isLoading: true });

      await flushHost(async () => {
        renderLoader();
      });

      expect(capturedReporterProps).toBeUndefined();
    });

    it('tracks the dismissal of what the reporter finds', async () => {
      await renderOnLoadedBook();
      const report: StaleAnalysesReport = {
        bookRef: 'GEN',
        glosses: ['gloss ta-1 GEN 1:1:0'],
        freeTranslations: [],
      };

      await flushHost(() => capturedReporterProps?.onReport(report));

      expect(jest.mocked(useStaleAnalysisDismissal)).toHaveBeenLastCalledWith(
        expect.objectContaining({ report }),
      );
    });

    it('shows the notice while stale analyses it has not been dismissed for remain', async () => {
      mockStaleAnalyses({ glossCount: 1 });

      await renderOnLoadedBook();

      expect(screen.getByTestId('stale-analyses-banner')).toBeInTheDocument();
    });

    it('shows no notice when none remain', async () => {
      await renderOnLoadedBook();

      expect(screen.queryByTestId('stale-analyses-banner')).not.toBeInTheDocument();
    });

    it('holds the notice back until the localized strings resolve', async () => {
      jest
        .mocked(useLocalizedStrings)
        .mockImplementation((keys: readonly string[]) => [
          Object.fromEntries(keys.map((k) => [k, k])),
          true,
        ]);
      mockStaleAnalyses({ glossCount: 1 });

      await renderOnLoadedBook();

      expect(screen.queryByTestId('stale-analyses-banner')).not.toBeInTheDocument();
    });

    it('holds the notice back during a cross-book swap', async () => {
      mockStaleAnalyses({ glossCount: 1 });

      await renderOnLoadedBook({ scrRef: { book: 'EXO', chapterNum: 1, verseNum: 1 } });

      expect(screen.queryByTestId('stale-analyses-banner')).not.toBeInTheDocument();
    });

    it('counts both kinds when the book has stale glosses and free translations', async () => {
      mockTemplate(
        '%interlinearizer_staleNotice_glossesAndFreeTranslations%',
        '{glossCount} and {freeTranslationCount}',
      );
      mockStaleAnalyses({
        glossCount: 3,
        freeTranslationCount: 1,
        freeTranslationSegmentIds: ['GEN 1:1'],
      });

      await renderOnLoadedBook();

      expect(screen.getByTestId('stale-analyses-banner')).toHaveTextContent('3 and 1');
    });

    it('counts only the glosses when the book has no stale free translation', async () => {
      mockTemplate('%interlinearizer_staleNotice_glosses%', '{count} glosses');
      mockStaleAnalyses({ glossCount: 2 });

      await renderOnLoadedBook();

      expect(screen.getByTestId('stale-analyses-banner')).toHaveTextContent('2 glosses');
    });

    it('counts only the free translations when the book has no stale gloss', async () => {
      mockTemplate('%interlinearizer_staleNotice_freeTranslations%', '{count} translations');
      mockStaleAnalyses({ freeTranslationCount: 2, freeTranslationSegmentIds: ['GEN 1:1'] });

      await renderOnLoadedBook();

      expect(screen.getByTestId('stale-analyses-banner')).toHaveTextContent('2 translations');
    });

    it('offers a review of the glosses when it reports some', async () => {
      mockStaleAnalyses({ glossCount: 1 });

      await renderOnLoadedBook();

      expect(screen.getByTestId('stale-review-glosses')).toBeInTheDocument();
    });

    it('offers no gloss review when it reports only free translations', async () => {
      mockStaleAnalyses({ freeTranslationCount: 1, freeTranslationSegmentIds: ['GEN 1:1'] });

      await renderOnLoadedBook();

      expect(screen.queryByTestId('stale-review-glosses')).not.toBeInTheDocument();
    });

    it('offers the next free translation when it reports some', async () => {
      mockStaleAnalyses({ freeTranslationCount: 1, freeTranslationSegmentIds: ['GEN 1:1'] });

      await renderOnLoadedBook();

      expect(screen.getByTestId('stale-next-free-translation')).toBeInTheDocument();
    });

    it('offers no free translation step when it reports only glosses', async () => {
      mockStaleAnalyses({ glossCount: 1 });

      await renderOnLoadedBook();

      expect(screen.queryByTestId('stale-next-free-translation')).not.toBeInTheDocument();
    });

    it('opens the catalog on the analyses stale in this book', async () => {
      await seedDraft({ ...emptyDraft(testProjectId), analysis: STALE_IN_TWO_BOOKS });
      mockStaleAnalyses({ glossCount: 1 });
      await renderOnLoadedBook();

      await userEvent.click(screen.getByTestId('stale-review-glosses'));

      expect(screen.getAllByTestId('catalog-row').map((row) => row.dataset.analysisId)).toEqual([
        'ta-gen',
      ]);
    });

    it('narrows a catalog already open to the analyses stale in this book', async () => {
      await seedDraft({ ...emptyDraft(testProjectId), analysis: STALE_IN_TWO_BOOKS });
      mockStaleAnalyses({ glossCount: 1 });
      await renderOnLoadedBook();
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      await userEvent.click(screen.getByTestId('stale-review-glosses'));

      expect(screen.getAllByTestId('catalog-row').map((row) => row.dataset.analysisId)).toEqual([
        'ta-gen',
      ]);
    });

    it('takes the reader to the next segment showing a stale free translation', async () => {
      mockStaleAnalyses({ freeTranslationCount: 1, freeTranslationSegmentIds: ['GEN 1:3'] });
      const setScrRef = await renderOnLoadedBook({ book: THREE_VERSE_BOOK });

      await userEvent.click(screen.getByTestId('stale-next-free-translation'));

      expect(setScrRef).toHaveBeenLastCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 3 });
    });

    it('asks to focus that segment', async () => {
      mountStoreProbe = true;
      mockStaleAnalyses({ freeTranslationCount: 1, freeTranslationSegmentIds: ['GEN 1:3'] });
      await renderOnLoadedBook({ book: THREE_VERSE_BOOK });

      await userEvent.click(screen.getByTestId('stale-next-free-translation'));

      expect(probeFocusRequest).toBe('GEN 1:3');
    });

    it('asks the segment list to recenter on that segment', async () => {
      mountStoreProbe = true;
      mockStaleAnalyses({ freeTranslationCount: 1, freeTranslationSegmentIds: ['GEN 1:3'] });
      await renderOnLoadedBook({ book: THREE_VERSE_BOOK });

      await userEvent.click(screen.getByTestId('stale-next-free-translation'));

      expect(probeRecenterRequest).toEqual({
        ref: { book: 'GEN', chapterNum: 1, verseNum: 3 },
        segmentId: 'GEN 1:3',
      });
    });

    it('withdraws a pending focus request for a segment with no word to focus', async () => {
      mockStaleAnalyses({
        freeTranslationCount: 2,
        freeTranslationSegmentIds: ['GEN 1:1', 'GEN 1:2'],
      });
      await renderWithHeldScrRef(THREE_VERSE_BOOK, 3);
      await userEvent.click(screen.getByTestId('stale-next-free-translation'));
      expect(probeFocusRequest).toBe('GEN 1:1');

      await userEvent.click(screen.getByTestId('stale-next-free-translation'));
      await flushHost();

      expect(probeFocusRequest).toBeUndefined();
    });

    describe('from a segment with no word to focus', () => {
      beforeEach(() => {
        mockStaleAnalyses({
          freeTranslationCount: 3,
          freeTranslationSegmentIds: ['GEN 1:1', 'GEN 1:2:9', 'GEN 1:3'],
        });
      });

      afterEach(() => {
        probePublishFocus = undefined;
      });

      /** Presses the notice's Next free translation button. */
      async function stepToNext(): Promise<void> {
        await userEvent.click(screen.getByTestId('stale-next-free-translation'));
      }

      it('moves on rather than landing there again', async () => {
        await renderWithHeldScrRef(RESUMED_PUNCTUATION_BOOK, 1);
        await stepToNext();
        expect(probeRecenterRequest?.segmentId).toBe('GEN 1:2:9');

        await stepToNext();

        expect(probeRecenterRequest?.segmentId).toBe('GEN 1:3');
      });

      it('moves on while the word focused before landing there stays focused', async () => {
        await renderWithHeldScrRef(RESUMED_PUNCTUATION_BOOK, 2);
        await flushHost(() => probePublishFocus?.('GEN 1:2:0'));
        await stepToNext();
        expect(probeRecenterRequest?.segmentId).toBe('GEN 1:2:9');

        await stepToNext();

        expect(probeRecenterRequest?.segmentId).toBe('GEN 1:3');
      });

      it('starts from a word the reader focuses after landing there', async () => {
        await renderWithHeldScrRef(RESUMED_PUNCTUATION_BOOK, 1);
        await stepToNext();
        await flushHost(() => probePublishFocus?.('GEN 1:3:0'));

        await stepToNext();

        expect(probeRecenterRequest?.segmentId).toBe('GEN 1:1');
      });

      it('starts from a verse the reader moves to after landing there', async () => {
        const moveToVerse = await renderWithHeldScrRef(RESUMED_PUNCTUATION_BOOK, 1);
        await stepToNext();
        moveToVerse(3);

        await stepToNext();

        expect(probeRecenterRequest?.segmentId).toBe('GEN 1:1');
      });
    });

    it('turns the free translation line on to show it', async () => {
      const onChangeByKey = mockOptimisticSetting(false);
      mockStaleAnalyses({ freeTranslationCount: 1, freeTranslationSegmentIds: ['GEN 1:3'] });
      await renderOnLoadedBook({ book: THREE_VERSE_BOOK });

      await userEvent.click(screen.getByTestId('stale-next-free-translation'));

      expect(onChangeByKey.get('interlinearizer.showFreeTranslation')).toHaveBeenCalledWith(true);
    });

    it('leaves a free translation line already on alone', async () => {
      const onChangeByKey = mockOptimisticSetting(true);
      mockStaleAnalyses({ freeTranslationCount: 1, freeTranslationSegmentIds: ['GEN 1:3'] });
      await renderOnLoadedBook({ book: THREE_VERSE_BOOK });

      await userEvent.click(screen.getByTestId('stale-next-free-translation'));
      await flushHost();

      expect(onChangeByKey.get('interlinearizer.showFreeTranslation')).not.toHaveBeenCalled();
    });

    it('dismisses through the hook when the notice close button is clicked', async () => {
      const onDismiss = mockStaleAnalyses({ glossCount: 1 });
      await renderOnLoadedBook();

      await userEvent.click(screen.getByTestId('stale-analyses-dismiss'));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('save command', () => {
    beforeEach(() => {
      mountStoreProbe = true;
    });

    afterEach(() => {
      mountStoreProbe = false;
    });

    it('has the host save the stored draft to the active project, sending no analysis', async () => {
      const draftAnalysis = emptyAnalysis();
      draftAnalysis.tokenAnalyses.push({
        ...FIXTURE_STAMPS,
        id: 't1',
        surfaceText: 'In',
        gloss: { en: 'in' },
      });
      await seedDraft({ ...emptyDraft(testProjectId), analysis: draftAnalysis });
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
      );

      mockSendCommand.mockClear();
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      // Nothing was pending, so the stored draft is already current: Save's first command is the
      // host copy, carrying only ids. The host marks the stored draft clean itself, so no draft
      // write follows.
      expect(
        mockSendCommand.mock.calls.filter(
          ([command]) => command !== 'interlinearizer.getFullAnalysis',
        ),
      ).toEqual([
        ['interlinearizer.saveDraftToProject', expect.any(String), testProjectId, 'proj-1'],
      ]);
    });

    it('refreshes the cached activeProject updatedAt from the saveDraftToProject response', async () => {
      // saveDraftToProject returns the persisted project's summary carrying the storage-refreshed updatedAt; every
      // other command keeps its default (the empty-draft load) so the editor still mounts.
      otherCommands.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.saveDraftToProject'
          ? JSON.stringify({ ...STUB_ACTIVE_PROJECT, updatedAt: '2026-02-02T00:00:00Z' })
          : JSON.stringify(emptyDraft(testProjectId)),
      );
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
      );
      await flushHost();
      // The stubbed active project starts with no Modified time cached.
      expect(screen.getByTestId('project-modals')).not.toHaveAttribute(
        'data-active-project-updated',
      );

      // Dirty the draft so the save that lands flips dirty back off, forcing the re-render that
      // reflects the newly cached updatedAt down to the ProjectModals stub.
      await flushHost(() => {
        probeWriteGloss?.('GEN 1:1:0', 'In', 'edited');
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      // The stub surfaces the cached activeProject's updatedAt, so the refreshed value proves the
      // fold reached WebView state.
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-02-02T00:00:00Z',
      );
    });

    it('leaves the cached activeProject untouched when the saveDraftToProject response is malformed', async () => {
      const seeded: MockProject = { ...STUB_ACTIVE_PROJECT, updatedAt: '2026-01-01T00:00:00Z' };
      // saveDraftToProject returns a payload with no `updatedAt` (e.g. an unexpected shape), so there is
      // nothing to fold in; other commands keep the default empty-draft load.
      otherCommands.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.saveDraftToProject'
          ? JSON.stringify({ notAProject: true })
          : JSON.stringify(emptyDraft(testProjectId)),
      );
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: seeded }) }),
      );

      await flushHost(() => {
        probeWriteGloss?.('GEN 1:1:0', 'In', 'edited');
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      // The previously cached Modified time is preserved rather than being cleared.
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-01-01T00:00:00Z',
      );
    });

    it('leaves the cache untouched and the draft dirty when saveDraftToProject reports the project is gone', async () => {
      const seeded: MockProject = { ...STUB_ACTIVE_PROJECT, updatedAt: '2026-01-01T00:00:00Z' };
      // saveDraftToProject resolves to `undefined` (the project no longer exists), so the loader has no
      // response body to parse and the cache is left as-is.
      otherCommands.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.saveDraftToProject'
          ? undefined
          : JSON.stringify(emptyDraft(testProjectId)),
      );
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader({ useWebViewState: makeWebViewState({ activeProject: seeded }) });
      });
      const updateWebViewDefinition = result?.updateWebViewDefinition;

      // Dirty the draft so the unsaved marker appears, then attempt the doomed Save.
      await flushHost(() => {
        probeWriteGloss?.('GEN 1:1:0', 'In', 'edited');
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer: WEB ●' });

      updateWebViewDefinition?.mockClear();
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-active-project-updated',
        '2026-01-01T00:00:00Z',
      );
      // Nothing was persisted, so the draft must stay dirty: the marker is never cleared.
      expect(updateWebViewDefinition).not.toHaveBeenCalledWith({ title: 'Interlinearizer: WEB' });
      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
        message: '%interlinearizer_error_save_project_missing%',
        severity: 'error',
      });
    });

    /**
     * Renders the loader on an active project and starts a Save whose copy the host holds until the
     * returned function lands it.
     */
    async function startHeldSave(): Promise<() => Promise<void>> {
      let finishSave!: (summary: string) => void;
      otherCommands.mockImplementation((...args) =>
        args[0] === 'interlinearizer.saveDraftToProject'
          ? new Promise<string>((resolve) => {
              finishSave = resolve;
            })
          : Promise.resolve(JSON.stringify(emptyDraft(testProjectId))),
      );
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
      );
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));
      return () => act(async () => finishSave(JSON.stringify(STUB_ACTIVE_PROJECT)));
    }

    it('shows the save running, and holds New, Save, Save As, and Discard Unsaved Changes while it does', async () => {
      await startHeldSave();

      expect(screen.getByTestId('saving-indicator')).toBeInTheDocument();
      await userEvent.click(screen.getByTestId('tab-toolbar-new-project'));
      await userEvent.click(screen.getByTestId('tab-toolbar-save-as'));
      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));
      await flushHost();

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(screen.queryByTestId('discard-changes-modal-panel')).not.toBeInTheDocument();
      // Each held command says why it did nothing; the save itself was sent once.
      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledTimes(4);
      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
        message: '%interlinearizer_info_save_in_progress%',
        severity: 'info',
      });
      expect(
        mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveDraftToProject'),
      ).toHaveLength(1);
    });

    it('holds Delete while a save runs', async () => {
      await startHeldSave();

      await userEvent.click(screen.getByTestId('tab-toolbar-delete-project'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'none');
      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith({
        message: '%interlinearizer_info_save_in_progress%',
        severity: 'info',
      });
    });

    it('shows no save running, and lets the held commands through, once the save ends', async () => {
      const finishSave = await startHeldSave();

      await finishSave();

      await waitFor(() => expect(screen.queryByTestId('saving-indicator')).not.toBeInTheDocument());
      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
      await flushHost();
      expect(screen.getByTestId('discard-changes-modal-panel')).toBeInTheDocument();
      expect(jest.mocked(papi.notifications.send)).not.toHaveBeenCalled();
    });

    it('marks the draft synced after a successful Save, clearing the tab unsaved marker', async () => {
      otherCommands.mockImplementation(async (...args) =>
        args[0] === 'interlinearizer.saveDraftToProject'
          ? answerSave(STUB_ACTIVE_PROJECT, args)
          : undefined,
      );
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader({
          useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }),
        });
      });
      const updateWebViewDefinition = result?.updateWebViewDefinition;

      // Dirty the draft via an edit so the marker appears, then Save.
      await flushHost(() => {
        probeWriteGloss?.('GEN 1:1:0', 'In', 'edited');
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer: WEB ●' });

      updateWebViewDefinition?.mockClear();
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      await waitFor(() =>
        expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer: WEB' }),
      );
    });

    it('shows the tab unsaved marker for in-progress typing before the gloss commits', async () => {
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader();
      });
      const updateWebViewDefinition = result?.updateWebViewDefinition;

      // A gloss input begins holding uncommitted text: the marker appears even though no gloss has
      // been written (the persisted draft is still clean).
      await flushHost(() => {
        capturedStoreProps?.onPendingEditsChange?.(true);
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer: WEB ●' });

      // The edit is reverted or the input unmounts with nothing committed: the marker clears.
      updateWebViewDefinition?.mockClear();
      await flushHost(() => {
        capturedStoreProps?.onPendingEditsChange?.(false);
      });
      expect(updateWebViewDefinition).toHaveBeenCalledWith({ title: 'Interlinearizer: WEB' });
    });

    it('reports in-progress typing to ProjectModals as unsaved work so a swap is guarded', async () => {
      await flushHost(async () => {
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
      await flushHost(() => {
        capturedStoreProps?.onPendingEditsChange?.(true);
      });
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-has-unsaved-work', 'true');
    });

    it('drops the unsaved-work guard once in-progress typing is abandoned', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await flushHost(() => {
        capturedStoreProps?.onPendingEditsChange?.(true);
      });
      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-has-unsaved-work', 'true');

      // The edit is reverted or the input unmounts with nothing committed: the guard clears.
      await flushHost(() => {
        capturedStoreProps?.onPendingEditsChange?.(false);
      });
      expect(screen.getByTestId('project-modals')).toHaveAttribute(
        'data-has-unsaved-work',
        'false',
      );
    });

    it('logs an error when the saveDraftToProject command rejects during Save', async () => {
      await act(async () =>
        renderLoader({ useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }) }),
      );

      const error = new Error('save failed');
      otherCommands.mockRejectedValueOnce(error);
      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
        'Interlinearizer: failed to save draft to project',
        error,
      );
    });

    it('opens the Save As modal when Save is clicked with no active project', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-save'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'saveAs');
      expect(screen.getByTestId('save-as-modal')).toBeInTheDocument();
      // Nothing was saved to a project since there is no Save target.
      expect(
        mockSendCommand.mock.calls.filter(([c]) => c === 'interlinearizer.saveDraftToProject'),
      ).toHaveLength(0);
    });

    it('opens the Save As modal when the openSaveAsModal menu item is clicked', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-save-as'));

      expect(screen.getByTestId('project-modals')).toHaveAttribute('data-modal', 'saveAs');
    });
  });

  describe('concordance command', () => {
    beforeEach(() => {
      jest.mocked(useSourceTextReader).mockReturnValue(makeSourceText({ status: 'ready' }));
    });

    it('opens the concordance beside the interlinear view', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      expect(screen.getByTestId('concordance-panel')).toBeInTheDocument();
      expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
    });

    it('switches the side panel to the catalog from the concordance', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      await userEvent.click(screen.getByTestId('side-panel-tab-catalog'));
      await flushHost();

      expect(screen.getByTestId('analysis-catalog-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('concordance-panel')).not.toBeInTheDocument();
    });

    it('switches the side panel to the concordance from the catalog', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      await userEvent.click(screen.getByTestId('side-panel-tab-concordance'));
      await flushHost();

      expect(screen.getByTestId('concordance-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('analysis-catalog-panel')).not.toBeInTheDocument();
    });

    it('asks before a menu switch to the concordance drops an unsaved catalog breakdown', async () => {
      const draftAnalysis = emptyAnalysis();
      draftAnalysis.tokenAnalyses.push({ ...FIXTURE_STAMPS, id: 't1', surfaceText: 'In' });
      await seedDraft({ ...emptyDraft(testProjectId), analysis: draftAnalysis });
      jest.mocked(useOptimisticBooleanSetting).mockImplementation((_projectId, key) => ({
        value: key === 'interlinearizer.showMorphology',
        onChange: jest.fn(),
        isLoading: false,
      }));
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      const row = screen.getByTestId('catalog-row');
      await userEvent.click(within(row).getByTestId('catalog-row-toggle'));
      await userEvent.click(within(row).getByTestId('catalog-row-breakdown-open'));
      await userEvent.type(within(row).getByTestId('morpheme-breakdown-input'), '-a');

      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      expect(screen.getByTestId('catalog-close-prompt')).toHaveTextContent(
        '%interlinearizer_analysisCatalog_discardForSwitchPrompt%',
      );
      expect(screen.queryByTestId('concordance-panel')).not.toBeInTheDocument();
    });

    it('closes the side panel from the concordance', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      await userEvent.click(screen.getByTestId('concordance-close'));
      await flushHost();

      expect(screen.queryByTestId('concordance-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('side-panel-resize')).not.toBeInTheDocument();
    });

    it('restores an open concordance from WebView state on remount', async () => {
      const useWebViewState = makeWebViewState();
      await flushHost(async () => {
        renderLoader({ useWebViewState });
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      cleanup();
      await flushHost(async () => {
        renderLoader({ useWebViewState });
      });

      expect(screen.getByTestId('concordance-panel')).toBeInTheDocument();
    });

    it('reads nothing for the concordance until it is first shown', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(useSourceTextReader).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false }),
      );
    });

    it('reads the text of this project, the loaded book live, once the concordance is shown', async () => {
      mockBookData();
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      expect(useSourceTextReader).toHaveBeenLastCalledWith(
        expect.objectContaining({
          projectId: testProjectId,
          liveBook: GEN_1_1_BOOK,
          enabled: true,
        }),
      );
    });

    it('builds the concordance as shown once it is shown', async () => {
      mockBookData({ writingSystem: 'hbo' });
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));
      await flushHost();

      expect(useConcordanceEntries).toHaveBeenLastCalledWith(
        expect.objectContaining({ shown: true, writingSystem: 'hbo' }),
      );
    });

    it('keeps the source text across a discard that replaces the draft', async () => {
      let readerMounts = 0;
      const text = makeSourceText({ status: 'ready' });
      jest.mocked(useSourceTextReader).mockImplementation(() => {
        // Held in state so a remount of whatever calls the hook shows up as a fresh count.
        useReactState(() => {
          readerMounts += 1;
          return readerMounts;
        });
        return text;
      });
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
      await userEvent.click(screen.getByTestId('discard-changes-confirm-all'));

      expect(editsSent()).toEqual(['interlinearizer.discardAll']);
      expect(readerMounts).toBe(1);
    });

    it('keeps reading the text once the side panel switches away from the concordance', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      await userEvent.click(screen.getByTestId('side-panel-tab-catalog'));
      await userEvent.click(screen.getByTestId('analysis-catalog-close'));

      expect(useSourceTextReader).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });

    it('marks the concordance hidden once the catalog takes the side panel', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));

      await userEvent.click(screen.getByTestId('side-panel-tab-catalog'));

      expect(useConcordanceEntries).toHaveBeenLastCalledWith(
        expect.objectContaining({ shown: false }),
      );
    });
  });

  describe('side panel strings', () => {
    let resolveStrings: () => Promise<void>;

    beforeEach(() => {
      jest.mocked(useSourceTextReader).mockReturnValue(makeSourceText({ status: 'ready' }));
      resolveStrings = mockLocalizedStringsResolvedOnDemand();
    });

    /** Puts one analysis in the draft, which the catalog needs before it shows its sort control. */
    async function mockDraftWithAnAnalysis(): Promise<void> {
      const draftAnalysis = emptyAnalysis();
      draftAnalysis.tokenAnalyses.push({ ...FIXTURE_STAMPS, id: 't1', surfaceText: 'In' });
      await seedDraft({ ...emptyDraft(testProjectId), analysis: draftAnalysis });
    }

    it('shows no raw keys when the side panel first opens after the loader strings resolve', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await resolveStrings();

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(rawKeysIn(screen.getByTestId('analysis-catalog-panel'))).toEqual([]);
    });

    it('shows no raw keys once the side panel switches from the catalog to the concordance', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      await resolveStrings();

      await userEvent.click(screen.getByTestId('side-panel-tab-concordance'));

      expect(rawKeysIn(screen.getByTestId('concordance-panel'))).toEqual([]);
    });

    it('shows no raw keys once the side panel switches from the concordance to the catalog', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));
      await resolveStrings();

      await userEvent.click(screen.getByTestId('side-panel-tab-catalog'));

      expect(rawKeysIn(screen.getByTestId('analysis-catalog-panel'))).toEqual([]);
    });

    it('names the book in the interface language as soon as the side panel switches', async () => {
      resolveStrings = mockLocalizedStringsResolvedOnDemand({
        '%LocalizedId.GEN%': 'Genèse',
        '%interlinearizer_analysisCatalog_sort_usageCountInBook%': 'Most used in {book}',
      });
      await mockDraftWithAnAnalysis();
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-concordance'));
      await resolveStrings();

      await userEvent.click(screen.getByTestId('side-panel-tab-catalog'));

      expect(screen.getByTestId('catalog-sort-usageCountInBook')).toHaveTextContent(
        'Most used in Genèse',
      );
    });

    it('names the book in English where the interface language has no name for it', async () => {
      resolveStrings = mockLocalizedStringsResolvedOnDemand({
        '%LocalizedId.GEN%': '%LocalizedId.GEN%',
        '%interlinearizer_analysisCatalog_sort_usageCountInBook%': 'Most used in {book}',
      });
      await mockDraftWithAnAnalysis();
      await flushHost(async () => {
        renderLoader();
      });
      await resolveStrings();

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(screen.getByTestId('catalog-sort-usageCountInBook')).toHaveTextContent(
        'Most used in Genesis',
      );
    });
  });

  describe('analysis catalog command', () => {
    it('opens the catalog panel beside the interlinear view', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(screen.getByTestId('analysis-catalog-panel')).toBeInTheDocument();
      // The panel sits beside the view rather than replacing it: jump-to-usage navigates the view
      // while the catalog stays open, which is impossible if opening unmounted it.
      expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();
    });

    it('keeps the catalog panel out of the wrapper the cross-book fade dims', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      await flushHost();

      expect(screen.getByTestId('book-fade-wrapper')).not.toContainElement(
        screen.getByTestId('analysis-catalog-panel'),
      );
    });

    it('closes the catalog panel from its own close control', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      await userEvent.click(screen.getByTestId('analysis-catalog-close'));
      await flushHost();

      expect(screen.queryByTestId('analysis-catalog-panel')).not.toBeInTheDocument();
    });

    it('restores an open catalog panel from WebView state on remount', async () => {
      const useWebViewState = makeWebViewState();
      await flushHost(async () => {
        renderLoader({ useWebViewState });
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      // A fresh render against the same state store stands in for the tab being restored.
      cleanup();
      await flushHost(async () => {
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
        await flushHost(async () => {
          renderLoader({ useWebViewState });
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        // A step lands somewhere the default is not, so a layout read back on remount can only be
        // a stored one.
        fireEvent.keyDown(screen.getByTestId('side-panel-resize'), { key: 'ArrowRight' });
        await flushHost();

        cleanup();
        await flushHost(async () => {
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
        await flushHost(async () => {
          renderLoader();
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        fireEvent.keyDown(screen.getByTestId('side-panel-resize'), { key: 'ArrowRight' });
        await flushHost();

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
        await flushHost(async () => {
          renderLoader({ useWebViewState });
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        fireEvent.keyDown(screen.getByTestId('side-panel-resize'), { key: 'ArrowRight' });
        await flushHost();

        await userEvent.click(screen.getByTestId('analysis-catalog-close'));
        cleanup();
        await flushHost(async () => {
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
      await flushHost(async () => {
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
        await flushHost(async () => {
          renderLoader();
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        fireEvent.keyDown(screen.getByTestId('side-panel-resize'), { key: 'ArrowRight' });
        await flushHost();

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
        await flushHost(async () => {
          renderLoader({ useWebViewState });
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

        fireEvent.keyDown(screen.getByTestId('side-panel-resize'), { key: 'Home' });
        await flushHost();

        // Read back on a remount, which lays the group out from what was stored, so the assertion
        // covers the stored layout rather than only the one on screen.
        cleanup();
        await flushHost(async () => {
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
      await flushHost(async () => {
        renderLoader();
      });
      const viewBeforeOpening = screen.getByTestId('interlinearizer');

      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));

      expect(screen.getByTestId('interlinearizer')).toBe(viewBeforeOpening);
    });

    it('keeps the interlinear view mounted as the catalog closes', async () => {
      await flushHost(async () => {
        renderLoader();
      });
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      const viewBeforeClosing = screen.getByTestId('interlinearizer');

      await userEvent.click(screen.getByTestId('analysis-catalog-close'));

      expect(screen.getByTestId('interlinearizer')).toBe(viewBeforeClosing);
    });

    it('leaves the catalog panel closed on remount when it was never opened', async () => {
      const useWebViewState = makeWebViewState();
      await flushHost(async () => {
        renderLoader({ useWebViewState });
      });

      cleanup();
      await flushHost(async () => {
        renderLoader({ useWebViewState });
      });

      expect(screen.queryByTestId('analysis-catalog-panel')).not.toBeInTheDocument();
    });
  });

  describe('discard changes command', () => {
    it('opens the discard dialog with the active-book flag set when a book is loaded', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));

      // The dialog must appear before anything is discarded, with the loaded book reflected.
      expect(screen.getByTestId('discard-changes-modal-panel')).toHaveAttribute(
        'data-has-active-book',
        'true',
      );
      expect(editsSent()).toEqual([]);
    });

    it('discards the current book through the session after confirming the book scope', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
      await userEvent.click(screen.getByTestId('discard-changes-confirm-book'));
      await flushHost();

      // Confirming a book discard sends the session the book to discard, and dismisses the dialog.
      expect(editsSent()).toEqual(['interlinearizer.discardBook']);
      expect(screen.queryByTestId('discard-changes-modal-panel')).not.toBeInTheDocument();
    });

    it('empties the whole draft after confirming the all scope with no active project', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
      await userEvent.click(screen.getByTestId('discard-changes-confirm-all'));
      await flushHost();

      expect(editsSent()).toEqual(['interlinearizer.discardAll']);
      expect(screen.queryByTestId('discard-changes-modal-panel')).not.toBeInTheDocument();
    });

    describe('with an active project', () => {
      /** Renders the loader with {@link STUB_ACTIVE_PROJECT} active and confirms `scope`. */
      async function discard(scope: 'book' | 'all'): Promise<void> {
        await flushHost(async () => {
          renderLoader({
            useWebViewState: makeWebViewState({ activeProject: STUB_ACTIVE_PROJECT }),
          });
        });
        await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
        await userEvent.click(screen.getByTestId(`discard-changes-confirm-${scope}`));
      }

      it('has the session restore the whole draft from the project', async () => {
        await discard('all');

        expect(editsSent()).toEqual(['interlinearizer.discardAll']);
      });

      it('has the session restore the current book from the project', async () => {
        await discard('book');

        expect(mockSendCommand).toHaveBeenCalledWith(
          'interlinearizer.discardBook',
          expect.objectContaining({ bookCode: 'GEN' }),
        );
      });

      it('keeps the dialog open and submitting while the discard runs', async () => {
        otherCommands.mockImplementation(async (...args) =>
          args[0] === 'interlinearizer.discardAll' ? new Promise(() => {}) : undefined,
        );

        await discard('all');

        expect(screen.getByTestId('discard-changes-modal-panel')).toHaveAttribute(
          'data-is-submitting',
          'true',
        );
      });

      it('dismisses the dialog once the discard is applied', async () => {
        await discard('all');

        await waitFor(() =>
          expect(screen.queryByTestId('discard-changes-modal-panel')).not.toBeInTheDocument(),
        );
      });

      it('logs a failed discard and dismisses the dialog', async () => {
        otherCommands.mockImplementation(async (...args) => {
          if (args[0] === 'interlinearizer.discardAll') throw new Error('storage offline');
          return undefined;
        });

        await discard('all');

        await waitFor(() =>
          expect(logger.error).toHaveBeenCalledWith(
            'Interlinearizer: failed to discard changes',
            expect.any(Error),
          ),
        );
        expect(screen.queryByTestId('discard-changes-modal-panel')).not.toBeInTheDocument();
      });
    });

    it('leaves the draft untouched when the discard dialog is canceled', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
      mockSendCommand.mockClear();
      await userEvent.click(screen.getByTestId('discard-changes-modal-cancel'));
      await flushHost();

      expect(screen.queryByTestId('discard-changes-modal-panel')).not.toBeInTheDocument();
      expect(editsSent()).toEqual([]);
    });
  });

  describe('tab unsaved-changes marker', () => {
    it('reports the plain tab title while the draft is clean', async () => {
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader();
      });

      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({
        title: 'Interlinearizer: WEB',
      });
      expect(result?.updateWebViewDefinition).not.toHaveBeenCalledWith({
        title: 'Interlinearizer: WEB ●',
      });
    });

    it('appends the unsaved marker to the tab title after an edit dirties the draft', async () => {
      mountStoreProbe = true;
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader();
      });

      await flushHost(() => probeWriteGloss?.('GEN 1:1:0', 'In', 'in'));
      mountStoreProbe = false;

      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({
        title: 'Interlinearizer: WEB ●',
      });
    });
  });

  describe('tab source project name', () => {
    it("titles the tab with the source project's short name", async () => {
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader();
      });

      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({
        title: 'Interlinearizer: WEB',
      });
    });

    it('falls back to the project id when the short name is empty', async () => {
      mockSourceShortName('');
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader();
      });

      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({
        title: `Interlinearizer: ${testProjectId}`,
      });
    });

    it('falls back to the project id when the short name setting reports an error', async () => {
      jest
        .mocked(useProjectSetting)
        .mockImplementation((_source, key, defaultState) => [
          key === 'platform.name'
            ? { message: 'Setting failed', platformErrorVersion: 1 }
            : defaultState,
          jest.fn(),
          jest.fn(),
          false,
        ]);
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader();
      });

      expect(result?.updateWebViewDefinition).toHaveBeenCalledWith({
        title: `Interlinearizer: ${testProjectId}`,
      });
    });

    it('leaves the title alone while the short name is loading', async () => {
      jest
        .mocked(useProjectSetting)
        .mockImplementation((_source, _key, defaultState) => [
          defaultState,
          jest.fn(),
          jest.fn(),
          true,
        ]);
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader();
      });

      expect(result?.updateWebViewDefinition).not.toHaveBeenCalled();
    });

    it('leaves the title alone while the title format is unresolved', async () => {
      mockKeyAsValueLocalizedStrings();
      let result: ReturnType<typeof renderLoader> | undefined;
      await flushHost(async () => {
        result = renderLoader();
      });

      expect(result?.updateWebViewDefinition).not.toHaveBeenCalled();
    });
  });

  describe('phrase mode plumbing', () => {
    it('forwards setPhraseMode through to Interlinearizer', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' });
      expect(typeof capturedInterlinearizerProps?.setPhraseMode).toBe('function');
    });

    it('updates the captured phraseMode when setPhraseMode is invoked', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      const originalTokens: PhraseAnalysisLink['tokens'] = [
        { tokenRef: 'tok-1', surfaceText: 'In' },
      ];
      await flushHost(() => {
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

    it('resets phraseMode to view when the draft is replaced (discard)', async () => {
      await flushHost(async () => {
        renderLoader();
      });

      // Enter edit mode.
      const originalTokens: PhraseAnalysisLink['tokens'] = [
        { tokenRef: 'tok-1', surfaceText: 'In' },
      ];
      await flushHost(() => {
        capturedInterlinearizerProps?.setPhraseMode({
          kind: 'edit',
          phraseId: 'phrase-1',
          originalTokens,
        });
      });
      expect(capturedInterlinearizerProps?.phraseMode.kind).toBe('edit');

      // Wiping the whole draft bumps draftVersion, which the loader watches to reset phraseMode.
      await userEvent.click(screen.getByTestId('tab-toolbar-discard-changes'));
      await userEvent.click(screen.getByTestId('discard-changes-confirm-all'));

      await waitFor(() =>
        expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' }),
      );
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
          webViewId={testWebViewId}
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
      await flushHost(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      // Initial GEN load shows no fade.
      expect(fadeOpacity()).toBe('1');

      // External jump to MAT: the context detects the book change and the curtain fades out.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      mockBookData({ book: undefined, isLoading: true });
      controls?.rerenderNow();
      await flushHost();
      expect(fadeOpacity()).toBe('0');
    });

    it('drops the curtain instantly (no transition) during the fade-out', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await flushHost(async () => {
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
      await flushHost();
      expect(fadeOpacity()).toBe('0');
      expect(wrapper().style.transitionDuration).toBe('0ms');
    });

    it('shows the Loading curtain (not the old book) during a cross-book swap', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await flushHost(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 5 });
      });
      expect(screen.getByTestId('interlinearizer')).toBeInTheDocument();

      // Cross-book jump to MAT while the loaded book is still GEN (before the USJ arrives and
      // Interlinearizer remounts). The loader shows the Loading curtain rather than the previous
      // book's views, so nothing of either book is visible until the new one mounts and fades in.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      controls?.rerenderNow();
      await flushHost();
      expect(screen.queryByTestId('interlinearizer')).not.toBeInTheDocument();
      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();

      // Once MAT's book data arrives, Interlinearizer mounts on it and receives the live MAT ref.
      mockBookData({ book: { ...GEN_1_1_BOOK, id: 'MAT', bookRef: 'MAT' } });
      controls?.rerenderNow();
      await flushHost();
      expect(capturedInterlinearizerProps?.scrRef).toEqual({
        book: 'MAT',
        chapterNum: 5,
        verseNum: 3,
      });
    });

    it('remounts Interlinearizer on a book change but not on a same-book verse change', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await flushHost(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      expect(interlinearizerMountCount).toBe(1);

      // A same-book verse change must keep the same Interlinearizer instance (no remount): its
      // scroll/focus state and in-component recenter fade carry the within-book navigation.
      controls?.setRef({ book: 'GEN', chapterNum: 1, verseNum: 40 });
      controls?.rerenderNow();
      await flushHost();
      expect(interlinearizerMountCount).toBe(1);

      // A book change must tear down the old instance and mount a fresh one keyed by the new book, so
      // it never updates in place against carried-over (wrong-book) scroll/focus state.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      mockBookData({ book: { ...GEN_1_1_BOOK, id: 'MAT', bookRef: 'MAT' } });
      controls?.rerenderNow();
      await flushHost();
      expect(interlinearizerMountCount).toBe(2);
    });

    it('reveals the error instead of staying faded when the new book fails to load', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await flushHost(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      expect(fadeOpacity()).toBe('1');

      // Cross-book nav whose target book errors: cancelFade must reveal the content rather than
      // leave the error hidden behind a curtain that will never receive a settle.
      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      mockBookData({ book: undefined, bookError: 'No text available' });
      controls?.rerenderNow();
      await flushHost();
      expect(fadeOpacity()).toBe('1');
      expect(screen.getByText('No text available')).toBeInTheDocument();
    });

    it('reveals the missing-book view instead of staying faded', async () => {
      mockProjectBookIds(['GEN']);
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await flushHost(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });

      controls?.setRef({ book: 'MAT', chapterNum: 5, verseNum: 3 });
      mockBookData({ book: undefined, isLoading: true });
      controls?.rerenderNow();
      await flushHost();
      expect(fadeOpacity()).toBe('1');
      expect(screen.getByTestId('book-not-in-project')).toBeInTheDocument();
    });

    it('does not fade for a same-book external navigation', async () => {
      let controls: ReturnType<typeof renderFadeLoader> | undefined;
      await flushHost(async () => {
        controls = renderFadeLoader({ book: 'GEN', chapterNum: 1, verseNum: 1 });
      });
      expect(fadeOpacity()).toBe('1');

      // A verse change within the same book keeps Interlinearizer mounted; the loader curtain stays
      // up (its own in-component fade handles within-book recenters).
      controls?.setRef({ book: 'GEN', chapterNum: 1, verseNum: 40 });
      controls?.rerenderNow();
      await flushHost();
      expect(fadeOpacity()).toBe('1');
    });
  });
});

/** Resets the loader's mocks and captures for a test that reads the store through the probe. */
function prepareStoreProbeTest(): void {
  mountStoreProbe = true;
  probeAnalysis = undefined;
  probeWriteGloss = undefined;
  probeCreatePhrase = undefined;
  probeFocusRequest = undefined;
  capturedInterlinearizerProps = undefined;
  capturedStoreProps = undefined;
  interlinearizerMountCount = 0;
  mockBookData();
  mockLexiconRegistry();
  mockOptimisticSetting();
  mockLostBoundaries([]);
  mockStaleAnalyses();
  mockProjectBookIds(undefined);
  mockUnreadSourceText();
  jest
    .mocked(useData)
    .mockReturnValue(
      new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
    );
  // Unresolved, as the platform leaves a string it has not localized: the key stands for itself.
  jest
    .mocked(useLocalizedStrings)
    .mockImplementation((keys: readonly string[]) => [
      Object.fromEntries(keys.map((k) => [k, k])),
      false,
    ]);
  mockSettings();
  mockSourceShortName('');
}

describe('undo and redo', () => {
  beforeEach(() => {
    prepareStoreProbeTest();
    mockBookData({ book: ALPHA_BETA_BOOK });
    jest.mocked(papi.notifications.send).mockResolvedValue('notification-id');
  });

  afterEach(() => {
    mountStoreProbe = false;
  });

  /** Renders the loader and glosses "Alpha" through the store. */
  async function renderAndGloss(): Promise<void> {
    await flushHost(async () => renderLoader());
    await flushHost(() => probeWriteGloss?.('GEN 1:1:0', 'Alpha', 'alpha'));
  }

  it('undoes the last edit on Ctrl+Z', async () => {
    await renderAndGloss();

    await flushHost(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(0);
  });

  it('redoes an undone edit on Ctrl+Y', async () => {
    await renderAndGloss();

    await flushHost(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });
    await flushHost(() => {
      fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    });

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(1);
  });

  it('leaves the draft alone on Ctrl+Z while a dialog is open over it', async () => {
    await renderAndGloss();
    render(<div data-slot="dialog-content" />);

    await flushHost(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(1);
  });

  it('leaves the draft alone on Ctrl+Z while an editor open over it blocks undo', async () => {
    await renderAndGloss();
    render(<div data-blocks-undo />);

    await flushHost(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(1);
  });

  describe('showing the edit', () => {
    /** Renders the loader on GEN 1:1 with a spy on the scroll group's reference setter. */
    async function renderWithScrRefSpy() {
      const setScrRef = jest.fn();
      await act(async () =>
        renderLoader({ useWebViewScrollGroupScrRef: makeScrollGroupHook(undefined, setScrRef) }),
      );
      return setScrRef;
    }

    it('takes the reader to the verse an undone edit was made in', async () => {
      const setScrRef = await renderWithScrRefSpy();
      await flushHost(() => probeWriteGloss?.('GEN 1:5:0', 'word', 'mot'));

      await flushHost(() => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(setScrRef).toHaveBeenLastCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 5 });
    });

    it('focuses the token an undone edit was made at', async () => {
      await renderWithScrRefSpy();
      await flushHost(() => probeWriteGloss?.('GEN 1:5:0', 'word', 'mot'));

      await flushHost(() => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(probeFocusRequest).toBe('GEN 1:5:0');
    });

    it('takes the reader to the verse a redone edit was made in', async () => {
      const setScrRef = await renderWithScrRefSpy();
      await flushHost(() => probeWriteGloss?.('GEN 1:5:0', 'word', 'mot'));
      await flushHost(() => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });
      setScrRef.mockClear();

      await flushHost(() => {
        fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
      });

      expect(setScrRef).toHaveBeenLastCalledWith({ book: 'GEN', chapterNum: 1, verseNum: 5 });
    });
  });

  describe('phrase editing', () => {
    const ALPHA_BETA: TokenSnapshot[] = [
      { tokenRef: 'GEN 1:1:0', surfaceText: 'Alpha' },
      { tokenRef: 'GEN 1:1:6', surfaceText: 'beta' },
    ];

    /** Puts the view into editing the phrase `phraseId`. */
    function editPhrase(phraseId: string): void {
      act(() =>
        capturedInterlinearizerProps?.setPhraseMode({
          kind: 'edit',
          phraseId,
          originalTokens: ALPHA_BETA,
        }),
      );
    }

    it('stops editing a phrase an undo removes', async () => {
      await flushHost(async () => renderLoader());
      await flushHost(() => probeCreatePhrase?.(ALPHA_BETA));
      const phraseId = probeAnalysis?.phraseAnalysisLinks[0]?.id ?? '';
      editPhrase(phraseId);

      await flushHost(() => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(capturedInterlinearizerProps?.phraseMode).toEqual({ kind: 'view' });
    });

    it('keeps editing a phrase the undo leaves in place', async () => {
      await flushHost(async () => renderLoader());
      await flushHost(() => probeCreatePhrase?.(ALPHA_BETA));
      const phraseId = probeAnalysis?.phraseAnalysisLinks[0]?.id ?? '';
      await flushHost(() => probeWriteGloss?.('GEN 1:1:0', 'Alpha', 'alpha'));
      editPhrase(phraseId);

      await flushHost(() => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(capturedInterlinearizerProps?.phraseMode.kind).toBe('edit');
    });
  });

  describe('announcing a step with no one place', () => {
    /** Renders the loader, glosses a word, and discards the whole draft. */
    async function renderAndDiscard(): Promise<void> {
      await renderAndGloss();
      await act(async () => {
        screen.getByTestId('tab-toolbar-discard-changes').click();
      });
      await flushHost(() => screen.getByTestId('discard-changes-confirm-all').click());
    }

    it('announces an undone discard', async () => {
      await renderAndDiscard();

      await flushHost(async () => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
        expect.objectContaining({ message: '%interlinearizer_undone_discardAll%' }),
      );
    });

    it('announces a redone discard', async () => {
      await renderAndDiscard();
      await flushHost(() => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      await flushHost(async () => {
        fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
      });

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
        expect.objectContaining({ message: '%interlinearizer_redone_discardAll%' }),
      );
    });

    describe('naming the book of an undone book discard', () => {
      /** Renders the loader, glosses a word in GEN, discards GEN, and undoes the discard. */
      async function discardBookAndUndo(): Promise<void> {
        jest.mocked(useLocalizedStrings).mockImplementation((keys: readonly string[]) => [
          Object.fromEntries(
            keys.map((k) => [
              k,
              {
                '%interlinearizer_undone_discardBook%': 'Undid wiping {book}.',
                '%interlinearizer_redone_discardBook%': 'Redid wiping {book}.',
              }[k] ?? k,
            ]),
          ),
          false,
        ]);
        await renderAndGloss();
        await act(async () => {
          screen.getByTestId('tab-toolbar-discard-changes').click();
        });
        await flushHost(() => screen.getByTestId('discard-changes-confirm-book').click());
        await flushHost(() => {
          fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        });
      }

      it('names the book in the interface language', async () => {
        jest
          .mocked(papi.localization.getLocalizedString)
          .mockImplementation(async ({ localizeKey }) =>
            localizeKey === '%LocalizedId.GEN%' ? 'Mwanzo' : localizeKey,
          );

        await discardBookAndUndo();

        expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'Undid wiping Mwanzo.' }),
        );
      });

      it('names the book in English when the interface language has no name for it', async () => {
        jest
          .mocked(papi.localization.getLocalizedString)
          .mockImplementation(async ({ localizeKey }) => localizeKey);

        await discardBookAndUndo();

        expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'Undid wiping Genesis.' }),
        );
      });

      it('names the book in English when its name in the interface language never arrives', async () => {
        jest.useFakeTimers();
        try {
          jest
            .mocked(papi.localization.getLocalizedString)
            .mockImplementation(() => new Promise(() => {}));
          await discardBookAndUndo();

          await flushHost(async () => {
            jest.advanceTimersByTime(BOOK_NAME_TIMEOUT_MS);
          });

          expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Undid wiping Genesis.' }),
          );
        } finally {
          jest.useRealTimers();
        }
      });

      it('announces a redo after the undo whose book name was still resolving', async () => {
        let resolveUndoneName: (name: string) => void = () => {};
        jest
          .mocked(papi.localization.getLocalizedString)
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolveUndoneName = resolve;
              }),
          )
          .mockResolvedValue('Mwanzo');

        await discardBookAndUndo();
        await flushHost(async () => {
          fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
        });
        await flushHost(async () => {
          resolveUndoneName('Mwanzo');
        });

        const messages = jest
          .mocked(papi.notifications.send)
          .mock.calls.map(([options]) => options.message);
        expect(messages.filter((m) => m.includes('wiping'))).toEqual([
          'Undid wiping Mwanzo.',
          'Redid wiping Mwanzo.',
        ]);
      });
    });

    it('announces an undone catalog edit', async () => {
      await seedDraft({
        ...emptyDraft(testProjectId),
        analysis: analysisApprovingAt('GEN 1:1:0', 'Alpha'),
      });
      await flushHost(async () => renderLoader());
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      await userEvent.click(screen.getByTestId('catalog-row-toggle'));
      await userEvent.type(screen.getByTestId('catalog-row-gloss-input'), 'alpha');
      await userEvent.tab();

      await flushHost(async () => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
        expect.objectContaining({ message: '%interlinearizer_undone_catalogEdit%' }),
      );
    });

    it('announces an undone deletion of one checked catalog row as the deletion of its analysis', async () => {
      // The deletion raises an undo notification, which the undo takes down.
      jest.mocked(papi.notifications.dismiss).mockResolvedValue(undefined);
      await seedDraft({
        ...emptyDraft(testProjectId),
        analysis: analysisApprovingAt('GEN 1:1:0', 'Alpha'),
      });
      await flushHost(async () => renderLoader());
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      await userEvent.click(screen.getByTestId('catalog-row-check'));
      await userEvent.click(screen.getByTestId('catalog-selection-delete'));

      await flushHost(async () => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
        expect.objectContaining({ message: '%interlinearizer_undone_catalogDelete%' }),
      );
    });

    it('announces an undone gloss clear across checked catalog rows', async () => {
      // Clearing this gloss-only analysis deletes it, which raises an undo notification the undo
      // takes down.
      jest.mocked(papi.notifications.dismiss).mockResolvedValue(undefined);
      const analysis = analysisApprovingAt('GEN 1:1:0', 'Alpha');
      await seedDraft({
        ...emptyDraft(testProjectId),
        analysisLanguages: ['en'],
        analysis: {
          ...analysis,
          tokenAnalyses: analysis.tokenAnalyses.map((ta) => ({ ...ta, gloss: { en: 'first' } })),
        },
      });
      await flushHost(async () => renderLoader());
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      await userEvent.click(screen.getByTestId('catalog-row-check'));
      await userEvent.click(screen.getByTestId('catalog-selection-clear-gloss'));

      await flushHost(async () => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
        expect.objectContaining({ message: '%interlinearizer_undone_catalogClearGlossChecked%' }),
      );
    });

    it('scrolls the open catalog to the row an undone catalog edit acted on', async () => {
      const scrollIntoView = jest.fn();
      // jsdom implements no scrollIntoView for the row to call.
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      });
      try {
        await seedDraft({
          ...emptyDraft(testProjectId),
          analysis: analysisApprovingAt('GEN 1:1:0', 'Alpha'),
        });
        await flushHost(async () => renderLoader());
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
        await userEvent.click(screen.getByTestId('catalog-row-toggle'));
        await userEvent.type(screen.getByTestId('catalog-row-gloss-input'), 'alpha');
        await userEvent.tab();

        await flushHost(() => {
          fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        });

        expect(scrollIntoView.mock.contexts).toContain(screen.getByTestId('catalog-row'));
      } finally {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    });

    it('scrolls the open catalog to the row a redone catalog edit collapsed onto', async () => {
      const scrollIntoView = jest.fn();
      // jsdom implements no scrollIntoView for the row to call.
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      });
      const approvedAt = (analysisId: string, tokenRef: string) => ({
        id: `tl-${analysisId}`,
        ...FIXTURE_STAMPS,
        analysisId,
        status: 'approved' as const,
        token: { tokenRef, surfaceText: 'Alpha' },
      });
      const rowFor = (analysisId: string) =>
        screen.getAllByTestId('catalog-row').find((row) => row.dataset.analysisId === analysisId);
      try {
        await seedDraft({
          ...emptyDraft(testProjectId),
          analysisLanguages: ['en'],
          analysis: {
            ...emptyAnalysis(),
            tokenAnalyses: [
              { ...FIXTURE_STAMPS, id: 'ta-1', surfaceText: 'Alpha', gloss: { en: 'first' } },
              { ...FIXTURE_STAMPS, id: 'ta-2', surfaceText: 'Alpha', gloss: { en: 'second' } },
            ],
            tokenAnalysisLinks: [approvedAt('ta-1', 'GEN 1:1:0'), approvedAt('ta-2', 'GEN 2:1:0')],
          },
        });
        await flushHost(async () => renderLoader());
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
        const edited = rowFor('ta-1');
        if (!edited) throw new Error('no catalog row for ta-1');
        await userEvent.click(within(edited).getByTestId('catalog-row-toggle'));
        const input = within(edited).getByTestId('catalog-row-gloss-input');
        await userEvent.clear(input);
        await userEvent.type(input, 'second');
        await userEvent.tab();
        await flushHost(() => {
          fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        });
        scrollIntoView.mockClear();

        await flushHost(() => {
          fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
        });

        expect(scrollIntoView.mock.contexts).toContain(rowFor('ta-2'));
      } finally {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    });

    it('scrolls the open catalog to no row on redoing a deletion', async () => {
      jest.mocked(papi.notifications.dismiss).mockResolvedValue(undefined);
      const scrollIntoView = jest.fn();
      // jsdom implements no scrollIntoView for the row to call.
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      });
      try {
        await seedDraft({
          ...emptyDraft(testProjectId),
          analysis: analysisApprovingAt('GEN 1:1:0', 'Alpha'),
        });
        await flushHost(async () => renderLoader());
        await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
        await userEvent.click(screen.getByTestId('catalog-row-toggle'));
        await userEvent.click(screen.getByTestId('catalog-row-delete'));
        await userEvent.click(screen.getByTestId('catalog-delete-confirm'));
        await flushHost(() => {
          fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
        });
        scrollIntoView.mockClear();

        await flushHost(() => {
          fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
        });

        expect(scrollIntoView).not.toHaveBeenCalled();
      } finally {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    });

    it('announces nothing for a step it can show in place', async () => {
      await renderAndGloss();

      await flushHost(() => {
        fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      });

      expect(jest.mocked(papi.notifications.send)).not.toHaveBeenCalled();
    });
  });

  describe('undoing from a deletion notification', () => {
    /** Stands in for the network event the platform relays a notification's Undo click on. */
    const UNDO_EVENT = () => () => true;

    beforeEach(async () => {
      jest
        .mocked(papi.network.getNetworkEvent)
        .mockImplementation((name: string) =>
          name === 'interlinearizer.onUndoFromNotification' ? UNDO_EVENT : ANALYSIS_CHANGED_EVENT,
        );
      jest.mocked(papi.notifications.send).mockResolvedValue('toast-1');
      jest.mocked(papi.notifications.dismiss).mockResolvedValue(undefined);
      await seedDraft({
        ...emptyDraft(testProjectId),
        analysis: analysisApprovingAt('GEN 1:1:0', 'Alpha'),
      });
    });

    /** Renders the loader and deletes the draft's one analysis from the catalog. */
    async function renderAndDelete() {
      const view = await act(async () => renderLoader());
      await userEvent.click(screen.getByTestId('tab-toolbar-analysis-catalog'));
      await userEvent.click(screen.getByTestId('catalog-row-toggle'));
      await userEvent.click(screen.getByTestId('catalog-row-delete'));
      await userEvent.click(screen.getByTestId('catalog-delete-confirm'));
      return view;
    }

    /** Clicks Undo on the notification `notificationId`, as the platform relays the click. */
    function clickNotificationUndo(notificationId: string): void {
      const handler = [...jest.mocked(useEvent).mock.calls]
        .reverse()
        .find(([event]) => event === UNDO_EVENT)?.[1];
      if (typeof handler !== 'function') throw new Error('nothing listens for the undo event');
      act(() => handler({ notificationId }));
    }

    it('offers to undo a deletion in its notification', async () => {
      await renderAndDelete();

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
        expect.objectContaining({
          clickCommand: 'interlinearizer.undoFromNotification',
          clickCommandLabel: '%interlinearizer_undo%',
        }),
      );
    });

    it('keeps the notification up for as long as it offers', async () => {
      await renderAndDelete();

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
        expect.objectContaining({ duration: UNDO_NOTIFICATION_DURATION_MS }),
      );
    });

    it("undoes the deletion when its notification's Undo is clicked", async () => {
      await renderAndDelete();

      clickNotificationUndo('toast-1');

      await flushHost();

      expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(1);
    });

    it('offers the undo again when a dialog open over the draft blocks it', async () => {
      await renderAndDelete();
      render(<div data-slot="dialog-content" />);
      jest.mocked(papi.notifications.send).mockClear();

      clickNotificationUndo('toast-1');

      await flushHost();

      expect(jest.mocked(papi.notifications.send)).toHaveBeenCalledWith(
        expect.objectContaining({ clickCommand: 'interlinearizer.undoFromNotification' }),
      );
    });

    it('ignores an Undo click on a notification it did not send', async () => {
      await renderAndDelete();

      clickNotificationUndo('toast-2');

      await flushHost();

      expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(0);
    });

    it('takes the notification down once a later step is made', async () => {
      await renderAndDelete();

      await flushHost(() => probeWriteGloss?.('GEN 1:1:6', 'beta', 'bêta'));

      expect(jest.mocked(papi.notifications.dismiss)).toHaveBeenCalledWith('toast-1');
    });

    it('undoes nothing from a notification a later step took down', async () => {
      await renderAndDelete();
      await flushHost(() => probeWriteGloss?.('GEN 1:1:6', 'beta', 'bêta'));

      clickNotificationUndo('toast-1');

      await flushHost();

      expect(probeAnalysis?.tokenAnalysisLinks.map((l) => l.token.tokenRef)).toEqual(['GEN 1:1:6']);
    });

    it('takes down a notification a step superseded while it was on its way', async () => {
      let deliver: (id: string) => void = () => {};
      jest.mocked(papi.notifications.send).mockReturnValue(
        new Promise((resolve) => {
          deliver = resolve;
        }),
      );
      await renderAndDelete();
      await flushHost(() => probeWriteGloss?.('GEN 1:1:6', 'beta', 'bêta'));

      await flushHost(async () => deliver('toast-1'));

      expect(jest.mocked(papi.notifications.dismiss)).toHaveBeenCalledWith('toast-1');
    });

    it('takes the notification down when the view closes', async () => {
      const { unmount } = await renderAndDelete();

      unmount();

      expect(jest.mocked(papi.notifications.dismiss)).toHaveBeenCalledWith('toast-1');
    });

    it('takes down a notification that arrives after the view closed', async () => {
      let deliver: (id: string) => void = () => {};
      jest.mocked(papi.notifications.send).mockReturnValue(
        new Promise((resolve) => {
          deliver = resolve;
        }),
      );
      const { unmount } = await renderAndDelete();
      unmount();

      await flushHost(async () => deliver('toast-1'));

      expect(jest.mocked(papi.notifications.dismiss)).toHaveBeenCalledWith('toast-1');
    });

    it('undoes the latest deletion when an older notification arrives after it', async () => {
      const deliveries: ((id: string) => void)[] = [];
      jest.mocked(papi.notifications.send).mockImplementation(
        () =>
          new Promise((resolve) => {
            deliveries.push(resolve);
          }),
      );
      await renderAndDelete();
      await flushHost(() => screen.getByTestId('tab-toolbar-undo').click());
      await userEvent.click(screen.getByTestId('catalog-row-toggle'));
      await userEvent.click(screen.getByTestId('catalog-row-delete'));
      await userEvent.click(screen.getByTestId('catalog-delete-confirm'));

      await flushHost(async () => deliveries.at(-1)?.('toast-2'));
      await flushHost(async () => deliveries[0]('toast-1'));
      clickNotificationUndo('toast-2');
      await flushHost();

      expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(1);
    });
  });

  it('brings discarded glosses back on Ctrl+Z', async () => {
    await renderAndGloss();
    await flushHost(async () => {
      screen.getByTestId('tab-toolbar-discard-changes').click();
    });
    await flushHost(() => screen.getByTestId('discard-changes-confirm-all').click());

    await flushHost(() => {
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    });

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(1);
  });

  it('undoes from the Edit menu', async () => {
    await renderAndGloss();

    await flushHost(() => screen.getByTestId('tab-toolbar-undo').click());

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(0);
  });

  it('redoes from the Edit menu', async () => {
    await renderAndGloss();

    await flushHost(() => screen.getByTestId('tab-toolbar-undo').click());
    await flushHost(() => screen.getByTestId('tab-toolbar-redo').click());

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(1);
  });

  it("undoes from the toolbar's undo button", async () => {
    await renderAndGloss();

    await flushHost(() => screen.getByRole('button', { name: '%undoButton_tooltip%' }).click());

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(0);
  });

  it("redoes from the toolbar's redo button", async () => {
    await renderAndGloss();

    await flushHost(() => screen.getByRole('button', { name: '%undoButton_tooltip%' }).click());
    await flushHost(() => screen.getByRole('button', { name: '%redoButton_tooltip%' }).click());

    expect(probeAnalysis?.tokenAnalysisLinks).toHaveLength(1);
  });

  it('disables the toolbar buttons while there is nothing to undo or redo', async () => {
    await flushHost(async () => renderLoader());

    expect(screen.getByRole('button', { name: '%undoButton_tooltip%' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '%redoButton_tooltip%' })).toBeDisabled();
  });

  // The toolbar lays its end area out in reverse, so the pair must reach it as one child to keep
  // its own order.
  it('hands the toolbar the undo buttons and view options as one row, undo first', async () => {
    await flushHost(async () => renderLoader());

    const undoButton = screen.getByRole('button', { name: '%undoButton_tooltip%' });
    const viewOptions = screen.getByTestId('view-options-dropdown');
    const row = undoButton.parentElement;
    expect(row).toBe(viewOptions.parentElement);
    expect(row).not.toBe(screen.getByTestId('tab-toolbar-end'));
    const order = [...(row?.children ?? [])];
    expect(order.indexOf(undoButton)).toBeLessThan(order.indexOf(viewOptions));
  });

  it('enables the toolbar undo button once there is an edit to undo', async () => {
    await renderAndGloss();

    expect(screen.getByRole('button', { name: '%undoButton_tooltip%' })).toBeEnabled();
  });
});

describe('analysis language switch', () => {
  beforeEach(() => {
    capturedStoreProps = undefined;
    mockBookData();
    mockLexiconRegistry();
    mockOptimisticSetting();
    mockLostBoundaries([]);
    mockStaleAnalyses();
    mockProjectBookIds(undefined);
    jest
      .mocked(useData)
      .mockReturnValue(
        new Proxy({}, { get: () => jest.fn().mockReturnValue([undefined, jest.fn(), false]) }),
      );
    mockKeyAsValueLocalizedStrings();
    mockSettings();
    mockSourceShortName('');
  });

  afterEach(() => {
    mountStoreProbe = false;
  });

  const IMPORT_LISTING_TWO = { ...STUB_IMPORT_PROJECT, analysisLanguages: ['swh', 'en'] };

  /** Stores a draft listing `languages`, and serves {@link IMPORT_LISTING_TWO} for any import. */
  async function mockDraftLanguages(languages: string[]): Promise<void> {
    otherCommands.mockImplementation(async (...args) =>
      args[0] === 'interlinearizer.getProject'
        ? JSON.stringify({ ...IMPORT_LISTING_TWO, analysis: emptyAnalysis() })
        : undefined,
    );
    await seedDraft({ ...emptyDraft(testProjectId), analysisLanguages: languages });
  }

  it('reads glosses in the picked language', async () => {
    await mockDraftLanguages(['en', 'fr']);
    await flushHost(async () => renderLoader());

    await flushHost(async () => {
      fireEvent.click(screen.getByTestId('analysis-language-fr'));
    });

    expect(capturedStoreProps?.analysisLanguage).toBe('fr');
  });

  it('switches language without remounting the view', async () => {
    // A remount would discard uncommitted gloss edits and the catalog's scroll position.
    await mockDraftLanguages(['en', 'fr']);
    await flushHost(async () => renderLoader());
    const mountsBefore = interlinearizerMountCount;

    await flushHost(async () => {
      fireEvent.click(screen.getByTestId('analysis-language-fr'));
    });

    expect(interlinearizerMountCount).toBe(mountsBefore);
  });

  it('restores the language chosen earlier in the tab', async () => {
    await mockDraftLanguages(['en', 'fr']);
    await act(async () =>
      renderLoader({
        useWebViewState: makeWebViewState({ analysisLanguageChoices: { draft: 'fr' } }),
      }),
    );

    expect(capturedStoreProps?.analysisLanguage).toBe('fr');
  });

  it('falls back to the first language when the chosen one is no longer listed', async () => {
    await mockDraftLanguages(['en', 'fr']);
    await act(async () =>
      renderLoader({
        useWebViewState: makeWebViewState({ analysisLanguageChoices: { draft: 'de' } }),
      }),
    );

    expect(capturedStoreProps?.analysisLanguage).toBe('en');
  });

  it("keeps an import's language apart from the draft's", async () => {
    await mockDraftLanguages(['en', 'fr']);
    await act(async () =>
      renderLoader({
        useWebViewState: makeWebViewState({
          activeProject: IMPORT_LISTING_TWO,
          analysisLanguageChoices: { draft: 'en' },
        }),
      }),
    );

    await waitFor(() => expect(capturedStoreProps?.analysisLanguage).toBe('swh'));
  });

  it('switches the language of a read-only import', async () => {
    await mockDraftLanguages(['en']);
    await act(async () =>
      renderLoader({ useWebViewState: makeWebViewState({ activeProject: IMPORT_LISTING_TWO }) }),
    );

    await flushHost(async () => {
      fireEvent.click(await screen.findByTestId('analysis-language-en'));
    });

    expect(capturedStoreProps?.analysisLanguage).toBe('en');
  });
});
