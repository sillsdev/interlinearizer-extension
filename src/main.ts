import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  ExecutionToken,
  IWebViewProvider,
  OpenWebViewOptions,
  SavedWebViewDefinition,
  WebViewDefinition,
} from '@papi/core';
import type {
  DraftProject,
  DraftStart,
  InterlinearProject,
  ProjectConfig,
  SegmentationDelta,
} from 'interlinearizer';
import type { CommandHandlers, NetworkEvents } from 'papi-shared-types';
import {
  formatReplacementString,
  type LocalizeKey,
  type PlatformEventEmitter,
} from 'platform-bible-utils';
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
import { AnalysisSessions, type OpenedSession, type Session } from './services/analysisSessions';
import * as bookService from './services/bookService';
import { startCSharpHost } from './services/csharpHost';
import {
  readHostPerf,
  sessionReadsAreSkipped,
  setHostPerfMarks,
  setSessionReadsSkipped,
} from './services/hostPerf';
import * as projectStorage from './services/projectStorage';
import * as pt9ImportService from './services/pt9ImportService';
import type { Pt9ImportResult } from './services/pt9ImportService';
import { sessionCatalogHandlers } from './services/sessionCatalogHandlers';
import { sessionConcordanceHandlers } from './services/sessionConcordanceHandlers';
import { sessionEditHandlers } from './services/sessionEditHandlers';
import {
  readBookOutline,
  readDraftEnvelope,
  readSegmentPage,
  readStaleSummary,
} from './services/sessionPages';
import { UnreadableBooksError } from './types/analysis-repository';
import { emptyAnalysis } from './types/empty-factories';
import {
  toProjectSummary,
  type InterlinearProjectSummary,
  type SavedAsProject,
} from './types/interlinear-project-summary';
import { CURRENT_MODEL_VERSION } from './types/model-version';
import type { TextReadStatus } from './types/text-read-status';
import { isDraftProject, isInterlinearProjectSummary } from './types/type-guards';
import { commandDocs, extensionCommands, type ExtensionCommand } from './commandDocs';
import { BOOKLESS_PARTITION } from './utils/analysis-book';
import { isEmptyDraft } from './utils/empty-draft';
import type { InterlinearizerWebViewState } from './types/webview-state';
import { perfTime, perfTimeAsync } from './utils/perf-marks';

// #region WebView provider

/**
 * WebView type identifier for the Interlinearizer. Used when registering the provider and when
 * opening the WebView from the platform.
 */
const mainWebViewType = 'interlinearizer.mainWebView';

/** Options passed to `papi.webViews.openWebView` when opening the Interlinearizer. */
export interface InterlinearizerOpenOptions
  extends OpenWebViewOptions, Partial<InterlinearizerWebViewState> {
  /** Paratext project ID to load in the Interlinearizer WebView. */
  projectId?: string;
}

/** Tab title used when there is no project to name. */
const baseTabTitle = 'Interlinearizer';

/**
 * The tab that holds each project: the first one served while no other tab holds it. Opening the
 * project again brings the holder to front. A second tab that a layout restores shows only a notice
 * that points at the holder, until the holder closes and the second tab takes the project over.
 */
const openWebViewsByProject = new Map<string, string>();

/** The duplicate tabs of each project, which show only the notice until their holder closes. */
const duplicateWebViewsByProject = new Map<string, Set<string>>();

/** WebView provider that provides the Interlinearizer React WebView when Platform.Bible requests it. */
const mainWebViewProvider: IWebViewProvider = {
  /**
   * Returns the Interlinearizer WebView definition (React component + styles) for the given saved
   * definition. Rejects if the requested webViewType does not match this provider's type.
   *
   * @param savedWebView - Platform-provided definition (webViewType, etc.).
   * @param openWebViewOptions - Options passed by the caller; may include a projectId to link.
   * @throws {TypeError} When savedWebView.webViewType is not the Interlinearizer type.
   */
  async getWebView(
    savedWebView: SavedWebViewDefinition,
    openWebViewOptions?: InterlinearizerOpenOptions,
  ): Promise<WebViewDefinition | undefined> {
    if (savedWebView.webViewType !== mainWebViewType) {
      throw new TypeError(
        `${mainWebViewType} provider received request to provide a ${savedWebView.webViewType} WebView`,
      );
    }
    const projectId = openWebViewOptions?.projectId ?? savedWebView.projectId;
    // A duplicate is served inert because the platform offers no way to close a tab.
    const holder = projectId === undefined ? undefined : openWebViewsByProject.get(projectId);
    const duplicateOf = holder !== undefined && holder !== savedWebView.id ? holder : undefined;
    if (projectId !== undefined && duplicateOf === undefined) {
      openWebViewsByProject.set(projectId, savedWebView.id);
      duplicateWebViewsByProject.get(projectId)?.delete(savedWebView.id);
    }
    if (projectId !== undefined && duplicateOf !== undefined) {
      const duplicates = duplicateWebViewsByProject.get(projectId) ?? new Set<string>();
      duplicateWebViewsByProject.set(projectId, duplicates.add(savedWebView.id));
    }
    const state: Record<string, unknown> = { ...savedWebView.state };
    delete state.duplicateOf;
    return {
      ...savedWebView,
      projectId,
      state: {
        ...state,
        // Seeded state rides the options only on an explicit open; a tab restore passes no options
        // and keeps whatever the WebView last stored.
        ...(openWebViewOptions?.offerPt9Import !== undefined && {
          offerPt9Import: openWebViewOptions.offerPt9Import,
        }),
        ...(openWebViewOptions?.activeProject !== undefined && {
          activeProject: openWebViewOptions.activeProject,
        }),
        ...(duplicateOf !== undefined && { duplicateOf }),
      },
      title: projectId
        ? await papi.localization.getLocalizedProjectTitle({
            localizeKey: '%interlinearizer_tabTitle%',
            projectId,
          })
        : baseTabTitle,
      content: interlinearizerReact,
      styles: interlinearizerStyles,
    };
  },
};

