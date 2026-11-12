import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  ExecutionToken,
  IWebViewProvider,
  MethodDocumentationWithoutName,
  OpenWebViewOptions,
  SavedWebViewDefinition,
  WebViewDefinition,
} from '@papi/core';
import type { DraftProject, DraftStart, InterlinearProject, ProjectConfig } from 'interlinearizer';
import type { CommandHandlers, NetworkEvents } from 'papi-shared-types';
import {
  formatReplacementString,
  type LocalizeKey,
  type PlatformEventEmitter,
  type UnsubscriberAsync,
} from 'platform-bible-utils';
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
import {
  AnalysisSessions,
  isEmptyDraft,
  type OpenedSession,
  type Session,
} from './services/analysisSessions';
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
import { readBookOutline, readSegmentPage } from './services/sessionPages';
import { sessionCatalogHandlers } from './services/sessionCatalogHandlers';
import { sessionEditHandlers } from './services/sessionEditHandlers';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only for its doc links
import type { CommandReply } from './types/command-reply';
import type { TextReadStatus } from './types/text-read-status';
import {
  toProjectSummary,
  type InterlinearProjectSummary,
  type SavedAsProject,
} from './types/interlinear-project-summary';
import { UnreadableBooksError } from './types/analysis-repository';
import { emptyAnalysis } from './types/empty-factories';
import { CURRENT_MODEL_VERSION } from './types/model-version';
import { isDraftProject, isInterlinearProjectSummary } from './types/type-guards';
import { BOOKLESS_PARTITION } from './utils/analysis-book';
import { perfTime, perfTimeAsync } from './utils/perf-marks';
import { bookSegmentationJson } from './utils/segmentation';

// #region WebView provider

/**
 * WebView type identifier for the Interlinearizer. Used when registering the provider and when
 * opening the WebView from the platform.
 */
const mainWebViewType = 'interlinearizer.mainWebView';

/** Options passed to `papi.webViews.openWebView` when opening the Interlinearizer. */
export interface InterlinearizerOpenOptions extends OpenWebViewOptions {
  /** Paratext project ID to load in the Interlinearizer WebView. */
  projectId?: string;
  /**
   * Whether the WebView should offer converting the source's Paratext 9 interlinear data: set on an
   * explicit open when the source has no interlinearizer state stored yet. The WebView probes the
   * source for convertible data and shows the offer only if it finds any. Carried into the
   * WebView's state, where answering the offer clears it.
   */
  offerPt9Import?: boolean;
  /**
   * The interlinear project the source's view last had active, set on an explicit open that creates
   * the tab. Carried into the WebView's state, so the new tab opens on that project.
   */
  activeProject?: InterlinearProjectSummary;
}

/** Tab title used when there is no project to name or the localized title format cannot be read. */
const baseTabTitle = 'Interlinearizer';

/**
 * Formats the tab title for the given source project, falling back to the project id when its short
 * name cannot be read and to {@link baseTabTitle} when the title format cannot.
 */
async function getTabTitle(projectId: string): Promise<string> {
  let projectName = projectId;
  try {
    const pdp = await papi.projectDataProviders.get('platform.base', projectId);
    projectName = (await pdp.getSetting('platform.name')) || projectId;
  } catch (e) {
    logger.warn(`Could not read the short name of project ${projectId}: ${e}`);
  }
  try {
    const titleFormat = await papi.localization.getLocalizedString({
      localizeKey: '%interlinearizer_tabTitle%',
    });
    return formatReplacementString(titleFormat, { projectName });
  } catch (e) {
    logger.warn(`Could not read the tab title format: ${e}`);
    return baseTabTitle;
  }
}

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
      title: projectId ? await getTabTitle(projectId) : baseTabTitle,
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
    heldBook: (sourceProjectId, bookId, segmentation) =>
      bookService.heldBook(sourceProjectId, bookId, segmentation && JSON.stringify(segmentation)),
    getOpenVerseBook: bookService.getOpenVerseBook,
    reportChange: (change) => emitter.emit(change),
  });
}

// #endregion

// #region Command handlers

/**
 * Opens the Interlinearizer WebView for the given project. If no projectId is provided, shows a
 * project picker dialog. Each project gets its own tab; reopening an already-open project brings
 * that tab to front.
 *
 * @returns The WebView ID of the opened (or focused) tab, or `undefined` if the user cancels.
 * @throws If `papi.dialogs.selectProject` rejects (e.g. platform error while showing the dialog).
 * @throws If `papi.webViews.openWebView` rejects (e.g. the platform cannot open or focus the tab).
 */