// #endregion

// #region Module state

/**
 * Execution token stored during activation for use in command handlers that call `papi.storage`.
 * Set in `activate()` before any command can be invoked.
 */
let executionToken: ExecutionToken;

/**
 * The active project id, per source, that storage is known to hold: the id last written or read. A
 * WebView update that reports this id writes nothing to storage.
 */
const rememberedActiveProjects = new Map<string, string | undefined>();

/** The open analysis sessions, over the extension's storage; set on activation. */
let sessions: AnalysisSessions;

/** Builds the sessions, reporting each change through `emitter`. */
function createSessions(
  emitter: PlatformEventEmitter<NetworkEvents['interlinearizer.onAnalysisChanged']>,
): AnalysisSessions {
  return new AnalysisSessions({
    findProject: async (sourceProjectId, interlinearProjectId) =>
      (await projectStorage.getProjectSummariesForSource(executionToken, sourceProjectId)).find(
        (summary) => summary.id === interlinearProjectId,
      ),
    openDraftRepository: (sourceProjectId) =>
      projectStorage.openDraftRepository(executionToken, sourceProjectId),
    releaseDraftRepository: (sourceProjectId) =>
      projectStorage.releaseDraftRepository(sourceProjectId),
    openPt9ImportRepository: (interlinearProjectId) =>
      projectStorage.openPt9ImportRepository(executionToken, interlinearProjectId),
    getInterfaceLanguages: () => papi.settings.get('platform.interfaceLanguage'),
    startTextRead: async (sourceProjectId) => {
      if (!sessionReadsAreSkipped()) await bookService.startTextRead(sourceProjectId);
    },
    stopTextRead: (sourceProjectId) => bookService.stopTextRead(sourceProjectId),
    holdTextRead: bookService.holdTextRead,
    heldBook: (sourceProjectId, bookId, segmentation) =>
      bookService.heldBook(sourceProjectId, bookId, segmentation),
    getOpenVerseBook: bookService.getOpenVerseBook,
    reportChange: (change) => emitter.emit(change),
  });
}

// #endregion

// #region Command handlers

/**
 * Opens the Interlinearizer WebView for a project. Each project gets its own tab; reopening an
 * already-open project brings that tab to front.
 *
 * @param projectId - The project to open. When omitted, the user picks one in a project picker
 *   dialog.
 * @param besideTabId - The tab that a new Interlinearizer tab opens right after, in that tab's
 *   group. When omitted, the platform's default placement applies.
 * @returns The WebView ID of the opened (or focused) tab, or `undefined` if the user cancels.
 * @throws If `papi.dialogs.selectProject` rejects (e.g. platform error while showing the dialog).
 * @throws If `papi.webViews.openWebView` rejects (e.g. the platform cannot open or focus the tab).
 */
async function openInterlinearizer(
  projectId?: string,
  besideTabId?: string,
): Promise<string | undefined> {
  const resolvedProjectId =
    projectId ??
    (await papi.dialogs.selectProject({
      title: '%interlinearizer_dialog_open_title%',
      prompt: '%interlinearizer_dialog_open_prompt%',
      includeProjectInterfaces: '^platformScripture\\.USJ_Book$',
    }));

  if (!resolvedProjectId) return undefined;

  const existingId = openWebViewsByProject.get(resolvedProjectId);
  // Computed only when this open creates a tab: focusing an existing tab must not reset an offer or
  // a project the user may already be looking at.
  const seededState =
    existingId === undefined
      ? await Promise.all([
          pt9ImportService.hasNoInterlinearizerState(executionToken, resolvedProjectId),
          readRememberedActiveProject(resolvedProjectId),
        ]).then(([offerPt9Import, activeProject]) => ({ offerPt9Import, activeProject }))
      : undefined;
  const options: InterlinearizerOpenOptions = {
    existingId,
    projectId: resolvedProjectId,
    ...seededState,
  };
  const layout =
    besideTabId === undefined
      ? undefined
      : { type: 'panel' as const, direction: 'after-tab' as const, targetTabId: besideTabId };
  return papi.webViews.openWebView(mainWebViewType, layout, options);
}

/**
 * Reads the interlinear project the source's view last had active, or `undefined` when none is
 * remembered. A failed read is logged and answered as `undefined` rather than thrown.
 */
async function readRememberedActiveProject(
  sourceProjectId: string,
): Promise<InterlinearProjectSummary | undefined> {
  try {
    const project = await projectStorage.getRememberedActiveProject(
      executionToken,
      sourceProjectId,
    );
    // The tab this seeds reports the project straight back, and storage already holds it.
    if (project) rememberedActiveProjects.set(sourceProjectId, project.id);
    return project;
  } catch (e) {
    logger.error('Interlinearizer: failed to read the remembered active project', e);
    return undefined;
  }
}

/**
 * Remembers which interlinear project the WebView `state` has active for `sourceProjectId`, so that
 * the next tab opened on that source opens on it. Forgets the remembered project when the state has
 * none active; the platform's open and update events carry the WebView's whole state.
 *
 * A write that fails is logged, and the tab's next update or its close writes again.
 */