async function openInterlinearizer(projectId?: string): Promise<string | undefined> {
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
  return papi.webViews.openWebView(mainWebViewType, undefined, options);
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
  const active = state?.activeProject;
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

/**
 * Opens the Interlinearizer for the project associated with the given WebView. Called from the
 * WebView context menu, which passes the tab's WebView ID as the argument.
 *
 * @param webViewId - ID of an open WebView whose project to use; if omitted falls back to a picker.
 * @returns The WebView ID of the opened (or focused) tab, or `undefined` if the user cancels.
 * @throws If `papi.webViews.getOpenWebViewDefinition` rejects.
 * @throws If the project picker dialog or the WebView open fails.
 */
async function openInterlinearizerForWebView(webViewId?: string): Promise<string | undefined> {
  if (!webViewId) return openInterlinearizer();
  const webViewDefinition = await papi.webViews.getOpenWebViewDefinition(webViewId);
  return openInterlinearizer(webViewDefinition?.projectId);
}

/**
 * Creates a new interlinearizer project for the given source project. Called from the WebView via
 * `papi.commands.sendCommand` after the user fills in the create-project modal. Returns the
 * persisted project serialized as a JSON string.
 *
 * @param sourceProjectId - Platform.Bible project ID of the source text to interlinearize.
 * @param analysisLanguages - BCP 47 tags for languages used in glosses and annotations (e.g.
 *   `['en']`). Required and must be non-empty.
 * @param targetProjectId - Optional Platform.Bible project ID of the target text for bilateral
 *   alignment projects. Omit for analysis-only projects.
 * @param name - Optional user-facing name for the project.
 * @param description - Optional user-facing description for the project.
 * @throws If storage fails. The error is logged and an error notification is sent before rethrowing
 *   so the frontend `catch` block can suppress it without sending a second notification.
 */
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
    return JSON.stringify(project);
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

/**
 * Deletes an interlinearizer project by UUID. No-ops silently if the project does not exist. Called
 * from the WebView via `papi.commands.sendCommand` when the user deletes a project from the
 * select-project modal.
 *
 * @throws {SyntaxError} If the stored project summaries contain invalid JSON.
 * @throws {Error} If the stored project summaries were written by a newer build, or are corrupt.
 * @throws If `papi.storage.readUserData` rejects for a non-ENOENT reason while reading the
 *   summaries, or if `papi.storage.writeUserData` rejects when updating them. All storage errors
 *   are logged and shown as a notification before being re-thrown so the caller can handle failure
 *   UX.
 */
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

/**
 * Updates the metadata of an existing interlinearizer project. Called from the WebView when the
 * user saves edits in the project info modal.
 *
 * @param interlinearProjectId - UUID of the interlinearizer project to update.
 * @param name - New user-facing name, or `undefined` to clear it.
 * @param description - New user-facing description, or `undefined` to clear it.
 * @param analysisLanguages - New BCP 47 analysis language tags. Required and must be non-empty;
 *   pass the current value to leave it unchanged.
 * @param targetProjectId - New target-project ID; omit to clear the target binding.
 * @returns The updated project as a JSON string, or `undefined` if no project with the given ID
 *   exists.
 * @throws If storage fails. The error is logged and an error notification is sent before rethrowing
 *   so the frontend `catch` block can suppress it without sending a second notification.
 */
async function updateProjectMetadata(
  interlinearProjectId: string,
  name: string | undefined,
  description: string | undefined,
  analysisLanguages: string[],
  targetProjectId?: string,
): Promise<string | undefined> {
  try {
    const updated = await projectStorage.updateProjectMetadata(
      executionToken,
      interlinearProjectId,
      name,
      description,
      analysisLanguages,
      targetProjectId,
    );
    return updated ? JSON.stringify(updated) : undefined;
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
 * Imports or syncs the source project's Paratext 9 interlinear data and returns the run's outcome
 * as a JSON string. A run that keeps the stored import sends a warning notification. A first import
 * that converts nothing sends an error notification but still returns, so the caller can name the
 * files that it left out.
 *
 * @param sourceProjectId - Platform.Bible project ID whose Paratext 9 interlinear files to import.
 * @throws If the import fails or the source has nothing to import. The error is logged and an error
 *   notification is sent before rethrowing so the frontend `catch` block can suppress it without
 *   sending a second notification.
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

/**
 * Creates an editable copy of a Paratext 9 import project. Returns the created project as a JSON
 * string.
 *
 * @param interlinearProjectId - UUID of the Paratext 9 import to copy.
 * @param name - User-facing name for the copy, chosen in the copy dialog.
 * @param description - Optional user-facing description for the copy.
 * @throws If the project does not exist, is not a Paratext 9 import, or storage fails. The error is
 *   logged and an error notification is sent before rethrowing so the frontend `catch` block can
 *   suppress it without sending a second notification.
 */
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
    return JSON.stringify(project);
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
 * Loads the interlinearizer project with the given ID, including its full `TextAnalysis`. The
 * WebView calls this when the active project changes to load the stored analysis into the
 * interlinearizer.
 *
 * @param interlinearProjectId - UUID of the interlinearizer project to fetch.
 * @returns JSON-stringified `InterlinearProject`, or `undefined` if no project with that ID exists.
 * @throws {SyntaxError} If the project's storage value contains invalid JSON.
 * @throws {Error} If the stored record was written by a newer build.
 * @throws If `papi.storage.readUserData` rejects for a non-ENOENT reason. The error is logged
 *   before rethrowing.
 */
async function getInterlinearProject(interlinearProjectId: string): Promise<string | undefined> {
  try {
    const project = await projectStorage.getProject(executionToken, interlinearProjectId);
    return project ? JSON.stringify(project) : undefined;
  } catch (e) {
    logger.error('Interlinearizer: failed to get project', e);
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
 * Copies the source project's stored draft into an existing interlinearizer project: Save, and Save
 * As onto an existing project. The copy runs after the session's earlier edits. A draft that cannot
 * be read for some book is not copied, and the user is told which books and how to recover.
 *
 * @param sessionId - The session editing the draft. The copy runs in the session's turn, and the
 *   session's history marks the draft saved.
 * @param sourceProjectId - Platform.Bible source project ID whose draft to copy.
 * @param interlinearProjectId - UUID of the interlinearizer project to save into.
 * @param config - The configuration to set on the project in the same write; omit to leave the
 *   project's configuration unchanged.
 * @returns The saved project's `InterlinearProjectSummary` (carrying the refreshed `updatedAt`) as
 *   a JSON string, or `undefined` if no project with the given ID exists.
 * @throws If `sessionId` names no open session, if the draft cannot be read for some book, if the
 *   project is a Paratext 9 import, which is read-only, if the stored draft is unreadable, or if
 *   storage fails. The error is logged and an error notification is sent before rethrowing.
 */
async function saveDraftToProject(
  sessionId: string,
  sourceProjectId: string,
  interlinearProjectId: string,
  config?: ProjectConfig,
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
 * Creates an interlinearizer project holding a copy of the source project's stored draft: Save As
 * to a new project. The copy runs after the session's earlier edits. A book of the draft that
 * cannot be read is left out, and the user is told which.
 *
 * @param sessionId - The session editing the draft. The copy runs in the session's turn, and when
 *   no book is left out, the session's history marks the draft saved.
 * @param sourceProjectId - Platform.Bible source project ID whose draft to copy.
 * @param analysisLanguages - BCP 47 tags for the new project's analysis languages.
 * @param targetProjectId - Optional Platform.Bible project ID of the target text.
 * @param name - Optional user-facing name for the project.
 * @param description - Optional user-facing description for the project.
 * @returns The created project's summary and the books it left out, as a JSON
 *   {@link SavedAsProject}.
 * @throws If `sessionId` names no open session, the stored draft is unreadable, or storage fails.
 *   The error is logged and an error notification is sent before rethrowing.
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

/**
 * Returns a book of the source project tokenized under the project's language tag.
 *
 * @returns The tokenized `Book` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book cannot be read or tokenized. The error is logged before rethrowing.
 */
async function getTokenizedBook(
  sourceProjectId: string,
  bookId: string,
): Promise<string | undefined> {
  try {
    return await perfTimeAsync('getTokenizedBook', () =>
      bookService.getTokenizedBook(sourceProjectId, bookId),
    );
  } catch (e) {
    logger.error(
      `Interlinearizer: failed to tokenize book ${bookId} of project ${sourceProjectId}`,
      e,
    );
    throw e;
  }
}

/** The session that a page or text-read command reads. */
type SessionAddress = Readonly<{ sessionId: string }>;

/** The boundaries the session's draft sets in the book, as JSON; `undefined` when it sets none. */
async function sessionBoundaries(session: Session, bookId: string): Promise<string | undefined> {
  return bookSegmentationJson((await session.repository.getScope()).segmentation, bookId);
}

/**
 * Outlines a book of a session's source, segmented by the draft's boundaries, counting each
 * segment's orphaned free-translation cards. Before the outline, the draft is re-anchored to the
 * book's text unless the session last re-anchored the book to the same text. A failed re-anchor is
 * logged.
 *
 * @returns The `BookOutline` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book cannot be read or segmented, the session is not open, or its analysis cannot
 *   be read. The error is logged before rethrowing.
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
          await sessionBoundaries(session, bookId),
        );
        if (!book) return undefined;
        const outline = await readBookOutline(session.repository, book);
        return perfTime('getBookOutline:serialize', () => JSON.stringify(outline));
      });
    });
  } catch (e) {
    logger.error(`Interlinearizer: failed to outline book ${bookId} of session ${sessionId}`, e);
    throw e;
  }
}

/**
 * Serves the segments at outline indexes `[start, end)` of a book of a session's source, segmented
 * by the draft's boundaries, with the analysis that the draft holds for them.
 *
 * @returns The `SegmentPage` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book cannot be read or segmented, the session is not open, or its analysis cannot
 *   be read. The error is logged before rethrowing.
 */
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
          await sessionBoundaries(session, bookId),
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
 * Reports how far reading the whole text of a session's source has got, starting the session's read
 * when it has none. While session reads are skipped, the read never finishes.
 *
 * @returns Once the text's books are known, the `TextReadStatus` as JSON.
 * @throws If the books or the provider of their text cannot be got, or the session is not open. The
 *   error is logged before rethrowing.
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

/**
 * Starts the source project's draft over from `from`, closing the source's session first. A session
 * opened afterward has nothing to undo. Stored analysis that could not be read is discarded.
 *
 * @throws As {@link startedDraft} does, and if closing the session or writing the draft fails. The
 *   error is logged and an error notification is sent before rethrowing; the stored draft is left
 *   as it was.
 */
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

/**
 * Returns the summary of the interlinearizer project with the given ID, without its analysis.
 *
 * @returns JSON-stringified `InterlinearProjectSummary`, or `undefined` if no project with that ID
 *   is listed.
 * @throws As {@link projectStorage.getProjectSummary} does. The error is logged before rethrowing.
 */
async function getProjectSummary(interlinearProjectId: string): Promise<string | undefined> {
  try {
    const summary = await projectStorage.getProjectSummary(executionToken, interlinearProjectId);
    return summary ? JSON.stringify(summary) : undefined;
  } catch (e) {
    logger.error('Interlinearizer: failed to get the project summary', e);
    throw e;
  }
}

/** A parameter in a command's documentation. */
type ParamDoc = Extract<MethodDocumentationWithoutName['params'][number], { name: string }>;

/** The one argument that the command `C` takes. */
type ArgsOf<C extends keyof CommandHandlers> = Parameters<CommandHandlers[C]>[0];

/**
 * Opens a session read-only on the Paratext 9 import `importProjectId` when given, otherwise on the
 * source project's draft, which saves to `interlinearProjectId` when given. When the source has no
 * project of the id named, the session opens on the draft, which then saves to no project. A draft
 * that holds analysis is then marked unsaved, unless the missing project was an import. Closes the
 * source's earlier session, if any. Warns the user of each book whose stored analysis could not be
 * read.
 *
 * @returns A JSON string of an {@link OpenedSession}.
 * @throws If both ids are given, an id names a project of the wrong kind, or finding the project,
 *   loading the analysis, or marking the draft unsaved fails. The error is logged before
 *   rethrowing.
 */
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

/**
 * Sets the language a session's glosses are read and written in.
 *
 * @throws If the session is not open. The error is logged before rethrowing.
 */
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

/**
 * Sets which project a session's draft saves to, if any.
 *
 * @throws If the session is read-only or not open, the project is missing or an import, or reading
 *   the source's projects fails. The error is logged before rethrowing.
 */
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

/**
 * Leaves a session's draft with no project to save to, once its project is deleted.
 *
 * @throws If the session is read-only or not open, or reading the draft or marking it unsaved
 *   fails. The error is logged before rethrowing.
 */
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

/**
 * Reverts a session's latest edit not yet undone.
 *
 * @returns A JSON string of the {@link CommandReply}, or `undefined` when there is none.
 * @throws If the session is read-only or not open, or the undo fails. The error is logged before
 *   rethrowing.
 */
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

/**
 * Redoes a session's latest undone edit.
 *
 * @returns A JSON string of the {@link CommandReply}, or `undefined` when there is none.
 * @throws If the session is read-only or not open, or the redo fails. The error is logged before
 *   rethrowing.
 */
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

/**
 * Reports where a session's derived indexes differ from ones built afresh from its records, for
 * debugging. Also reports where its stored shards differ from its records.
 *
 * @returns A JSON string of the differences; `"[]"` when there are none.
 * @throws If the session is not open, the stored draft is not valid JSON, or storage rejects a
 *   read. The error is logged before rethrowing.
 */
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

/**
 * Reads a session's whole draft, its scope and analysis, as the session's repository holds it. A
 * bridge until the WebView reads only pages. When the draft lists no analysis language, the reply
 * lists the session's; the session's first edit stores it.
 *
 * @returns A JSON string of the `DraftProject`.
 * @throws If the session is not open, or its analysis cannot be loaded. The error is logged before
 *   rethrowing.
 */
async function getFullAnalysis({
  sessionId,
}: ArgsOf<'interlinearizer.getFullAnalysis'>): Promise<string> {
  try {
    return JSON.stringify(
      await sessions.run(sessionId, async ({ repository, analysisLanguage }) => {
        const draft = await repository.getWholeDraft();
        return draft.analysisLanguages.length > 0
          ? draft
          : { ...draft, analysisLanguages: [analysisLanguage] };
      }),
    );
  } catch (e) {
    logger.error(`Interlinearizer: failed to read the whole draft of session ${sessionId}`, e);
    throw e;
  }
}

/**
 * Returns a summary of every interlinearizer project for the given source project as a JSON string.
 * The WebView deserializes this to populate its project picker and to decide whether to prompt
 * "create new" or "select existing" when the user opens the project menu.
 *
 * Neither the read nor the response grows with the size of the projects' analyses.
 *
 * @param sourceProjectId - Platform.Bible project ID of the source text to query.
 * @throws {SyntaxError} If the stored project summaries contain invalid JSON.
 * @throws {Error} If the stored project summaries were written by a newer build, or are corrupt.
 * @throws If `papi.storage.readUserData` rejects for a non-ENOENT reason. Callers can use this to
 *   distinguish a storage outage from a legitimately empty list.
 */
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
      )
      .then(() =>
        emitter.emit({ sourceProjectId, changeId: crypto.randomUUID(), scriptureEdit: { bookId } }),
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

  const mainWebViewProviderRegistration = await papi.webViewProviders.registerWebViewProvider(
    mainWebViewType,
    mainWebViewProvider,
  );

  const openForWebViewCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openForWebView',
    openInterlinearizerForWebView,
    {
      method: {
        summary: 'Open the Interlinearizer for the project associated with a WebView',
        params: [
          {
            name: 'webViewId',
            required: false,
            summary: 'The WebView ID whose project to open; if omitted a picker dialog is shown',
            schema: { type: 'string' },
          },
        ],
        // `undefined` (returned on cancel) is not a JSON type and cannot appear in a JSON-RPC
        // response, so the schema only describes the shape when a value is present.
        result: {
          name: 'return value',
          summary: 'The ID of the opened WebView, if opened; omitted when the user cancels',
          schema: { type: 'string' },
        },
      },
    },
  );

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

  const continuousScrollValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.continuousScroll',
    isBoolean,
  );

  const showMorphologyValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.showMorphology',
    isBooleanOrAuto,
  );

  const showFreeTranslationValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.showFreeTranslation',
    isBooleanOrAuto,
  );

  const createProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.createProject',
    createInterlinearProject,
    {
      method: {
        summary: 'Create a new interlinearizer project',
        params: [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible project ID of the source text to interlinearize',
            schema: { type: 'string' },
          },
          {
            name: 'analysisLanguages',
            required: true,
            summary:
              'BCP 47 tags for gloss / annotation languages (e.g. ["en"]); must be non-empty',
            schema: { type: 'array', items: { type: 'string' } },
          },
          {
            name: 'targetProjectId',
            required: false,
            summary:
              'Optional Platform.Bible project ID of the target text for bilateral alignment projects',
            schema: { type: 'string' },
          },
          {
            name: 'name',
            required: false,
            summary: 'Optional user-facing name for the project',
            schema: { type: 'string' },
          },
          {
            name: 'description',
            required: false,
            summary: 'Optional user-facing description for the project',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary:
            'JSON-stringified InterlinearProject for the new project; rejects (throws) on storage failure',
          schema: { type: 'string' },
        },
      },
    },
  );

  const getProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getProject',
    getInterlinearProject,
    {
      method: {
        summary: 'Return the interlinearizer project with the given UUID as a JSON string',
        params: [
          {
            name: 'interlinearProjectId',
            required: true,
            summary: 'UUID of the interlinearizer project to fetch',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'JSON-stringified InterlinearProject, or undefined if not found',
          schema: { type: 'string' },
        },
      },
    },
  );

  const getProjectSummaryCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getProjectSummary',
    getProjectSummary,
    {
      method: {
        summary:
          'Return the summary of the interlinearizer project with the given UUID as a JSON string, without its analysis',
        params: [
          {
            name: 'interlinearProjectId',
            required: true,
            summary: 'UUID of the interlinearizer project to summarize',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'JSON-stringified InterlinearProjectSummary, or undefined if not listed',
          schema: { type: 'string' },
        },
      },
    },
  );

  const saveDraftToProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.saveDraftToProject',
    saveDraftToProject,
    {
      method: {
        summary: "Copy a source project's stored draft into an existing interlinearizer project",
        params: [
          {
            name: 'sessionId',
            required: true,
            summary:
              'The session editing the draft; the copy runs in its turn, and its history marks the draft saved',
            schema: { type: 'string' },
          },
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible project ID whose draft to copy',
            schema: { type: 'string' },
          },
          {
            name: 'interlinearProjectId',
            required: true,
            summary: 'UUID of the interlinearizer project to save into',
            schema: { type: 'string' },
          },
          {
            name: 'config',
            required: false,
            summary:
              "The project's analysis languages and target to set in the same write, a missing target clearing the binding; omit to leave its configuration unchanged",
            schema: {
              type: 'object',
              properties: {
                analysisLanguages: { type: 'array', items: { type: 'string' } },
                targetProjectId: { type: 'string' },
              },
              required: ['analysisLanguages'],
            },
          },
        ],
        result: {
          name: 'return value',
          summary:
            'JSON-stringified project summary with the refreshed updatedAt, or undefined if not found',
          schema: { type: 'string' },
        },
      },
    },
  );

  const saveDraftAsProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.saveDraftAsProject',
    saveDraftAsProject,
    {
      method: {
        summary: "Create an interlinearizer project holding a copy of a source project's draft",
        params: [
          {
            name: 'sessionId',
            required: true,
            summary:
              'The session editing the draft; the copy runs in its turn, and when no book is left out, its history marks the draft saved',
            schema: { type: 'string' },
          },
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible project ID whose draft to copy',
            schema: { type: 'string' },
          },
          {
            name: 'analysisLanguages',
            required: true,
            summary:
              'BCP 47 tags for gloss / annotation languages (e.g. ["en"]); must be non-empty',
            schema: { type: 'array', items: { type: 'string' } },
          },
          {
            name: 'targetProjectId',
            required: false,
            summary:
              'Optional Platform.Bible project ID of the target text for bilateral alignment projects',
            schema: { type: 'string' },
          },
          {
            name: 'name',
            required: false,
            summary: 'Optional user-facing name for the project',
            schema: { type: 'string' },
          },
          {
            name: 'description',
            required: false,
            summary: 'Optional user-facing description for the project',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary:
            "JSON-stringified { project, omittedBooks }: the new project's summary and the books left out of it; rejects (throws) on storage failure",
          schema: { type: 'string' },
        },
      },
    },
  );

  const getProjectsForSourceCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getProjectsForSource',
    getProjectsForSource,
    {
      method: {
        summary: 'Return all interlinearizer projects for a source project as a JSON string',
        params: [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible project ID of the source text to query',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'JSON-stringified InterlinearProjectSummary[] for the given source',
          schema: { type: 'string' },
        },
      },
    },
  );

  const getTokenizedBookCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getTokenizedBook',
    getTokenizedBook,
    {
      method: {
        summary: "Return a source project's book tokenized, as a JSON string",
        params: [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible source project ID whose book to tokenize',
            schema: { type: 'string' },
          },
          {
            name: 'bookId',
            required: true,
            summary: 'Book code, such as GEN',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'JSON-stringified Book, or undefined when the project has no text for the book',
          schema: { type: 'string' },
        },
      },
    },
  );

  /** The parameter naming the session whose source a query reads. */
  const sessionAddressParam = {
    name: 'address',
    required: true as const,
    summary: '{ sessionId } of the session whose source to read',
    schema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string' as const } },
      required: ['sessionId'],
    },
  };

  /** Parameters naming the book a segment query reads. */
  const bookParams = [
    sessionAddressParam,
    {
      name: 'bookId',
      required: true,
      summary: 'Book code, such as GEN',
      schema: { type: 'string' },
    },
  ] as const;

  const getBookOutlineCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getBookOutline',
    getBookOutline,
    {
      method: {
        summary:
          "Return the outline of a book of a session's source, segmented by the draft's boundaries, as a JSON string",
        params: [...bookParams],
        result: {
          name: 'return value',
          summary:
            'JSON-stringified BookOutline, or undefined when the project has no text for the book',
          schema: { type: 'string' },
        },
      },
    },
  );

  const getSegmentsCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getSegments',
    getSegments,
    {
      method: {
        summary:
          "Return a run of the segments of a book of a session's source, with the draft's analysis of them, as a JSON string",
        params: [
          ...bookParams,
          {
            name: 'start',
            required: true,
            summary: 'Outline index of the first segment to return',
            schema: { type: 'integer' },
          },
          {
            name: 'end',
            required: true,
            summary: 'Outline index after the last segment to return',
            schema: { type: 'integer' },
          },
        ],
        result: {
          name: 'return value',
          summary:
            'JSON-stringified SegmentPage, or undefined when the project has no text for the book',
          schema: { type: 'string' },
        },
      },
    },
  );

  const getTextReadStatusCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getTextReadStatus',
    getTextReadStatus,
    {
      method: {
        summary:
          "Return how far reading a session's whole source text has got, starting the session's read when it has none, as a JSON string",
        params: [sessionAddressParam],
        result: {
          name: 'return value',
          summary: 'JSON-stringified TextReadStatus',
          schema: { type: 'string' },
        },
      },
    },
  );

  const startDraftOverCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.startDraftOver',
    startDraftOver,
    {
      method: {
        summary:
          "Start a source project's draft over, from a stored project or empty, closing the source's session first",
        params: [
          {
            name: 'args',
            required: true,
            summary: 'The source project, and what its draft starts over from',
            schema: {
              type: 'object',
              properties: {
                sourceProjectId: {
                  description: 'Platform.Bible source project ID whose draft to start over',
                  type: 'string',
                },
                from: {
                  description:
                    'Either { interlinearProjectId } to copy a stored project (Open), or the New configuration { analysisLanguages, suggestedDescription? }',
                  type: 'object',
                },
              },
              required: ['sourceProjectId', 'from'],
            },
          },
        ],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  /** The field naming the session that a session command acts on. */
  const sessionIdParam = {
    name: 'sessionId',
    required: true,
    summary: 'ID of the session, as openSession returned it',
    schema: { type: 'string' },
  } as const;

  /** The field naming the change that a session command makes. */
  const changeIdParam = {
    name: 'changeId',
    required: false,
    summary:
      'Names the change; a command sent again under the id of a change the session has applied replies as it did then, applying nothing. Omit to have the session name it',
    schema: { type: 'string' },
  } as const;

  /** Documents a command's one argument, an object holding `fields`. */
  const argsParam = (summary: string, fields: ParamDoc[]): ParamDoc[] => [
    {
      name: 'args',
      required: true,
      summary,
      schema: {
        type: 'object',
        properties: Object.fromEntries(
          fields.map(({ name, summary: description, schema }) => [
            name,
            { description, ...schema },
          ]),
        ),
        required: fields.filter(({ required }) => required).map(({ name }) => name),
      },
    },
  ];

  /** Documents a session command's one argument, which holds `fields` beside `sessionId`. */
  const sessionArgs = (...fields: ParamDoc[]) =>
    argsParam("The session, and the command's own fields", [sessionIdParam, ...fields]);

  const openSessionCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openSession',
    openSession,
    {
      method: {
        summary:
          "Open a session on a source project's draft, or read-only on its Paratext 9 import, closing the source's earlier session",
        params: argsParam('The source project, and the interlinear project to open with it', [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible source project ID whose analysis to open',
            schema: { type: 'string' },
          },
          {
            name: 'interlinearProjectId',
            required: false,
            summary: 'UUID of the interlinear project the draft saves to; omit for the draft alone',
            schema: { type: 'string' },
          },
          {
            name: 'importProjectId',
            required: false,
            summary: 'UUID of the Paratext 9 import to read instead of the draft',
            schema: { type: 'string' },
          },
        ]),
        result: {
          name: 'return value',
          summary: 'JSON-stringified OpenedSession',
          schema: { type: 'string' },
        },
      },
    },
  );

  const closeSessionCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.closeSession',
    ({ sessionId }: ArgsOf<'interlinearizer.closeSession'>) => sessions.close(sessionId),
    {
      method: {
        summary: 'Close a session once the commands sent to it settle',
        params: sessionArgs(),
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const setAnalysisLanguageCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.setAnalysisLanguage',
    setAnalysisLanguage,
    {
      method: {
        summary: "Set the language a session's glosses are read and written in",
        params: sessionArgs({
          name: 'analysisLanguage',
          required: true,
          summary: 'BCP 47 tag of the language',
          schema: { type: 'string' },
        }),
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const setSaveTargetCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.setSaveTarget',
    setSaveTarget,
    {
      method: {
        summary: "Set which project a session's draft saves to, if any",
        params: sessionArgs({
          name: 'interlinearProjectId',
          required: false,
          summary: 'The interlinear project to save to; absent for none',
          schema: { type: 'string' },
        }),
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const detachFromProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.detachFromProject',
    detachFromProject,
    {
      method: {
        summary: "Leave a session's draft with no project to save to, once its project is deleted",
        params: sessionArgs(),
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  /** The result of a command that replies with the changes it applied, if any. */
  const appliedChangesResult = {
    name: 'return value',
    summary:
      'JSON-stringified CommandReply: the ChangeSet the undo or redo applied and the pool buckets it touched; omitted when there was nothing to apply',
    schema: { type: 'string' },
  } as const;

  const undoEditCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.undoEdit',
    undoEdit,
    {
      method: {
        summary: "Revert a session's latest edit not yet undone",
        params: sessionArgs(changeIdParam),
        result: appliedChangesResult,
      },
    },
  );

  const redoEditCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.redoEdit',
    redoEdit,
    {
      method: {
        summary: "Make a session's latest undone edit again",
        params: sessionArgs(changeIdParam),
        result: appliedChangesResult,
      },
    },
  );

  /** The fields giving the token that a token edit acts on, and that token's current text. */
  const tokenParams = [
    {
      name: 'tokenRef',
      required: true,
      summary: 'Token.ref of the token edited',
      schema: { type: 'string' },
    },
    {
      name: 'surfaceText',
      required: true,
      summary: "The token's current surface text",
      schema: { type: 'string' },
    },
  ] as const;

  const editResult = {
    name: 'return value',
    summary:
      'JSON-stringified CommandReply: the ChangeSet the edit applied and the pool buckets it touched',
    schema: { type: 'string' },
  } as const;

  const sessionCommands = { ...edits, ...catalog };
  const sessionRegistrations: UnsubscriberAsync[] = [];

  /** Registers the session command `commandName`, served by its edit or catalog handler. */
  async function registerSessionCommand(
    commandName: keyof typeof sessionCommands,
    method: MethodDocumentationWithoutName,
  ): Promise<void> {
    sessionRegistrations.push(
      await papi.commands.registerCommand(commandName, sessionCommands[commandName], { method }),
    );
  }

  await registerSessionCommand('interlinearizer.writeGloss', {
    summary: "Write a token's gloss in a session's analysis language; a blank value clears it",
    params: sessionArgs(
      ...tokenParams,
      {
        name: 'value',
        required: true,
        summary: 'The gloss',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.approveAnalysisForToken', {
    summary: 'Approve a stored token analysis for a token, in place of any approval the token held',
    params: sessionArgs(
      ...tokenParams,
      {
        name: 'analysisId',
        required: true,
        summary: 'Id of the stored token analysis to approve',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.writeMorphemes', {
    summary: "Write a token's morpheme breakdown",
    params: sessionArgs(
      ...tokenParams,
      {
        name: 'forms',
        required: true,
        summary: 'The morpheme forms, in order',
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'writingSystem',
        required: true,
        summary: 'BCP 47 tag of the writing system the forms are in',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.deleteMorphemes', {
    summary: "Remove a token's morpheme breakdown",
    params: sessionArgs(tokenParams[0], changeIdParam),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.writeMorphemeGloss', {
    summary:
      "Gloss one morpheme of a token's breakdown in a session's analysis language; a blank value clears the morpheme's gloss",
    params: sessionArgs(
      tokenParams[0],
      {
        name: 'morphemeId',
        required: true,
        summary: 'MorphemeAnalysis.id of the morpheme glossed',
        schema: { type: 'string' },
      },
      {
        name: 'value',
        required: true,
        summary: 'The gloss',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  const staleAnalysisParam = {
    name: 'analysisId',
    required: true,
    summary: 'Id of the token analysis the stale link names',
    schema: { type: 'string' },
  } as const;

  await registerSessionCommand('interlinearizer.discardStaleAnalysis', {
    summary: 'Give up the place an analysis went stale at, leaving its other places alone',
    params: sessionArgs(
      staleAnalysisParam,
      {
        name: 'tokenRef',
        required: true,
        summary: 'Token.ref the stale link names',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.reapplyStaleAnalysis', {
    summary:
      'Move an analysis from a place it went stale at onto a token, approving it there in place of whatever the token held',
    params: sessionArgs(
      staleAnalysisParam,
      {
        name: 'staleTokenRef',
        required: true,
        summary: 'Token.ref the stale link names',
        schema: { type: 'string' },
      },
      ...tokenParams,
      changeIdParam,
    ),
    result: editResult,
  });

  const staleTranslationParam = {
    name: 'analysisId',
    required: true,
    summary: 'Id of the stale segment analysis',
    schema: { type: 'string' },
  } as const;

  await registerSessionCommand('interlinearizer.keepStaleFreeTranslation', {
    summary:
      "Keep a stale free translation as a claim about a segment's current text, approving it for that segment",
    params: sessionArgs(
      staleTranslationParam,
      {
        name: 'segmentId',
        required: true,
        summary: 'Segment.id of the segment it is kept for',
        schema: { type: 'string' },
      },
      {
        name: 'surfaceText',
        required: true,
        summary: "The segment's current baseline text",
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.discardStaleFreeTranslation', {
    summary: 'Drop a stale free translation, one whose verse the book no longer holds included',
    params: sessionArgs(staleTranslationParam, changeIdParam),
    result: editResult,
  });

  /** The field naming the token analysis that a catalog-wide edit acts on. */
  const catalogAnalysisParam = {
    name: 'analysisId',
    required: true,
    summary: 'Id of the token analysis edited, for every token linked to it',
    schema: { type: 'string' },
  } as const;

  const analysisIdsParam = {
    name: 'analysisIds',
    required: true,
    summary: 'Ids of the token analyses',
    schema: { type: 'array', items: { type: 'string' } },
  } as const;

  await registerSessionCommand('interlinearizer.writeAnalysisGloss', {
    summary:
      "Write a token analysis's gloss in a session's analysis language, for every token linked to it; a blank value clears it",
    params: sessionArgs(
      catalogAnalysisParam,
      { name: 'value', required: true, summary: 'The gloss', schema: { type: 'string' } },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.clearAnalysisGlosses', {
    summary: "Clear the glosses of several token analyses in a session's analysis language",
    params: sessionArgs(analysisIdsParam, changeIdParam),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.writeAnalysisMorphemes', {
    summary:
      "Re-split a token analysis's breakdown, for every token linked to it; no forms removes the breakdown",
    params: sessionArgs(
      catalogAnalysisParam,
      {
        name: 'forms',
        required: true,
        summary: "The breakdown's forms in order",
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'writingSystem',
        required: true,
        summary: 'Writing system the morphemes are tagged with',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.confirmAnalysisMorphemes', {
    summary: "Keep a token analysis's stale breakdown as it stands, for every token linked to it",
    params: sessionArgs(
      catalogAnalysisParam,
      {
        name: 'tokenRef',
        required: false,
        summary:
          "Token.ref the undo step is placed at; omit to name the analysis's catalog row instead",
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.writeAnalysisMorphemeGloss', {
    summary:
      "Write the gloss of one morpheme of a token analysis in a session's analysis language, for every token linked to it; a blank value clears it",
    params: sessionArgs(
      catalogAnalysisParam,
      {
        name: 'morphemeId',
        required: true,
        summary: 'MorphemeAnalysis.id of the morpheme glossed',
        schema: { type: 'string' },
      },
      { name: 'value', required: true, summary: 'The gloss', schema: { type: 'string' } },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.deleteAnalyses', {
    summary: 'Remove token analyses with every token link to them',
    params: sessionArgs(analysisIdsParam, changeIdParam),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.mergeAnalysesInto', {
    summary:
      "Fold token analyses into a survivor and write the settled content onto it, in a session's analysis language",
    params: sessionArgs(
      {
        name: 'survivorAnalysisId',
        required: true,
        summary: 'Id of the token analysis kept',
        schema: { type: 'string' },
      },
      {
        name: 'mergedAnalysisIds',
        required: true,
        summary: 'Ids of the token analyses folded in, most-preferred first',
        schema: { type: 'array', items: { type: 'string' } },
      },
      {
        name: 'content',
        required: true,
        summary: 'MergedContent the survivor says once the merge settles',
        schema: { type: 'object' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  /** The field naming the phrase occurrence that a phrase edit acts on. */
  const phraseIdParam = {
    name: 'phraseId',
    required: true,
    summary: 'PhraseAnalysisLink.id of the phrase occurrence edited',
    schema: { type: 'string' },
  } as const;

  const tokenSnapshotsSchema = {
    type: 'array' as const,
    items: {
      type: 'object' as const,
      properties: {
        tokenRef: { type: 'string' as const },
        surfaceText: { type: 'string' as const },
      },
      required: ['tokenRef', 'surfaceText'],
    },
  };

  await registerSessionCommand('interlinearizer.createPhrase', {
    summary:
      'Add an approved phrase occurrence, sharing a content-identical stored payload where one exists',
    params: sessionArgs(
      {
        name: 'tokens',
        required: true,
        summary: "The phrase's token snapshots, in document order",
        schema: tokenSnapshotsSchema,
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.updatePhrase', {
    summary: 'Give a phrase occurrence a new token run, keeping its gloss; an empty run removes it',
    params: sessionArgs(
      phraseIdParam,
      {
        name: 'tokens',
        required: true,
        summary: 'The new token snapshots, in document order',
        schema: tokenSnapshotsSchema,
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.deletePhrase', {
    summary: 'Remove a phrase occurrence, with its payload unless another occurrence shares it',
    params: sessionArgs(phraseIdParam, changeIdParam),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.mergePhrases', {
    summary:
      'Grow a phrase occurrence to a merged token run, removing the absorbed occurrence when named',
    params: sessionArgs(
      {
        name: 'targetPhraseId',
        required: true,
        summary: 'PhraseAnalysisLink.id of the phrase occurrence that grows',
        schema: { type: 'string' },
      },
      {
        name: 'tokens',
        required: true,
        summary: 'The merged token snapshots, in document order',
        schema: tokenSnapshotsSchema,
      },
      {
        name: 'absorbedPhraseId',
        required: false,
        summary:
          'PhraseAnalysisLink.id of the neighboring occurrence merged in; omit when the neighbor is in no phrase',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.writePhraseGloss', {
    summary:
      "Write a phrase occurrence's gloss in a session's analysis language; a blank value clears it",
    params: sessionArgs(
      phraseIdParam,
      {
        name: 'value',
        required: true,
        summary: 'The gloss',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.approvePhrase', {
    summary: 'Approve a phrase occurrence, unless any of its tokens is in an approved phrase',
    params: sessionArgs(phraseIdParam, changeIdParam),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.splitPhrase', {
    summary:
      "Split a phrase occurrence just after a token, in the document order of the token's book",
    params: sessionArgs(
      phraseIdParam,
      {
        name: 'splitAfterTokenRef',
        required: true,
        summary: 'Token.ref of the token the first half ends with',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.writeSegmentFreeTranslation', {
    summary:
      "Write a segment's free translation in a session's analysis language; a blank value clears it",
    params: sessionArgs(
      {
        name: 'segmentId',
        required: true,
        summary: 'Segment.id of the segment translated',
        schema: { type: 'string' },
      },
      {
        name: 'surfaceText',
        required: true,
        summary: "The segment's current baseline text",
        schema: { type: 'string' },
      },
      {
        name: 'value',
        required: true,
        summary: 'The free translation',
        schema: { type: 'string' },
      },
      {
        name: 'adoptStaleAnalysisId',
        required: false,
        summary:
          'Id of the stale translation the value was typed over, adopted when the segment has no approved one; omit when there is none',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.mergeSegments', {
    summary: 'Merge the segment beginning at a token into the one before it',
    params: sessionArgs(
      {
        name: 'secondSegmentStartRef',
        required: true,
        summary: 'Token.ref of the first token of the segment merged away',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.splitSegment', {
    summary:
      'Split a segment so a new one begins at a token, first splitting every approved phrase the boundary would cut',
    params: sessionArgs(
      {
        name: 'tokenRef',
        required: true,
        summary: 'Token.ref of the token the new segment begins with',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  await registerSessionCommand('interlinearizer.moveBoundary', {
    summary:
      'Move a segment boundary from one token to another, first splitting every approved phrase the moved boundary would cut',
    params: sessionArgs(
      {
        name: 'fromRef',
        required: true,
        summary: 'Token.ref of the token that stops beginning a segment',
        schema: { type: 'string' },
      },
      {
        name: 'toRef',
        required: true,
        summary: 'Token.ref of the token that begins a segment instead',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: editResult,
  });

  const discardResult = {
    name: 'return value',
    summary:
      'JSON-stringified CommandReply with hasFreeTranslations: the ChangeSet the discard applied and the pool buckets it touched; whether any segment of the draft the discard leaves has a free translation',
    schema: { type: 'string' },
  } as const;

  await registerSessionCommand('interlinearizer.discardBook', {
    summary:
      "Discard the unsaved changes to one book of a session's draft, restoring what the project it saves to holds for the book",
    params: sessionArgs(
      {
        name: 'bookCode',
        required: true,
        summary: 'Three-letter code of the book discarded',
        schema: { type: 'string' },
      },
      changeIdParam,
    ),
    result: discardResult,
  });

  await registerSessionCommand('interlinearizer.discardAll', {
    summary:
      "Discard every unsaved change to a session's draft, restoring what the project it saves to holds",
    params: sessionArgs(changeIdParam),
    result: discardResult,
  });

  await registerSessionCommand('interlinearizer.previewRemovals', {
    summary: "Name the token analyses a command would remove from a session's draft",
    params: sessionArgs({
      name: 'request',
      required: true,
      summary: 'RemovalPreviewRequest naming the command by intent, with its arguments',
      schema: { type: 'object' },
    }),
    result: {
      name: 'return value',
      summary: 'JSON-stringified ids of the token analyses; "[]" when it would remove none',
      schema: { type: 'string' },
    },
  });

  const currentBookParam = {
    name: 'currentBook',
    required: true,
    summary: 'Book code the per-book usage count is taken against',
    schema: { type: 'string' },
  } as const;

  const catalogRowsResult = {
    name: 'return value',
    summary: "JSON-stringified CatalogRow[], each row's books listed",
    schema: { type: 'string' },
  } as const;

  await registerSessionCommand('interlinearizer.getCatalogRows', {
    summary: "Serve one page of a session's analysis catalog, with the filter choices to offer",
    params: sessionArgs({
      name: 'request',
      required: true,
      summary: 'CatalogRowsRequest naming the search, sort, filters, page and current book',
      schema: { type: 'object' },
    }),
    result: {
      name: 'return value',
      summary: "JSON-stringified CatalogPage, each row's books listed",
      schema: { type: 'string' },
    },
  });

  await registerSessionCommand('interlinearizer.getSelectionSummary', {
    summary:
      "Summarize the selected analyses of a session's draft: their use count, the glossed ones, and the merge they allow",
    params: sessionArgs({
      name: 'analysisIds',
      required: true,
      summary: 'IDs of the selected token analyses, in listing order',
      schema: { type: 'array', items: { type: 'string' } },
    }),
    result: {
      name: 'return value',
      summary: 'JSON-stringified SelectionSummary',
      schema: { type: 'string' },
    },
  });

  await registerSessionCommand('interlinearizer.countUsages', {
    summary: "Count the distinct tokens in a session's draft that approve any of the analyses",
    params: sessionArgs({
      name: 'analysisIds',
      required: true,
      summary: 'IDs of the token analyses',
      schema: { type: 'array', items: { type: 'string' } },
    }),
    result: { name: 'return value', summary: 'How many tokens', schema: { type: 'number' } },
  });

  await registerSessionCommand('interlinearizer.getCatalogRowsByIds', {
    summary: "Serve the catalog rows of the named analyses in a session's draft, in that order",
    params: sessionArgs(currentBookParam, {
      name: 'analysisIds',
      required: true,
      summary: 'IDs of the token analyses; an unstored one is left out',
      schema: { type: 'array', items: { type: 'string' } },
    }),
    result: catalogRowsResult,
  });

  await registerSessionCommand('interlinearizer.getHomographRows', {
    summary:
      "Serve the catalog rows in a session's draft sharing an analysis's normalized surface form, most used first",
    params: sessionArgs(currentBookParam, {
      name: 'analysisId',
      required: true,
      summary: 'ID of the token analysis',
      schema: { type: 'string' },
    }),
    result: {
      name: 'return value',
      summary: `JSON-stringified CatalogRow[], each row's books listed; "[]" when no analysis carries the id`,
      schema: { type: 'string' },
    },
  });

  await registerSessionCommand('interlinearizer.previewDeletion', {
    summary:
      "Report what deleting a token analysis in a session's draft would do to the tokens that approve it",
    params: sessionArgs({
      name: 'analysisId',
      required: true,
      summary: 'ID of the token analysis',
      schema: { type: 'string' },
    }),
    result: {
      name: 'return value',
      summary: 'JSON-stringified AnalysisDeletionOutcome; "null" when no analysis carries the id',
      schema: { type: 'string' },
    },
  });

  const checkIndexesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.checkIndexes',
    checkIndexes,
    {
      method: {
        summary:
          "Report where a session's derived indexes, or stored shards, differ from its records, for debugging",
        params: sessionArgs(),
        result: {
          name: 'return value',
          summary: 'JSON-stringified IndexDifference[]; "[]" when none differ',
          schema: { type: 'string' },
        },
      },
    },
  );

  const getFullAnalysisCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getFullAnalysis',
    getFullAnalysis,
    {
      method: {
        summary: "Read a session's whole draft; a bridge until the WebView reads only pages",
        params: sessionArgs(),
        result: {
          name: 'return value',
          summary: 'JSON-stringified DraftProject',
          schema: { type: 'string' },
        },
      },
    },
  );

  const setPerfMarksCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.setPerfMarks',
    async (enabled: boolean) => setHostPerfMarks(enabled),
    {
      method: {
        summary: "Turn the extension host's timing entries on or off for the performance harness",
        params: [
          {
            name: 'enabled',
            required: true,
            summary: 'Whether the host records timing entries',
            schema: { type: 'boolean' },
          },
        ],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const setSkipSessionReadsCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.setSkipSessionReads',
    async (skip: boolean) => setSessionReadsSkipped(skip),
    {
      method: {
        summary:
          'Turn on or off skipping the whole-text read that a session starts, for the performance harness',
        params: [
          {
            name: 'skip',
            required: true,
            summary: 'Whether sessions read no text, even when a feature needs it',
            schema: { type: 'boolean' },
          },
        ],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const sessionIdForCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.sessionIdFor',
    async (sourceProjectId: string) => sessions.sessionIdFor(sourceProjectId),
    {
      method: {
        summary:
          "Return the id of the session open on a source project, for the performance harness to address the view's session",
        params: [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Source project whose open session to name',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'The session id, or undefined when the source has no session open',
          schema: { type: 'string' },
        },
      },
    },
  );

  const readPerfCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.readPerf',
    async () => {
      const reading = readHostPerf();
      return reading && JSON.stringify(reading);
    },
    {
      method: {
        summary: 'Take the timing entries the extension host recorded since the last reading',
        params: [],
        result: {
          name: 'return value',
          summary: 'JSON-stringified { entries, pid }, or undefined while timing entries are off',
          schema: { type: 'string' },
        },
      },
    },
  );

  const updateProjectMetadataCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.updateProjectMetadata',
    updateProjectMetadata,
    {
      method: {
        summary:
          'Update the name, description, and analysis language of an existing interlinearizer project',
        params: [
          {
            name: 'interlinearProjectId',
            required: true,
            summary: 'UUID of the interlinearizer project to update',
            schema: { type: 'string' },
          },
          {
            name: 'name',
            required: false,
            summary: 'New user-facing name; omit to clear',
            schema: { type: 'string' },
          },
          {
            name: 'description',
            required: false,
            summary: 'New user-facing description; omit to clear',
            schema: { type: 'string' },
          },
          {
            name: 'analysisLanguages',
            required: true,
            summary:
              'New BCP 47 analysis language tags; must be non-empty (pass current value to leave unchanged)',
            schema: { type: 'array', items: { type: 'string' } },
          },
          {
            name: 'targetProjectId',
            required: false,
            summary: 'New target-project ID; omit to clear the target binding',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary:
            'JSON-stringified updated InterlinearProject, or undefined if no project with that ID exists; rejects (throws) on storage failure',
          schema: { type: 'string' },
        },
      },
    },
  );

  const importPt9ProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.importPt9Project',
    importPt9Project,
    {
      method: {
        summary:
          "Import or sync the source project's Paratext 9 interlinear data into its single frozen import project",
        params: [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible project ID whose Paratext 9 interlinear files to import',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary:
            "JSON-stringified { outcome: 'imported' | 'staleKept', projectId, report?, summary? }; rejects (throws) when the source has nothing to import or the import fails",
          schema: { type: 'string' },
        },
      },
    },
    // Import time grows with the project's data, so any fixed timeout reports a false failure on a
    // large project while the host finishes the import.
    { timeoutMilliseconds: 0 },
  );

  const createEditableCopyCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.createEditableCopy',
    createEditableCopy,
    {
      method: {
        summary:
          'Create an editable project from a Paratext 9 import, carrying its analysis and no import provenance',
        params: [
          {
            name: 'interlinearProjectId',
            required: true,
            summary: 'UUID of the Paratext 9 import to copy',
            schema: { type: 'string' },
          },
          {
            name: 'name',
            required: true,
            summary: 'User-facing name for the copy',
            schema: { type: 'string' },
          },
          {
            name: 'description',
            required: false,
            summary: 'User-facing description for the copy',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary:
            'JSON-stringified created InterlinearProject; rejects (throws) when the project is missing or not a Paratext 9 import',
          schema: { type: 'string' },
        },
      },
    },
  );

  const deleteProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.deleteProject',
    deleteInterlinearProject,
    {
      method: {
        summary: 'Delete an interlinearizer project by UUID',
        params: [
          {
            name: 'interlinearProjectId',
            required: true,
            summary: 'UUID of the interlinearizer project to delete',
            schema: { type: 'string' },
          },
        ],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const openSelectProjectModalCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openSelectProjectModal',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Open the project-selector modal in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const openNewProjectModalCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openNewProjectModal',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Open the create-project modal in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const openProjectInfoModalCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openProjectInfoModal',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary:
          'Open the interlinear-info modal for the active project in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const openDeleteProjectModalCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openDeleteProjectModal',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Ask to delete the active project in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const openAnalysisCatalogCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openAnalysisCatalog',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Open the analysis catalog panel in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const openConcordanceCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openConcordance',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Open the concordance panel in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const undoCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.undo',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Undo the latest edit to the draft in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const redoCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.redo',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Redo the most recently undone edit to the draft in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const undoFromNotificationEmitter = await papi.network.createNetworkEventEmitterAsync(
    'interlinearizer.onUndoFromNotification',
  );
  const undoFromNotificationCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.undoFromNotification',
    async (notificationId) => {
      undoFromNotificationEmitter.emit({ notificationId });
    },
    {
      method: {
        summary: "Undo the draft edit a notification's Undo button offered to undo",
        params: [
          {
            name: 'notificationId',
            required: true,
            summary: 'ID of the notification whose Undo button was clicked',
            schema: { type: ['string', 'number'] },
          },
        ],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const openLexiconChooserCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openLexiconChooser',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Open the lexicon chooser for this project from the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const saveCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.save',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary:
          'Save the current draft to the active project (handled in the Interlinearizer WebView)',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const openSaveAsModalCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openSaveAsModal',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary: 'Open the Save As modal in the Interlinearizer WebView',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const discardChangesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openDiscardChangesModal',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary:
          'Open the dialog that discards the unsaved analysis of the current book or the whole draft (handled in the WebView)',
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  context.registrations.add(
    ...sessionRegistrations,
    mainWebViewProviderRegistration,
    openForWebViewCommandRegistration,
    continuousScrollValidatorRegistration,
    showMorphologyValidatorRegistration,
    showFreeTranslationValidatorRegistration,
    createProjectCommandRegistration,
    getProjectCommandRegistration,
    saveDraftToProjectCommandRegistration,
    saveDraftAsProjectCommandRegistration,
    getProjectsForSourceCommandRegistration,
    getProjectSummaryCommandRegistration,
    getTokenizedBookCommandRegistration,
    getBookOutlineCommandRegistration,
    getSegmentsCommandRegistration,
    getTextReadStatusCommandRegistration,
    startDraftOverCommandRegistration,
    openSessionCommandRegistration,
    closeSessionCommandRegistration,
    setAnalysisLanguageCommandRegistration,
    setSaveTargetCommandRegistration,
    detachFromProjectCommandRegistration,
    undoEditCommandRegistration,
    redoEditCommandRegistration,
    checkIndexesCommandRegistration,
    getFullAnalysisCommandRegistration,
    setPerfMarksCommandRegistration,
    setSkipSessionReadsCommandRegistration,
    sessionIdForCommandRegistration,
    readPerfCommandRegistration,
    updateProjectMetadataCommandRegistration,
    importPt9ProjectCommandRegistration,
    createEditableCopyCommandRegistration,
    deleteProjectCommandRegistration,
    openSelectProjectModalCommandRegistration,
    openNewProjectModalCommandRegistration,
    openProjectInfoModalCommandRegistration,
    openDeleteProjectModalCommandRegistration,
    openAnalysisCatalogCommandRegistration,
    openConcordanceCommandRegistration,
    undoCommandRegistration,
    redoCommandRegistration,
    undoFromNotificationEmitter,
    undoFromNotificationCommandRegistration,
    openLexiconChooserCommandRegistration,
    saveCommandRegistration,
    openSaveAsModalCommandRegistration,
    discardChangesCommandRegistration,
  );

  logger.debug('Interlinearizer extension finished activating!');
}

/**
 * Extension teardown. Called by the platform when the extension is unloaded. Registrations added
 * during activate are disposed by the platform.
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