function rememberActiveProject(
  sourceProjectId: string,
  state: SavedWebViewDefinition['state'],
): void {
  const activeProjectKey: keyof InterlinearizerWebViewState = 'activeProject';
  const active = state?.[activeProjectKey];
  const activeId = isInterlinearProjectSummary(active) ? active.id : undefined;
  if (
    rememberedActiveProjects.has(sourceProjectId) &&
    rememberedActiveProjects.get(sourceProjectId) === activeId
  )
    return;
  rememberedActiveProjects.set(sourceProjectId, activeId);
  projectStorage.rememberActiveProject(executionToken, sourceProjectId, activeId).catch((e) => {
    rememberedActiveProjects.delete(sourceProjectId);
    logger.error('Interlinearizer: failed to remember the active project', e);
  });
}

async function openInterlinearizerForWebView(webViewId?: string): Promise<string | undefined> {
  if (!webViewId) return openInterlinearizer();
  const webViewDefinition = await papi.webViews.getOpenWebViewDefinition(webViewId);
  return openInterlinearizer(webViewDefinition?.projectId, webViewId);
}

async function createInterlinearProject(
  sourceProjectId: string,
  analysisLanguages: string[],
  targetProjectId?: string,
  name?: string,
  description?: string,
): Promise<string> {
  try {
    const project = await projectStorage.createProject(
      executionToken,
      sourceProjectId,
      analysisLanguages,
      targetProjectId,
      name,
      description,
    );
    return JSON.stringify(toProjectSummary(project));
  } catch (e) {
    logger.error('Interlinearizer: failed to create project', e);
    await papi.notifications
      .send({
        message: '%interlinearizer_error_create_project_failed%',
        severity: 'error',
      })
      .catch(() => {});
    throw e;
  }
}

async function deleteInterlinearProject(interlinearProjectId: string): Promise<void> {
  try {
    await projectStorage.deleteProject(executionToken, interlinearProjectId);
  } catch (e) {
    logger.error('Interlinearizer: failed to delete project', e);
    await papi.notifications
      .send({
        message: '%interlinearizer_error_delete_project_failed%',
        severity: 'error',
      })
      .catch(() => {});
    throw e;
  }
}

async function updateProjectMetadata(
  interlinearProjectId: string,
  name: string | undefined,
  description: string | undefined,
  targetProjectId?: string,
): Promise<string | undefined> {
  try {
    const updated = await projectStorage.updateProjectMetadata(
      executionToken,
      interlinearProjectId,
      name,
      description,
      targetProjectId,
    );
    return updated ? JSON.stringify(toProjectSummary(updated)) : undefined;
  } catch (e) {
    logger.error('Interlinearizer: failed to update project metadata', e);
    await papi.notifications
      .send({
        message: '%interlinearizer_error_update_project_failed%',
        severity: 'error',
      })
      .catch(() => {});
    throw e;
  }
}

/**
 * The warning for each reason an import kept what was already stored. A Record, so a new reason has
 * to bring its own string rather than compile with another's.
 */
const STALE_KEPT_MESSAGES: Record<NonNullable<Pt9ImportResult['staleReason']>, `%${string}%`> = {
  sourceEmpty: '%interlinearizer_warning_pt9Import_sourceEmpty%',
  allFilesTooLarge: '%interlinearizer_warning_pt9Import_allFilesTooLarge%',
  noGlossLanguage: '%interlinearizer_warning_pt9Import_noGlossLanguage%',
};

/**
 * Imports or syncs the source's Paratext 9 interlinear data. A run that keeps the stored import
 * sends a warning notification.
 */
async function importPt9Project(sourceProjectId: string): Promise<string> {
  try {
    const result = await pt9ImportService.importPt9Project(executionToken, sourceProjectId);
    if (result.outcome === 'staleKept') {
      await papi.notifications
        .send({
          message: STALE_KEPT_MESSAGES[result.staleReason ?? 'sourceEmpty'],
          severity: 'warning',
        })
        .catch(() => {});
    } else if (result.outcome === 'notConverted') {
      await papi.notifications
        .send({ message: '%interlinearizer_error_pt9Import_failed%', severity: 'error' })
        .catch(() => {});
    }
    return JSON.stringify(result);
  } catch (e) {
    logger.error('Interlinearizer: failed to import Paratext 9 interlinear data', e);
    await papi.notifications
      .send({
        message: '%interlinearizer_error_pt9Import_failed%',
        severity: 'error',
      })
      .catch(() => {});
    throw e;
  }
}

async function createEditableCopy(
  interlinearProjectId: string,
  name: string,
  description?: string,
): Promise<string> {
  try {
    const project = await projectStorage.createEditableCopy(
      executionToken,
      interlinearProjectId,
      name,
      description,
    );
    return JSON.stringify(toProjectSummary(project));
  } catch (e) {
    logger.error('Interlinearizer: failed to create an editable copy', e);
    await papi.notifications
      .send({
        message: '%interlinearizer_error_createEditableCopy_failed%',
        severity: 'error',
      })
      .catch(() => {});
    throw e;
  }
}

/**
 * Logs a failed save under `description` and sends `message` as its error notification, so the
 * frontend `catch` block can suppress the error without a second notification.
 */
async function reportSaveFailure(
  e: unknown,
  description: string,
  message: LocalizeKey,
): Promise<void> {
  logger.error(`Interlinearizer: failed to ${description}`, e);
  await papi.notifications.send({ message, severity: 'error' }).catch(() => {});
}

/**
 * Tells the user which books of the draft could not be read, sending `message` at `severity` with
 * them listed, and naming analyses linked to no book in words rather than by their storage name.
 * Sends nothing when no book is named; a notification that fails is logged and dropped.
 */
async function reportUnreadableBooks(
  books: readonly string[],
  message: LocalizeKey,
  severity: 'warning' | 'error',
): Promise<void> {
  if (books.length === 0) return;
  try {
    const [template, unlinked] = await Promise.all([
      papi.localization.getLocalizedString({ localizeKey: message }),
      papi.localization.getLocalizedString({
        localizeKey: '%interlinearizer_unreadable_unlinkedAnalyses%',
      }),
    ]);
    const named = books.map((book) => (book === BOOKLESS_PARTITION ? unlinked : book));
    await papi.notifications.send({
      message: formatReplacementString(template, { books: named.join(', ') }),
      severity,
    });
  } catch (e) {
    logger.warn('Interlinearizer: could not report the unreadable books of a draft', e);
  }
}

/**
 * Runs `save` in the session's turn. When `savedWhole` gives the project that the result saved the
 * whole draft to, the session's history then marks the draft saved. A save of an empty draft stays
 * saved even once that project is deleted.
 *
 * A failed mark is only logged, because the project holds the saved content either way.
 *
 * @throws If the session is not open, or whatever `save` throws.
 */
async function savingInSession<T>(
  sessionId: string,
  save: () => Promise<T>,
  savedWhole: (result: T) => InterlinearProject | undefined,
): Promise<T> {
  return sessions.run(sessionId, async ({ history }) => {
    const result = await save();
    const project = savedWhole(result);
    if (project) {
      if (isEmptyDraft(project)) history.noteEmpty();
      try {
        await history.markClean();
      } catch (e) {
        logger.warn(`Interlinearizer: could not mark session ${sessionId}'s draft saved`, e);
      }
    }
    return result;
  });
}

/**
 * Copies the source's draft into an existing interlinearizer project. A draft that cannot be read
 * for some book is not copied, and the user is told which books and how to recover.
 */
async function saveDraftToProject(
  sessionId: string,
  sourceProjectId: string,
  interlinearProjectId: string,
  config?: Pick<ProjectConfig, 'targetProjectId'>,
): Promise<string | undefined> {
  try {
    return await perfTimeAsync('saveDraftToProject', async () => {
      const saved = await savingInSession(
        sessionId,
        () =>
          projectStorage.saveDraftToProject(
            executionToken,
            sourceProjectId,
            interlinearProjectId,
            config,
          ),
        (project) => project,
      );
      return saved ? JSON.stringify(toProjectSummary(saved)) : undefined;
    });
  } catch (e) {
    if (e instanceof UnreadableBooksError) {
      logger.error('Interlinearizer: failed to save the draft to a project', e);
      await reportUnreadableBooks(e.books, '%interlinearizer_error_save_unreadableBooks%', 'error');
    } else
      await reportSaveFailure(
        e,
        'save the draft to a project',
        '%interlinearizer_error_save_analysis_failed%',
      );
    throw e;
  }
}

/**
 * Creates an interlinearizer project holding a copy of the source's draft. A book of the draft that
 * cannot be read is left out, and the user is told which.
 */
async function saveDraftAsProject(
  sessionId: string,
  sourceProjectId: string,
  analysisLanguages: string[],
  targetProjectId?: string,
  name?: string,
  description?: string,
): Promise<string> {
  try {
    return await perfTimeAsync('saveDraftAsProject', async () => {
      const created = await savingInSession(
        sessionId,
        () =>
          projectStorage.saveDraftAsNewProject(
            executionToken,
            sourceProjectId,
            analysisLanguages,
            targetProjectId,
            name,
            description,
          ),
        ({ project, omittedBooks }) => (omittedBooks.length === 0 ? project : undefined),
      );
      await reportUnreadableBooks(
        created.omittedBooks,
        '%interlinearizer_warning_saveAs_unreadableBooksOmitted%',
        'warning',
      );
      const saved: SavedAsProject = {
        project: toProjectSummary(created.project),
        omittedBooks: created.omittedBooks,
      };
      return JSON.stringify(saved);
    });
  } catch (e) {
    await reportSaveFailure(
      e,
      'save the draft as a new project',
      '%interlinearizer_error_create_project_failed%',
    );
    throw e;
  }
}

/** The session that a page or text-read command reads. */
type SessionAddress = Readonly<{ sessionId: string }>;

/** The boundaries that the session's draft sets. */
async function sessionBoundaries(session: Session): Promise<SegmentationDelta | undefined> {
  return (await session.repository.getScope()).segmentation;
}

/**
 * Outlines a book of the session's source. The draft is first re-anchored to the book's text,
 * unless the session last re-anchored that book to the same text. A failed re-anchor is only
 * logged.
 */
async function getBookOutline(
  { sessionId }: SessionAddress,
  bookId: string,
): Promise<string | undefined> {
  try {
    return await perfTimeAsync('getBookOutline', () => {
      sessions
        .reanchorOpenedBook(sessionId, bookId)
        .catch((e) =>
          logger.warn(`Interlinearizer: could not re-anchor ${bookId} of session ${sessionId}`, e),
        );
      return sessions.run(sessionId, async (session) => {
        const book = await bookService.getOpenBook(
          session.scope.sourceProjectId,
          bookId,
          await sessionBoundaries(session),
        );
        const verseBook = await bookService.getOpenVerseBook(session.scope.sourceProjectId, bookId);
        if (!book || !verseBook) return undefined;
        const outline = await readBookOutline(session.repository, book, verseBook);
        return perfTime('getBookOutline:serialize', () => JSON.stringify(outline));
      });
    });
  } catch (e) {
    logger.error(`Interlinearizer: failed to outline book ${bookId} of session ${sessionId}`, e);
    throw e;
  }
}

async function getStaleSummary({
  sessionId,
  bookId,
}: ArgsOf<'interlinearizer.getStaleSummary'>): Promise<string | undefined> {
  try {
    return await sessions.run(sessionId, async (session) => {
      const book = await bookService.getOpenBook(
        session.scope.sourceProjectId,
        bookId,
        await sessionBoundaries(session),
      );
      return book && JSON.stringify(await readStaleSummary(session.repository, book));
    });
  } catch (e) {
    logger.error(
      `Interlinearizer: failed to summarize the stale analyses of book ${bookId} of session ${sessionId}`,
      e,
    );
    throw e;
  }
}

async function getSegments(
  { sessionId }: SessionAddress,
  bookId: string,
  start: number,
  end: number,
): Promise<string | undefined> {
  try {
    return await perfTimeAsync('getSegments', () =>
      sessions.run(sessionId, async (session) => {
        const book = await bookService.getSegmentedBook(
          session.scope.sourceProjectId,
          bookId,
          await sessionBoundaries(session),
        );
        if (!book) return undefined;
        const page = await readSegmentPage(session.repository, book, start, end);
        return perfTime('getSegments:serialize', () => JSON.stringify(page));
      }),
    );
  } catch (e) {
    logger.error(
      `Interlinearizer: failed to serve segments ${start}-${end} of book ${bookId} of session ${sessionId}`,
      e,
    );
    throw e;
  }
}

/**
 * Reports how far the session's read of its whole source text has got. While session reads are
 * skipped, the read never finishes.
 */
async function getTextReadStatus({ sessionId }: SessionAddress): Promise<string> {
  try {
    await sessions.startTextRead(sessionId);
    const sourceProjectId = await sessions.run(
      sessionId,
      async ({ scope }) => scope.sourceProjectId,
    );
    if (sessionReadsAreSkipped()) {
      // Never finishes, so the session's view waits as for a read under way.
      const unread: TextReadStatus = { booksRead: 0, bookCount: 1, failedBookIds: [] };
      return JSON.stringify(unread);
    }
    return await bookService.getTextReadStatus(sourceProjectId);
  } catch (e) {
    logger.error(`Interlinearizer: failed to read the text of session ${sessionId}`, e);
    throw e;
  }
}

async function retryTextRead({ sessionId }: SessionAddress): Promise<void> {
  try {
    const sourceProjectId = await sessions.run(
      sessionId,
      async ({ scope }) => scope.sourceProjectId,
    );
    await bookService.retryFailedBooks(sourceProjectId);
  } catch (e) {
    logger.error(`Interlinearizer: failed to read the text of session ${sessionId} again`, e);
    throw e;
  }
}

/**
 * Builds the draft that starting over from `from` writes for the source project: a copy of a stored
 * project's analysis and configuration, or an empty draft with a New dialog's configuration.
 *
 * @throws {Error} If `from` names a project that is not stored.
 * @throws {TypeError} If the draft does not conform to {@link DraftProject}.
 * @throws Whatever reading the project throws.
 */
async function startedDraft(sourceProjectId: string, from: DraftStart): Promise<DraftProject> {
  const started = { sourceProjectId, modelVersion: CURRENT_MODEL_VERSION, dirty: false };
  let draft: DraftProject;
  if ('interlinearProjectId' in from) {
    const project = await projectStorage.getProject(executionToken, from.interlinearProjectId);
    if (!project)
      throw new Error(
        `Interlinearizer: interlinear project ${from.interlinearProjectId} is not stored`,
      );
    draft = {
      ...started,
      analysisLanguages: project.analysisLanguages,
      ...(project.targetProjectId !== undefined && { targetProjectId: project.targetProjectId }),
      ...(project.segmentation !== undefined && { segmentation: project.segmentation }),
      analysis: project.analysis,
    };
  } else {
    draft = {
      ...started,
      analysisLanguages: from.analysisLanguages,
      ...(from.suggestedDescription !== undefined && {
        suggestedDescription: from.suggestedDescription,
      }),
      analysis: emptyAnalysis(),
    };
  }
  if (!isDraftProject(draft))
    throw new TypeError('startDraftOver: the started draft does not conform to DraftProject');
  return draft;
}

async function startDraftOver({
  sourceProjectId,
  from,
}: ArgsOf<'interlinearizer.startDraftOver'>): Promise<void> {
  try {
    const draft = await startedDraft(sourceProjectId, from);
    await sessions.closeAndRun(sourceProjectId, () =>
      projectStorage.startDraftOver(executionToken, sourceProjectId, draft),
    );
  } catch (e) {
    logger.error('Interlinearizer: failed to save draft', e);
    await papi.notifications
      .send({ message: '%interlinearizer_error_save_draft_failed%', severity: 'error' })
      .catch(() => {});
    throw e;
  }
}

async function getProjectSummary(interlinearProjectId: string): Promise<string | undefined> {
  try {
    const summary = await projectStorage.getProjectSummary(executionToken, interlinearProjectId);
    return summary ? JSON.stringify(summary) : undefined;
  } catch (e) {
    logger.error('Interlinearizer: failed to get the project summary', e);
    throw e;
  }
}

/** The one argument that the command `C` takes. */
type ArgsOf<C extends keyof CommandHandlers> = Parameters<CommandHandlers[C]>[0];

async function openSession({
  sourceProjectId,
  interlinearProjectId,
  importProjectId,
}: ArgsOf<'interlinearizer.openSession'>): Promise<string> {
  try {
    const opened: OpenedSession = await sessions.open(
      sourceProjectId,
      interlinearProjectId,
      importProjectId,
    );
    await reportUnreadableBooks(
      opened.unreadableBooks,
      '%interlinearizer_warning_loadDraft_unreadableBooks%',
      'warning',
    );
    return JSON.stringify(opened);
  } catch (e) {
    logger.error(`Interlinearizer: failed to open a session on project ${sourceProjectId}`, e);
    throw e;
  }
}

async function closeSession({ sessionId }: ArgsOf<'interlinearizer.closeSession'>): Promise<void> {
  try {
    await sessions.close(sessionId);
  } catch (e) {
    logger.error(`Interlinearizer: failed to close session ${sessionId}`, e);
    throw e;
  }
}

async function setAnalysisLanguage({
  sessionId,
  analysisLanguage,
}: ArgsOf<'interlinearizer.setAnalysisLanguage'>): Promise<void> {
  try {
    await sessions.setAnalysisLanguage(sessionId, analysisLanguage);
  } catch (e) {
    logger.error(`Interlinearizer: failed to set the analysis language of session ${sessionId}`, e);
    throw e;
  }
}

async function setSaveTarget({
  sessionId,
  interlinearProjectId,
}: ArgsOf<'interlinearizer.setSaveTarget'>): Promise<void> {
  try {
    await sessions.setSaveTarget(sessionId, interlinearProjectId);
  } catch (e) {
    logger.error(`Interlinearizer: failed to set the save target of session ${sessionId}`, e);
    throw e;
  }
}

async function detachFromProject({
  sessionId,
}: ArgsOf<'interlinearizer.detachFromProject'>): Promise<void> {
  try {
    await sessions.detachFromProject(sessionId);
  } catch (e) {
    logger.error(`Interlinearizer: failed to detach session ${sessionId} from its project`, e);
    throw e;
  }
}

async function undoEdit({
  sessionId,
  changeId,
}: ArgsOf<'interlinearizer.undoEdit'>): Promise<string | undefined> {
  try {
    const reply = await sessions.undo(sessionId, changeId);
    return reply && JSON.stringify(reply);
  } catch (e) {
    logger.error(`Interlinearizer: failed to undo an edit in session ${sessionId}`, e);
    throw e;
  }
}

async function redoEdit({
  sessionId,
  changeId,
}: ArgsOf<'interlinearizer.redoEdit'>): Promise<string | undefined> {
  try {
    const reply = await sessions.redo(sessionId, changeId);
    return reply && JSON.stringify(reply);
  } catch (e) {
    logger.error(`Interlinearizer: failed to redo an edit in session ${sessionId}`, e);
    throw e;
  }
}

async function checkIndexes({
  sessionId,
}: ArgsOf<'interlinearizer.checkIndexes'>): Promise<string> {
  try {
    return JSON.stringify(
      await sessions.run(sessionId, (session) => session.repository.checkIndexes()),
    );
  } catch (e) {
    logger.error(`Interlinearizer: failed to check the indexes of session ${sessionId}`, e);
    throw e;
  }
}

async function getDraftEnvelope({
  sessionId,
}: ArgsOf<'interlinearizer.getDraftEnvelope'>): Promise<string> {
  try {
    return JSON.stringify(
      await sessions.run(sessionId, ({ repository, analysisLanguage }) =>
        readDraftEnvelope(repository, analysisLanguage),
      ),
    );
  } catch (e) {
    logger.error(`Interlinearizer: failed to read the draft envelope of session ${sessionId}`, e);
    throw e;
  }
}

async function getProjectsForSource(sourceProjectId: string): Promise<string> {
  try {
    return await perfTimeAsync('getProjectsForSource', async () => {
      const summaries = await projectStorage.getProjectSummariesForSource(
        executionToken,
        sourceProjectId,
      );
      return perfTime('getProjectsForSource:serialize', () => JSON.stringify(summaries));
    });
  } catch (e) {
    logger.error('Interlinearizer: failed to list projects for source', e);
    throw e;
  }
}

// #endregion

// #region Lifecycle

/**
 * Extension entry point. Registers the Interlinearizer WebView provider, its commands,
 * project-setting validators, and WebView lifecycle subscriptions. Called by the platform when the
 * extension is loaded. Every registration is added to `context` so the platform can dispose them on
 * deactivation.
 */
export async function activate(context: ExecutionActivationContext): Promise<void> {
  logger.debug('Interlinearizer extension is activating!');

  executionToken = context.executionToken;
  rememberedActiveProjects.clear();

  /**
   * Adds the resolved `registration` to `context`, so a failure later in activation still disposes
   * the registration.
   */
  async function keep<T extends Parameters<typeof context.registrations.add>[number]>(
    registration: Promise<T>,
  ): Promise<T> {
    const registered = await registration;
    context.registrations.add(registered);
    return registered;
  }

  context.registrations.add(
    startCSharpHost(executionToken, context.elevatedPrivileges.createProcess),
  );

  // Opportunistically retry deleting any project records orphaned by a failed rollback on a prior
  // run (see projectStorage.createProject). Fire-and-forget: a cleanup failure must never block or
  // fail activation, and the sweep will run again on the next activation.
  projectStorage.sweepPendingCleanup(executionToken).catch((e) => {
    logger.error('Interlinearizer: pending-cleanup sweep failed during activation:', e);
  });

  // Subscribed ahead of the provider, since a tab restored from the saved layout reports itself only
  // through the update its provider call triggers.
  function trackWebView({ webView }: { webView: SavedWebViewDefinition }): void {
    if (webView.webViewType !== mainWebViewType || !webView.projectId) return;
    const holder = openWebViewsByProject.get(webView.projectId);
    if (holder !== undefined && holder !== webView.id) return;
    openWebViewsByProject.set(webView.projectId, webView.id);
    rememberActiveProject(webView.projectId, webView.state);
  }
  const webViewOpenUnsubscriber = papi.webViews.onDidOpenWebView(trackWebView);
  const webViewUpdateUnsubscriber = papi.webViews.onDidUpdateWebView(trackWebView);

  const webViewCloseUnsubscriber = papi.webViews.onDidCloseWebView(({ webView }) => {
    if (webView.webViewType !== mainWebViewType || !webView.projectId) return;
    const { projectId } = webView;
    const duplicates = duplicateWebViewsByProject.get(projectId);
    duplicates?.delete(webView.id);
    if (openWebViewsByProject.get(projectId) !== webView.id) return;
    rememberActiveProject(projectId, webView.state);
    openWebViewsByProject.delete(projectId);
    bookService.closeProject(projectId);
    // A duplicate takes the project over, served afresh now that no tab holds it. The duplicate
    // stays registered until it is served as the holder. A failed reload leaves it for the next
    // holder's close.
    const [successor] = duplicates ?? [];
    if (successor === undefined) return;
    papi.webViews
      .reloadWebView(mainWebViewType, successor, { bringToFront: false })
      .catch((e) => logger.warn(`Interlinearizer: could not hand ${projectId} to another tab`, e));
  });
  // Added ahead of the registrations below, so a failure among them still disposes these.
  context.registrations.add(
    webViewOpenUnsubscriber,
    webViewUpdateUnsubscriber,
    webViewCloseUnsubscriber,
  );

  // Built ahead of every command, so no command reaches sessions that cannot report yet.
  const emitter = await papi.network.createNetworkEventEmitterAsync(
    'interlinearizer.onAnalysisChanged',
  );
  const activeSessions = createSessions(emitter);
  sessions = activeSessions;
  const edits = sessionEditHandlers({
    sessions: activeSessions,
    logger,
    getSegmentedBook: bookService.getSegmentedBook,
    getVerseBook: bookService.getVerseBook,
    getProject: (interlinearProjectId) =>
      projectStorage.getProject(executionToken, interlinearProjectId),
  });
  const catalog = sessionCatalogHandlers({
    sessions: activeSessions,
    logger,
    getOpenVerseBook: bookService.getOpenVerseBook,
    getVerseBook: bookService.getVerseBook,
    isFormInText: bookService.isFormInText,
  });
  const concordance = sessionConcordanceHandlers({
    sessions: activeSessions,
    logger,
    getConcordanceBooks: bookService.getConcordanceBooks,
    getWritingSystem: bookService.getWritingSystem,
  });
  const bookReadUnsubscriber = bookService.onBookRead((sourceProjectId, book, edited) =>
    activeSessions
      .reanchorBook(sourceProjectId, book, edited)
      .catch((e) =>
        logger.warn(
          `Interlinearizer: could not re-anchor ${book.bookRef} of project ${sourceProjectId}`,
          e,
        ),
      ),
  );
  const textReadUnsubscriber = bookService.onTextRead((sourceProjectId, textBookIds) =>
    activeSessions
      .reanchorMissingBooks(sourceProjectId, textBookIds)
      .catch((e) =>
        logger.warn(
          `Interlinearizer: could not re-anchor the books project ${sourceProjectId} lacks`,
          e,
        ),
      ),
  );
  const textReadProgressUnsubscriber = bookService.onTextReadProgress(
    (sourceProjectId, formsChanged) =>
      activeSessions
        .reportTextReadProgress(sourceProjectId, formsChanged)
        .catch((e) =>
          logger.warn(
            `Interlinearizer: could not report how far the text of project ${sourceProjectId} is read`,
            e,
          ),
        ),
  );
  const bookTextUnsubscriber = bookService.onBookTextChanged((sourceProjectId, bookId) =>
    activeSessions
      .reportScriptureEdit(sourceProjectId, bookId)
      .catch((e) =>
        logger.warn(
          `Interlinearizer: could not report the edit to ${bookId} of project ${sourceProjectId}`,
          e,
        ),
      ),
  );
  context.registrations.add(
    // In this order: closing a session waits for its queued passes, which read the kept books
    // and report through the emitter.
    {
      dispose: async () => {
        try {
          await activeSessions.closeAll();
        } catch (e) {
          logger.warn('Interlinearizer: could not close every session', e);
        }
        try {
          await bookService.closeAllProjects();
        } catch (e) {
          logger.warn('Interlinearizer: could not let go of every book', e);
        }
        return emitter.dispose();
      },
    },
    bookReadUnsubscriber,
    textReadUnsubscriber,
    textReadProgressUnsubscriber,
    bookTextUnsubscriber,
  );

  await keep(papi.webViewProviders.registerWebViewProvider(mainWebViewType, mainWebViewProvider));

  /** Returns whether the supplied project-setting value is a boolean. */
  /* v8 ignore next 3 */
  function isBoolean(newValue: unknown): Promise<boolean> {
    return Promise.resolve(typeof newValue === 'boolean');
  }

  /**
   * Returns whether the supplied project-setting value is a boolean or the `'auto'` a reset
   * restores.
   */
  /* v8 ignore next 3 */
  function isBooleanOrAuto(newValue: unknown): Promise<boolean> {
    return Promise.resolve(typeof newValue === 'boolean' || newValue === 'auto');
  }

  await keep(papi.projectSettings.registerValidator('interlinearizer.continuousScroll', isBoolean));

  await keep(
    papi.projectSettings.registerValidator('interlinearizer.showMorphology', isBooleanOrAuto),
  );

  await keep(
    papi.projectSettings.registerValidator('interlinearizer.showFreeTranslation', isBooleanOrAuto),
  );

  const undoFromNotificationEmitter = await keep(
    papi.network.createNetworkEventEmitterAsync('interlinearizer.onUndoFromNotification'),
  );

  // The WebView handles these commands; registering them makes them known to the platform.
  /* v8 ignore next */
  const handledInWebView = async () => {};

  const handlers: { [C in ExtensionCommand]: CommandHandlers[C] } = {
    ...edits,
    ...catalog,
    ...concordance,
    'interlinearizer.openForWebView': openInterlinearizerForWebView,
    'interlinearizer.createProject': createInterlinearProject,
    'interlinearizer.getProjectSummary': getProjectSummary,
    'interlinearizer.saveDraftToProject': saveDraftToProject,
    'interlinearizer.saveDraftAsProject': saveDraftAsProject,
    'interlinearizer.getProjectsForSource': getProjectsForSource,
    'interlinearizer.getBookOutline': getBookOutline,
    'interlinearizer.getSegments': getSegments,
    'interlinearizer.getTextReadStatus': getTextReadStatus,
    'interlinearizer.retryTextRead': retryTextRead,
    'interlinearizer.startDraftOver': startDraftOver,
    'interlinearizer.getStaleSummary': getStaleSummary,
    'interlinearizer.openSession': openSession,
    'interlinearizer.closeSession': closeSession,
    'interlinearizer.setAnalysisLanguage': setAnalysisLanguage,
    'interlinearizer.setSaveTarget': setSaveTarget,
    'interlinearizer.detachFromProject': detachFromProject,
    'interlinearizer.undoEdit': undoEdit,
    'interlinearizer.redoEdit': redoEdit,
    'interlinearizer.checkIndexes': checkIndexes,
    'interlinearizer.getDraftEnvelope': getDraftEnvelope,
    'interlinearizer.setPerfMarks': async (enabled: boolean) => setHostPerfMarks(enabled),
    'interlinearizer.setSkipSessionReads': async (skip: boolean) => setSessionReadsSkipped(skip),
    'interlinearizer.sessionIdFor': async (sourceProjectId: string) =>
      sessions.sessionIdFor(sourceProjectId),
    'interlinearizer.readPerf': async () => {
      const reading = readHostPerf();
      return reading && JSON.stringify(reading);
    },
    'interlinearizer.updateProjectMetadata': updateProjectMetadata,
    'interlinearizer.importPt9Project': importPt9Project,
    'interlinearizer.createEditableCopy': createEditableCopy,
    'interlinearizer.deleteProject': deleteInterlinearProject,
    'interlinearizer.openSelectProjectModal': handledInWebView,
    'interlinearizer.openNewProjectModal': handledInWebView,
    'interlinearizer.openProjectInfoModal': handledInWebView,
    'interlinearizer.openDeleteProjectModal': handledInWebView,
    'interlinearizer.openAnalysisCatalog': handledInWebView,
    'interlinearizer.openConcordance': handledInWebView,
    'interlinearizer.undo': handledInWebView,
    'interlinearizer.redo': handledInWebView,
    'interlinearizer.undoFromNotification': async (notificationId) => {
      undoFromNotificationEmitter.emit({ notificationId });
    },
    'interlinearizer.openLexiconChooser': handledInWebView,
    'interlinearizer.save': handledInWebView,
    'interlinearizer.openSaveAsModal': handledInWebView,
    'interlinearizer.openDiscardChangesModal': handledInWebView,
  };

  const commandOptions: Partial<
    Record<ExtensionCommand, Parameters<typeof papi.commands.registerCommand>[3]>
  > = {
    // Import time grows with the project's data, so any fixed timeout reports a false failure on a
    // large project while the host finishes the import.
    'interlinearizer.importPt9Project': { timeoutMilliseconds: 0 },
  };

  // Registered one at a time, so a failed registration leaves none in flight to leak.
  await extensionCommands.reduce(async (previous, commandName) => {
    await previous;
    await keep(
      papi.commands.registerCommand(
        commandName,
        handlers[commandName],
        { method: commandDocs[commandName] },
        commandOptions[commandName],
      ),
    );
  }, Promise.resolve());

  logger.debug('Interlinearizer extension finished activating!');
}

/**
 * Extension teardown. Called by the platform when the extension is unloaded. Registrations added
 * during activate are disposed by the platform. Forgets which tab holds each project and which tabs
 * duplicate it, so the next activation tracks tabs afresh.
 *
 * @returns True to indicate successful deactivation; the platform may use this for logging.
 */
export async function deactivate(): Promise<boolean> {
  openWebViewsByProject.clear();
  duplicateWebViewsByProject.clear();
  logger.debug('Interlinearizer extension is deactivating!');
  return true;
}

// #endregion
