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
  Book,
  ChangeId,
  MergedContent,
  ProjectConfig,
  RemovalPreviewRequest,
  TokenSnapshot,
} from 'interlinearizer';
import type { NetworkEvents } from 'papi-shared-types';
import {
  formatReplacementString,
  type LocalizeKey,
  type PlatformEventEmitter,
} from 'platform-bible-utils';
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
import { AnalysisSessions, type OpenedSession, type Session } from './services/analysisSessions';
import type { DraftContent } from './hooks/useDraftProject';
import * as bookService from './services/bookService';
import * as boundaryCommands from './services/commands/boundaryCommands';
import * as catalogCommands from './services/commands/catalogCommands';
import type { ChangeBuffer } from './services/commands/changeBuffer';
import * as discardCommands from './services/commands/discardCommands';
import * as morphemeCommands from './services/commands/morphemeCommands';
import * as staleCommands from './services/commands/staleCommands';
import * as freeTranslationCommands from './services/commands/freeTranslationCommands';
import * as phraseCommands from './services/commands/phraseCommands';
import * as tokenCommands from './services/commands/tokenCommands';
import { startCSharpHost } from './services/csharpHost';
import type { EditOptions } from './services/editHistory';
import { catalogStepOf, deletionStepOf, phraseStartOf } from './services/editSteps';
import { readHostPerf, setHostPerfMarks } from './services/hostPerf';
import * as projectStorage from './services/projectStorage';
import * as pt9ImportService from './services/pt9ImportService';
import type { Pt9ImportResult } from './services/pt9ImportService';
import { readBookOutline, readSegmentPage } from './services/sessionPages';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- named only for its doc links
import type { CommandReply } from './types/command-reply';
import type { EditStep } from './types/edit-step';
import { toProjectSummary, type SavedAsProject } from './types/interlinear-project-summary';
import { UnreadableBooksError, type DraftExport } from './types/analysis-repository';
import { isDraftProject } from './types/type-guards';
import { BOOKLESS_PARTITION, bookOfRef } from './utils/analysis-book';
import { bookIndexesOf } from './utils/book-indexes';
import { perfTime, perfTimeAsync } from './utils/perf-marks';
import { missingBook } from './utils/reanchor-draft';
import { segmentationForBook } from './utils/segmentation';

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
    return {
      ...savedWebView,
      projectId,
      // The offer flag rides the options only on an explicit open; a tab restore passes no
      // options and keeps whatever the WebView last stored.
      ...(openWebViewOptions?.offerPt9Import !== undefined && {
        state: { ...savedWebView.state, offerPt9Import: openWebViewOptions.offerPt9Import },
      }),
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
 * Tracks the WebView ID opened for each project so subsequent opens of the same project bring that
 * tab to front instead of opening a duplicate.
 */
const openWebViewsByProject = new Map<string, string>();

/**
 * The unreadable books each source's last draft write left out, so the user is told once, not on
 * every write.
 */
const leftOutDraftBooks = new Map<string, string>();

/** Tells views what a change touched; set on activation. */
let analysisChangedEmitter: PlatformEventEmitter<
  NetworkEvents['interlinearizer.onAnalysisChanged']
>;

/** The open analysis sessions, over the extension's storage. */
const sessions = new AnalysisSessions({
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
  startTextRead: (sourceProjectId) => bookService.startTextRead(sourceProjectId),
  stopTextRead: (sourceProjectId) => bookService.stopTextRead(sourceProjectId),
  heldBook: (sourceProjectId, bookId, segmentation) =>
    bookService.heldBook(sourceProjectId, bookId, segmentation && JSON.stringify(segmentation)),
  reportChange: (change) => analysisChangedEmitter.emit(change),
});

/**
 * Tells views of a Scripture edit to the source project's book, addressed by source project and,
 * when the source has a session open, by session too.
 */
function emitScriptureEdit(sourceProjectId: string, bookId: string): void {
  analysisChangedEmitter.emit({
    sourceProjectId,
    changeId: crypto.randomUUID(),
    scriptureEdit: { bookId },
  });
  const sessionId = sessions.sessionIdFor(sourceProjectId);
  if (sessionId === undefined) return;
  analysisChangedEmitter.emit({
    sessionId,
    changeId: crypto.randomUUID(),
    books: [{ bookId }],
    analysisIds: [],
    queries: ['getCatalogRows', 'getConcordance', 'getStaleSummary'],
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
    }));

  if (!resolvedProjectId) return undefined;

  const existingId = openWebViewsByProject.get(resolvedProjectId);
  const options: InterlinearizerOpenOptions = {
    existingId,
    projectId: resolvedProjectId,
    // Computed only when this open creates a tab: focusing an existing tab must not reset an
    // offer the user may already be looking at.
    ...(existingId === undefined && {
      offerPt9Import: await pt9ImportService.hasNoInterlinearizerState(
        executionToken,
        resolvedProjectId,
      ),
    }),
  };
  return papi.webViews.openWebView(mainWebViewType, undefined, options);
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
 * Imports or syncs the source project's Paratext 9 interlinear data. Returns the run's outcome as a
 * JSON string; when the source's files have disappeared but an earlier import exists, the stored
 * import is kept and a warning notification is sent.
 *
 * @param sourceProjectId - Platform.Bible project ID whose Paratext 9 interlinear files to import.
 * @throws If the import fails or the source has nothing to import. The error is logged and an error
 *   notification is sent before rethrowing so the frontend `catch` block can suppress it without
 *   sending a second notification.
 */
/**
 * The warning for each reason an import kept what was already stored. A Record, so a new reason has
 * to bring its own string rather than compile with another's.
 */
const STALE_KEPT_MESSAGES: Record<NonNullable<Pt9ImportResult['staleReason']>, `%${string}%`> = {
  sourceEmpty: '%interlinearizer_warning_pt9Import_sourceEmpty%',
  allFilesTooLarge: '%interlinearizer_warning_pt9Import_allFilesTooLarge%',
  noGlossLanguage: '%interlinearizer_warning_pt9Import_noGlossLanguage%',
};

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
 * Copies the source project's stored draft into an existing interlinearizer project: Save, and Save
 * As onto an existing project. The WebView writes its pending autosave first, so the stored draft
 * is the one it means to save. A draft that cannot be read for some book is not copied, and the
 * user is told which books and how to recover.
 *
 * @param sourceProjectId - Platform.Bible source project ID whose draft to copy.
 * @param interlinearProjectId - UUID of the interlinearizer project to save into.
 * @param config - The configuration to set on the project in the same write; omit to leave the
 *   project's configuration unchanged.
 * @returns The saved project's `InterlinearProjectSummary` (carrying the refreshed `updatedAt`) as
 *   a JSON string, or `undefined` if no project with the given ID exists.
 * @throws If the draft cannot be read for some book, if the project is a Paratext 9 import, which
 *   is read-only, if the stored draft is unreadable, or if storage fails. The error is logged and
 *   an error notification is sent before rethrowing.
 */
async function saveDraftToProject(
  sourceProjectId: string,
  interlinearProjectId: string,
  config?: ProjectConfig,
): Promise<string | undefined> {
  try {
    return await perfTimeAsync('saveDraftToProject', async () => {
      const saved = await projectStorage.saveDraftToProject(
        executionToken,
        sourceProjectId,
        interlinearProjectId,
        config,
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
 * to a new project. The WebView writes its pending autosave first, so the stored draft is the one
 * it means to save. A book of the draft that cannot be read is left out, and the user is told
 * which.
 *
 * @param sourceProjectId - Platform.Bible source project ID whose draft to copy.
 * @param analysisLanguages - BCP 47 tags for the new project's analysis languages.
 * @param targetProjectId - Optional Platform.Bible project ID of the target text.
 * @param name - Optional user-facing name for the project.
 * @param description - Optional user-facing description for the project.
 * @returns The created project's summary and the books it left out, as a JSON
 *   {@link SavedAsProject}.
 * @throws If the stored draft is unreadable or storage fails. The error is logged and an error
 *   notification is sent before rethrowing.
 */
async function saveDraftAsProject(
  sourceProjectId: string,
  analysisLanguages: string[],
  targetProjectId?: string,
  name?: string,
  description?: string,
): Promise<string> {
  try {
    return await perfTimeAsync('saveDraftAsProject', async () => {
      const created = await projectStorage.saveDraftAsNewProject(
        executionToken,
        sourceProjectId,
        analysisLanguages,
        targetProjectId,
        name,
        description,
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
 * Returns the draft working buffer for a source project as a JSON string, creating a fresh empty
 * draft when none has been written. The WebView loads this on mount to seed the editor. The user is
 * warned of any book whose stored analysis could not be read, and the next draft write that leaves
 * books out tells them again.
 *
 * @param sourceProjectId - Platform.Bible source project ID whose draft to fetch.
 * @throws {SyntaxError} If the draft's storage value contains invalid JSON.
 * @throws {Error} If the stored draft was written by a newer build.
 * @throws If `papi.storage.readUserData` rejects for a non-ENOENT reason. The error is logged
 *   before rethrowing.
 */
async function getInterlinearDraft(sourceProjectId: string): Promise<string> {
  leftOutDraftBooks.delete(sourceProjectId);
  try {
    return await perfTimeAsync('getDraft', async () => {
      const { draft, unreadableBooks } = await projectStorage.getDraft(
        executionToken,
        sourceProjectId,
      );
      await reportUnreadableBooks(
        unreadableBooks,
        '%interlinearizer_warning_loadDraft_unreadableBooks%',
        'warning',
      );
      return perfTime('getDraft:serialize', () => JSON.stringify(draft));
    });
  } catch (e) {
    logger.error('Interlinearizer: failed to get draft', e);
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

/** A source project by id, or a session by id; a session's form answers with its analysis too. */
type TextAddress = string | { sessionId: string };

/** Names `address` in a logged message. */
function addressed(address: TextAddress): string {
  return typeof address === 'string' ? `project ${address}` : `session ${address.sessionId}`;
}

/**
 * Refuses boundaries sent with a session's address, because a session's book is segmented by its
 * draft's boundaries.
 *
 * @throws If `segmentationJson` names any.
 */
function refuseBoundaries(segmentationJson: string | undefined): void {
  if (segmentationJson)
    throw new Error("Interlinearizer: a session's book is segmented by its draft's boundaries");
}

/** The boundaries the session's draft sets in the book, as JSON; `undefined` when it sets none. */
async function sessionBoundaries(session: Session, bookId: string): Promise<string | undefined> {
  const forBook = segmentationForBook((await session.repository.getScope()).segmentation, bookId);
  return forBook && JSON.stringify(forBook);
}

/**
 * Outlines a book of a source project, or of a session's source. A project's book is segmented by
 * the boundaries that `segmentationJson` names. A session's book is segmented by its draft's
 * boundaries, and its outline also counts each segment's orphaned free-translation cards.
 *
 * @returns The `BookOutline` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book cannot be read or segmented, or `segmentationJson` is not a JSON
 *   `SegmentationDelta`. Also if `segmentationJson` names boundaries for a session, the session is
 *   not open, or its analysis cannot be read. The error is logged before rethrowing.
 */
async function getBookOutline(
  address: TextAddress,
  bookId: string,
  segmentationJson?: string,
): Promise<string | undefined> {
  try {
    return await perfTimeAsync('getBookOutline', async () => {
      if (typeof address === 'string')
        return bookService.getBookOutline(address, bookId, segmentationJson);
      refuseBoundaries(segmentationJson);
      return sessions.run(address.sessionId, async (session) => {
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
    logger.error(`Interlinearizer: failed to outline book ${bookId} of ${addressed(address)}`, e);
    throw e;
  }
}

/**
 * Serves the segments at outline indexes `[start, end)` of a book of a source project, or of a
 * session's source. A project's book is segmented by the boundaries that `segmentationJson` names.
 * A session's book is segmented by its draft's boundaries, and its segments come with the analysis
 * that its draft holds for them.
 *
 * @returns The `SegmentPage` as JSON, or `undefined` when the project has no text for the book.
 * @throws If the book cannot be read or segmented, or `segmentationJson` is not a JSON
 *   `SegmentationDelta`. Also if `segmentationJson` names boundaries for a session, the session is
 *   not open, or its analysis cannot be read. The error is logged before rethrowing.
 */
async function getSegments(
  address: TextAddress,
  bookId: string,
  start: number,
  end: number,
  segmentationJson?: string,
): Promise<string | undefined> {
  try {
    return await perfTimeAsync('getSegments', async () => {
      if (typeof address === 'string')
        return bookService.getSegments(address, bookId, start, end, segmentationJson);
      refuseBoundaries(segmentationJson);
      return sessions.run(address.sessionId, async (session) => {
        const book = await bookService.getSegmentedBook(
          session.scope.sourceProjectId,
          bookId,
          await sessionBoundaries(session, bookId),
        );
        if (!book) return undefined;
        const page = await readSegmentPage(session.repository, book, start, end);
        return perfTime('getSegments:serialize', () => JSON.stringify(page));
      });
    });
  } catch (e) {
    logger.error(
      `Interlinearizer: failed to serve segments ${start}-${end} of book ${bookId} of ${addressed(address)}`,
      e,
    );
    throw e;
  }
}

/**
 * Reports how far reading the whole text of the source project, or of a session's, has got,
 * starting the read when the project has none.
 *
 * @returns Once the text's books are known, the `TextReadStatus` as JSON.
 * @throws If the books or the provider of their text cannot be got, or the session is not open. The
 *   error is logged before rethrowing.
 */
async function getTextReadStatus(address: TextAddress): Promise<string> {
  try {
    const sourceProjectId =
      typeof address === 'string'
        ? address
        : await sessions.run(address.sessionId, async ({ scope }) => scope.sourceProjectId);
    return await bookService.getTextReadStatus(sourceProjectId);
  } catch (e) {
    logger.error(`Interlinearizer: failed to read the text of ${addressed(address)}`, e);
    throw e;
  }
}

/**
 * Persists the draft working buffer for a source project. Called from the WebView after every edit
 * (auto-save) and whenever the draft is reset (New), opened from a project, or has its changes
 * discarded. Analysis for a book whose stored analysis could not be read is left out of the write.
 * The user is told which books once, and again only after the draft is reloaded or a write has left
 * none out.
 *
 * @param sourceProjectId - Platform.Bible source project ID whose draft to write.
 * @param draftJson - JSON-stringified `DraftProject` to persist.
 * @param discardUnreadable - Whether the draft was started over (New, Open), so stored analysis
 *   that could not be read is discarded rather than kept.
 * @throws If JSON parsing, validation, or storage fails, or if the stored draft was written by a
 *   newer build and so must not be overwritten. The error is logged and an error notification is
 *   sent before rethrowing so the frontend `catch` block can suppress it without a second
 *   notification.
 */
async function saveInterlinearDraft(
  sourceProjectId: string,
  draftJson: string,
  discardUnreadable?: boolean,
): Promise<void> {
  let leftOut: string[];
  try {
    leftOut = await perfTimeAsync('saveDraft', async () => {
      const draft = perfTime('saveDraft:parse', () => JSON.parse(draftJson));
      if (!isDraftProject(draft)) {
        throw new TypeError('saveInterlinearDraft: draftJson does not conform to DraftProject');
      }
      return projectStorage.saveDraft(executionToken, sourceProjectId, draft, {
        discardUnreadable: discardUnreadable === true,
      });
    });
  } catch (e) {
    logger.error('Interlinearizer: failed to save draft', e);
    await papi.notifications
      .send({
        message: '%interlinearizer_error_save_draft_failed%',
        severity: 'error',
      })
      .catch(() => {});
    throw e;
  }
  if (leftOut.length === 0) {
    leftOutDraftBooks.delete(sourceProjectId);
    return;
  }
  const books = leftOut.join(', ');
  if (leftOutDraftBooks.get(sourceProjectId) === books) return;
  leftOutDraftBooks.set(sourceProjectId, books);
  logger.warn(
    `Interlinearizer: saved the draft of ${sourceProjectId} without its analysis for ${books}, whose stored analysis could not be read`,
  );
  await reportUnreadableBooks(
    leftOut,
    '%interlinearizer_error_saveDraft_unreadableBooks%',
    'error',
  );
}

/**
 * Opens a session read-only on `interlinearProjectId` when it names a Paratext 9 import, otherwise
 * on the source project's draft, which saves to `interlinearProjectId` when given. Closes the
 * source's earlier session, if any.
 *
 * @returns A JSON string of an {@link OpenedSession}.
 * @throws If the source project has no such interlinear project, or its analysis cannot be loaded.
 *   The error is logged before rethrowing.
 */
async function openSession(
  sourceProjectId: string,
  interlinearProjectId?: string,
): Promise<string> {
  try {
    const opened: OpenedSession = await sessions.open(sourceProjectId, interlinearProjectId);
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
async function setAnalysisLanguage(sessionId: string, analysisLanguage: string): Promise<void> {
  try {
    await sessions.setAnalysisLanguage(sessionId, analysisLanguage);
  } catch (e) {
    logger.error(`Interlinearizer: failed to set the analysis language of session ${sessionId}`, e);
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
async function undoEdit(
  sessionId: string,
  changeId?: ChangeId | null,
): Promise<string | undefined> {
  try {
    const reply = await sessions.undo(sessionId, changeId ?? undefined);
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
async function redoEdit(
  sessionId: string,
  changeId?: ChangeId | null,
): Promise<string | undefined> {
  try {
    const reply = await sessions.redo(sessionId, changeId ?? undefined);
    return reply && JSON.stringify(reply);
  } catch (e) {
    logger.error(`Interlinearizer: failed to redo an edit in session ${sessionId}`, e);
    throw e;
  }
}

/**
 * Reports where a session's derived indexes differ from ones built afresh from its records, for
 * debugging.
 *
 * @returns A JSON string of the differences; `"[]"` when there are none.
 * @throws If the session is not open. The error is logged before rethrowing.
 */
async function checkIndexes(sessionId: string): Promise<string> {
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
 * The session an edit is sent to, the change id it is sent under, and the step to record it as. A
 * command may set the step while it stages, once it has read what the step names.
 */
type EditTarget = {
  sessionId: string;
  changeId?: ChangeId | null;
  step?: EditStep;
};

/**
 * Runs `command` as one edit of a session's analysis.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
async function runSessionEdit(
  target: EditTarget,
  intent: string,
  command: (buffer: ChangeBuffer, session: Session) => Promise<void | readonly Book[]>,
): Promise<string> {
  const { sessionId, changeId } = target;
  try {
    return JSON.stringify(
      await sessions.edit(sessionId, intent, command, {
        changeId: changeId ?? undefined,
        step: () => target.step,
      }),
    );
  } catch (e) {
    logger.error(`Interlinearizer: failed to ${intent} in session ${sessionId}`, e);
    throw e;
  }
}

/** Fresh ids for the records an edit may make, and the time the edit lands. */
function editStamp() {
  return {
    analysisId: crypto.randomUUID(),
    linkId: crypto.randomUUID(),
    forkId: crypto.randomUUID(),
    now: new Date().toISOString(),
  };
}

/**
 * Writes a token's gloss in the session's analysis language; a blank value clears it.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function writeGloss(
  sessionId: string,
  tokenRef: string,
  surfaceText: string,
  value: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: tokenRef } },
    'writeGloss',
    (buffer, session) =>
      tokenCommands.writeGloss(buffer, {
        ...editStamp(),
        tokenRef,
        surfaceText,
        value,
        analysisLanguage: session.analysisLanguage,
      }),
  );
}

/**
 * Approves a stored token analysis for a token, in place of any approval the token held.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function approveAnalysisForToken(
  sessionId: string,
  tokenRef: string,
  surfaceText: string,
  analysisId: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: tokenRef } },
    'approveAnalysisForToken',
    (buffer) =>
      tokenCommands.approveAnalysisForToken(buffer, {
        ...editStamp(),
        tokenRef,
        surfaceText,
        analysisId,
      }),
  );
}

/**
 * Writes a token's morpheme breakdown, each form in `writingSystem`.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function writeMorphemes(
  sessionId: string,
  tokenRef: string,
  surfaceText: string,
  forms: string[],
  writingSystem: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: tokenRef } },
    'writeMorphemes',
    (buffer) =>
      morphemeCommands.writeMorphemes(buffer, {
        ...editStamp(),
        tokenRef,
        surfaceText,
        writingSystem,
        morphemes: forms.map((form) => ({ id: crypto.randomUUID(), form })),
      }),
  );
}

/**
 * Removes a token's morpheme breakdown.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function deleteMorphemes(
  sessionId: string,
  tokenRef: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: tokenRef } },
    'deleteMorphemes',
    (buffer) => morphemeCommands.deleteMorphemes(buffer, { ...editStamp(), tokenRef }),
  );
}

/**
 * Glosses one morpheme of a token's breakdown in the session's analysis language; a blank value
 * clears the morpheme's gloss.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function writeMorphemeGloss(
  sessionId: string,
  tokenRef: string,
  morphemeId: string,
  value: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: tokenRef } },
    'writeMorphemeGloss',
    (buffer, session) =>
      morphemeCommands.writeMorphemeGloss(buffer, {
        ...editStamp(),
        tokenRef,
        morphemeId,
        value,
        analysisLanguage: session.analysisLanguage,
      }),
  );
}

/**
 * Gives up the place an analysis went stale at, leaving its other places alone.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function discardStaleAnalysis(
  sessionId: string,
  analysisId: string,
  tokenRef: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit({ sessionId, changeId }, 'discardStaleAnalysis', (buffer) =>
    staleCommands.discardStaleAnalysis(buffer, { analysisId, tokenRef }),
  );
}

/**
 * Moves an analysis from a place it went stale at onto a token, approving it there in place of
 * whatever that token held.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function reapplyStaleAnalysis(
  sessionId: string,
  analysisId: string,
  staleTokenRef: string,
  tokenRef: string,
  surfaceText: string,
  changeId?: ChangeId | null,
): Promise<string> {
  const { analysisId: copyId, linkId, now } = editStamp();
  return runSessionEdit({ sessionId, changeId }, 'reapplyStaleAnalysis', (buffer) =>
    staleCommands.reapplyStaleAnalysis(buffer, {
      analysisId,
      staleTokenRef,
      tokenRef,
      surfaceText,
      copyId,
      linkId,
      now,
    }),
  );
}

/**
 * Keeps a stale free translation as a claim about a segment's current text, approving it for that
 * segment.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function keepStaleFreeTranslation(
  sessionId: string,
  analysisId: string,
  segmentId: string,
  surfaceText: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit({ sessionId, changeId }, 'keepStaleFreeTranslation', (buffer) =>
    staleCommands.keepStaleFreeTranslation(buffer, {
      analysisId,
      segmentId,
      surfaceText,
      now: editStamp().now,
    }),
  );
}

/**
 * Drops a stale free translation, even one whose verse the book no longer holds.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function discardStaleFreeTranslation(
  sessionId: string,
  analysisId: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit({ sessionId, changeId }, 'discardStaleFreeTranslation', (buffer) =>
    staleCommands.discardStaleFreeTranslation(buffer, { analysisId }),
  );
}

/**
 * Writes a token analysis's gloss in the session's analysis language, for every token linked to it;
 * a blank value clears it.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws As {@link runSessionEdit} does.
 */
function writeAnalysisGloss(
  sessionId: string,
  analysisId: string,
  value: string,
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'writeAnalysisGloss', async (buffer, session) => {
    const stepOf = await catalogStepOf(buffer, 'catalogEdit', analysisId);
    target.step = stepOf(
      await catalogCommands.writeAnalysisGloss(buffer, {
        analysisId,
        value,
        analysisLanguage: session.analysisLanguage,
        now: editStamp().now,
      }),
    );
  });
}

/**
 * Clears the glosses of several token analyses in the session's analysis language.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws As {@link runSessionEdit} does.
 */
function clearAnalysisGlosses(
  sessionId: string,
  analysisIds: string[],
  changeId?: ChangeId | null,
): Promise<string> {
  const step = {
    summary: { kind: 'catalogClearGlossChecked', count: analysisIds.length },
  } as const;
  return runSessionEdit({ sessionId, changeId, step }, 'clearAnalysisGlosses', (buffer, session) =>
    catalogCommands.clearAnalysisGlosses(buffer, {
      analysisIds,
      analysisLanguage: session.analysisLanguage,
      now: editStamp().now,
    }),
  );
}

/**
 * Re-splits a token analysis's breakdown into `forms`, for every token linked to it; no forms
 * removes the breakdown.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws As {@link runSessionEdit} does.
 */
function writeAnalysisMorphemes(
  sessionId: string,
  analysisId: string,
  forms: string[],
  writingSystem: string,
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'writeAnalysisMorphemes', async (buffer) => {
    const stepOf = await catalogStepOf(buffer, 'catalogEdit', analysisId);
    target.step = stepOf(
      await catalogCommands.writeAnalysisMorphemes(buffer, {
        analysisId,
        morphemes: forms.map((form) => ({ id: crypto.randomUUID(), form })),
        writingSystem,
        now: editStamp().now,
      }),
    );
  });
}

/**
 * Keeps a token analysis's stale breakdown as it stands, for every token linked to it.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws As {@link runSessionEdit} does.
 */
function confirmAnalysisMorphemes(
  sessionId: string,
  analysisId: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit({ sessionId, changeId }, 'confirmAnalysisMorphemes', (buffer) =>
    catalogCommands.confirmAnalysisMorphemes(buffer, { analysisId, now: editStamp().now }),
  );
}

/**
 * Writes the gloss of one morpheme of a token analysis in the session's analysis language, for
 * every token linked to it; a blank value clears it.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws As {@link runSessionEdit} does.
 */
function writeAnalysisMorphemeGloss(
  sessionId: string,
  analysisId: string,
  morphemeId: string,
  value: string,
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'writeAnalysisMorphemeGloss', async (buffer, session) => {
    const stepOf = await catalogStepOf(buffer, 'catalogEdit', analysisId);
    target.step = stepOf(
      await catalogCommands.writeAnalysisMorphemeGloss(buffer, {
        analysisId,
        morphemeId,
        value,
        analysisLanguage: session.analysisLanguage,
        now: editStamp().now,
      }),
    );
  });
}

/**
 * Removes token analyses with every token link to them.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws As {@link runSessionEdit} does.
 */
function deleteAnalyses(
  sessionId: string,
  analysisIds: string[],
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'deleteAnalyses', async (buffer, session) => {
    target.step = await deletionStepOf(buffer, session.repository, analysisIds);
    await catalogCommands.deleteAnalyses(buffer, { analysisIds });
  });
}

/**
 * Folds token analyses into a survivor and writes the settled content onto it, in the session's
 * analysis language.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws As {@link runSessionEdit} does.
 */
function mergeAnalysesInto(
  sessionId: string,
  survivorAnalysisId: string,
  mergedAnalysisIds: string[],
  content: MergedContent,
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'mergeAnalysesInto', async (buffer, session) => {
    const stepOf = await catalogStepOf(buffer, 'catalogMerge', survivorAnalysisId);
    target.step = stepOf(
      await catalogCommands.mergeAnalysesInto(buffer, {
        survivorAnalysisId,
        mergedAnalysisIds,
        content,
        analysisLanguage: session.analysisLanguage,
        now: editStamp().now,
      }),
    );
  });
}

/**
 * Refuses a phrase occurrence with no tokens; the analysis index files a phrase by the book of its
 * first token.
 *
 * @throws If `tokens` is empty.
 */
function assertTokenRun(tokens: readonly TokenSnapshot[]): void {
  if (tokens.length === 0) throw new Error('Interlinearizer: a phrase needs at least one token');
}

/**
 * What `read` serves for the session's source project and the book that `tokenRef` falls in.
 *
 * @throws If the project has no text for that book, or `read` throws.
 */
async function readBookOf<T>(
  session: Session,
  tokenRef: string,
  read: (sourceProjectId: string, bookId: string) => Promise<T | undefined>,
): Promise<T> {
  const bookId = bookOfRef(tokenRef);
  const { sourceProjectId } = session.scope;
  const found = await read(sourceProjectId, bookId);
  if (found === undefined) {
    throw new Error(`Interlinearizer: project ${sourceProjectId} has no text for book ${bookId}`);
  }
  return found;
}

/**
 * Refuses a phrase occurrence over `tokens` unless they lie within one segment of the text, as the
 * staged boundaries segment it.
 *
 * @throws If the tokens span segments or name a token the text lacks, the project has no text for
 *   the first token's book, or the book cannot be read or tokenized.
 */
async function assertOneSegment(
  buffer: ChangeBuffer,
  session: Session,
  tokens: readonly TokenSnapshot[],
): Promise<void> {
  const { segmentation } = await buffer.getScope();
  const { segments } = await readBookOf(session, tokens[0].tokenRef, (sourceProjectId, bookId) => {
    // Keyed as page reads key it, so that the two share the book's segmentation.
    const forBook = segmentationForBook(segmentation, bookId);
    return bookService.getSegmentedBook(
      sourceProjectId,
      bookId,
      forBook && JSON.stringify(forBook),
    );
  });
  const { tokenSegmentMap } = bookIndexesOf(segments);
  const segmentIds = new Set(tokens.map(({ tokenRef }) => tokenSegmentMap.get(tokenRef)));
  if (segmentIds.size > 1 || segmentIds.has(undefined)) {
    throw new Error("Interlinearizer: a phrase's tokens must lie within one segment of the text");
  }
}

/**
 * Adds an approved phrase occurrence over `tokens`, sharing a content-identical stored payload
 * where one exists.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If `tokens` is empty or not within one segment of the text, the project has no text for
 *   the first token's book, the session is read-only or not open, or the edit is refused or fails.
 *   The error is logged before rethrowing.
 */
function createPhrase(
  sessionId: string,
  tokens: TokenSnapshot[],
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: tokens[0]?.tokenRef } },
    'createPhrase',
    async (buffer, session) => {
      assertTokenRun(tokens);
      await assertOneSegment(buffer, session, tokens);
      await phraseCommands.createPhrase(buffer, { ...editStamp(), tokens });
    },
  );
}

/**
 * Gives a phrase occurrence a new token run, keeping its gloss. An empty run removes the
 * occurrence.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If `tokens` is not within one segment of the text, the project has no text for the first
 *   token's book, the session is read-only or not open, or the edit is refused or fails. The error
 *   is logged before rethrowing.
 */
function updatePhrase(
  sessionId: string,
  phraseId: string,
  tokens: TokenSnapshot[],
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'updatePhrase', async (buffer, session) => {
    target.step =
      tokens.length > 0 ? { location: tokens[0].tokenRef } : await phraseStartOf(buffer, phraseId);
    if (tokens.length > 0) await assertOneSegment(buffer, session, tokens);
    await phraseCommands.updatePhrase(buffer, { ...editStamp(), phraseId, tokens });
  });
}

/**
 * Removes a phrase occurrence, with its payload unless another occurrence shares that payload.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function deletePhrase(
  sessionId: string,
  phraseId: string,
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'deletePhrase', async (buffer) => {
    target.step = await phraseStartOf(buffer, phraseId);
    await phraseCommands.deletePhrase(buffer, { phraseId });
  });
}

/**
 * Merges a neighbor into a phrase occurrence as one edit. The target takes the merged token run.
 * The absorbed occurrence, when named, is removed.
 *
 * @param sessionId - As {@link openSession} returned it.
 * @param targetPhraseId - The target occurrence's link ID.
 * @param tokens - In document order.
 * @param absorbedPhraseId - The absorbed occurrence's link ID. Absent or `null` when the neighbor
 *   is a token in no phrase.
 * @param changeId - Names the change; absent or `null`, the session names it.
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If `tokens` is empty or not within one segment of the text, the project has no text for
 *   the first token's book, the session is read-only or not open, or the edit is refused or fails.
 *   The error is logged before rethrowing.
 */
function mergePhrases(
  sessionId: string,
  targetPhraseId: string,
  tokens: TokenSnapshot[],
  absorbedPhraseId?: string | null,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: tokens[0]?.tokenRef } },
    'mergePhrases',
    async (buffer, session) => {
      assertTokenRun(tokens);
      await assertOneSegment(buffer, session, tokens);
      await phraseCommands.mergePhrases(buffer, {
        ...editStamp(),
        targetPhraseId,
        tokens,
        absorbedPhraseId: absorbedPhraseId ?? undefined,
      });
    },
  );
}

/**
 * Writes a phrase occurrence's gloss in the session's analysis language; a blank value clears it.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function writePhraseGloss(
  sessionId: string,
  phraseId: string,
  value: string,
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'writePhraseGloss', async (buffer, session) => {
    target.step = await phraseStartOf(buffer, phraseId);
    await phraseCommands.writePhraseGloss(buffer, {
      ...editStamp(),
      phraseId,
      value,
      analysisLanguage: session.analysisLanguage,
    });
  });
}

/**
 * Approves a phrase occurrence, unless any of its tokens is in an approved phrase.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the occurrence would be approved over tokens not within one segment of the text, the
 *   project has no text for their book, the session is read-only or not open, or the edit is
 *   refused or fails. The error is logged before rethrowing.
 */
function approvePhrase(
  sessionId: string,
  phraseId: string,
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'approvePhrase', async (buffer, session) => {
    target.step = await phraseStartOf(buffer, phraseId);
    const [link] = await buffer.getPhraseAnalysisLinks([phraseId]);
    if (link && link.status !== 'approved') await assertOneSegment(buffer, session, link.tokens);
    await phraseCommands.approvePhrase(buffer, { ...editStamp(), phraseId });
  });
}

/**
 * The book `tokenRef` falls in, read from the session's source project and tokenized one segment
 * per verse.
 *
 * @throws If the project has no text for that book, or the book cannot be read or tokenized.
 */
function verseBookOf(session: Session, tokenRef: string): Promise<Book> {
  return readBookOf(session, tokenRef, bookService.getVerseBook);
}

/**
 * Splits a phrase occurrence just after a token, in the document order of the token's book. A half
 * left with a single token leaves that token in no phrase.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the project has no text for the token's book, the session is read-only or not open, or
 *   the edit is refused or fails. The error is logged before rethrowing.
 */
function splitPhrase(
  sessionId: string,
  phraseId: string,
  splitAfterTokenRef: string,
  changeId?: ChangeId | null,
): Promise<string> {
  const target: EditTarget = { sessionId, changeId };
  return runSessionEdit(target, 'splitPhrase', async (buffer, session) => {
    target.step = await phraseStartOf(buffer, phraseId);
    const verseBook = await verseBookOf(session, splitAfterTokenRef);
    await phraseCommands.splitPhrase(buffer, {
      ...editStamp(),
      phraseId,
      splitAfterTokenRef,
      tokenDocOrder: bookIndexesOf(verseBook.segments).tokenDocOrder,
    });
  });
}

/**
 * Writes a segment's free translation in the session's analysis language.
 *
 * @param sessionId - The session whose draft the write edits.
 * @param segmentId - `Segment.id` of the segment translated.
 * @param surfaceText - The segment's current baseline text, refreshed on the translation.
 * @param value - The free translation. A blank value clears the translation in the session's
 *   analysis language.
 * @param adoptStaleAnalysisId - Id of the stale translation the value was typed over. The write
 *   adopts that translation when the segment has no approved one. Absent or `null` when the value
 *   was typed over none.
 * @param changeId - Names the change; absent or `null`, the session names it.
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the session is read-only or not open, or the edit is refused or fails. The error is
 *   logged before rethrowing.
 */
function writeSegmentFreeTranslation(
  sessionId: string,
  segmentId: string,
  surfaceText: string,
  value: string,
  adoptStaleAnalysisId?: string | null,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: segmentId } },
    'writeSegmentFreeTranslation',
    (buffer, session) =>
      freeTranslationCommands.writeSegmentFreeTranslation(buffer, {
        ...editStamp(),
        segmentId,
        surfaceText,
        value,
        analysisLanguage: session.analysisLanguage,
        adoptStaleAnalysisId: adoptStaleAnalysisId ?? undefined,
      }),
  );
}

/** The time a boundary edit lands, and a maker of fresh ids for the records it may make. */
function boundaryEditStamp() {
  return { now: new Date().toISOString(), newId: () => crypto.randomUUID() };
}

/**
 * Merges the segment beginning at a token into the one before it.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the project has no text for the token's book, the session is read-only or not open, or
 *   the edit fails. The error is logged before rethrowing.
 */
function mergeSegments(
  sessionId: string,
  secondSegmentStartRef: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: secondSegmentStartRef } },
    'mergeSegments',
    async (buffer, session) => {
      const verseBook = await verseBookOf(session, secondSegmentStartRef);
      await boundaryCommands.mergeSegments(buffer, { verseBook, secondSegmentStartRef });
      return [verseBook];
    },
  );
}

/**
 * Splits a segment so a new one begins at a token, first splitting every approved phrase the new
 * boundary would cut.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the project has no text for the token's book, the session is read-only or not open, or
 *   the edit is refused or fails. The error is logged before rethrowing.
 */
function splitSegment(
  sessionId: string,
  tokenRef: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: tokenRef } },
    'splitSegment',
    async (buffer, session) => {
      const verseBook = await verseBookOf(session, tokenRef);
      await boundaryCommands.splitSegment(buffer, { ...boundaryEditStamp(), verseBook, tokenRef });
      return [verseBook];
    },
  );
}

/**
 * Moves a segment boundary from one token to another, first splitting every approved phrase the
 * moved boundary would cut.
 *
 * @returns A JSON string of the {@link CommandReply}.
 * @throws If the project has no text for the book of the token the boundary moves to, the session
 *   is read-only or not open, or the edit is refused or fails. The error is logged before
 *   rethrowing.
 */
function moveBoundary(
  sessionId: string,
  fromRef: string,
  toRef: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runSessionEdit(
    { sessionId, changeId, step: { location: toRef } },
    'moveBoundary',
    async (buffer, session) => {
      const verseBook = await verseBookOf(session, toRef);
      await boundaryCommands.moveBoundary(buffer, {
        ...boundaryEditStamp(),
        verseBook,
        fromRef,
        toRef,
      });
      return [verseBook];
    },
  );
}

/**
 * The content of the project that the session's draft saves to, or `undefined` when it has none.
 *
 * @throws If the project is not stored, or reading it fails.
 */
async function savedContentOf(session: Session): Promise<DraftContent | undefined> {
  const { interlinearProjectId } = session.scope;
  if (interlinearProjectId === undefined) return undefined;
  const project = await projectStorage.getProject(executionToken, interlinearProjectId);
  if (!project) {
    throw new Error(`Interlinearizer: interlinear project ${interlinearProjectId} is not stored`);
  }
  return { analysis: project.analysis, segmentation: project.segmentation };
}

/** Whether the draft each discard left has a free translation, kept with the reply a retry gets. */
const discardLeftFreeTranslations = new WeakMap<CommandReply, boolean>();

/**
 * Runs an unsaved-change discard as one edit of a session's analysis, re-anchoring each book it
 * rewrites to the book's current text. A book the text lacks has its links go stale.
 *
 * @param target - The session whose draft the discard edits, and the change id it is sent under.
 * @param intent - Names the discard.
 * @param stage - Stages the discard over the stored draft, given the saved project's content.
 * @param unsavedMark - How the discard leaves the draft's unsaved mark, given whether the draft
 *   saves to a project.
 * @returns A JSON string of the {@link CommandReply}, with `hasFreeTranslations`: whether any
 *   segment of the draft the discard leaves has a free translation.
 * @throws If the saved project cannot be read, the session is read-only or not open, or the edit is
 *   refused or fails. The error is logged before rethrowing.
 */
async function runDiscard(
  { sessionId, changeId, step }: EditTarget,
  intent: string,
  stage: (
    buffer: ChangeBuffer,
    stored: DraftExport,
    saved: DraftContent | undefined,
  ) => discardCommands.DiscardOutcome,
  unsavedMark: (savesToProject: boolean) => EditOptions['unsavedMark'],
): Promise<string> {
  let hasFreeTranslations: boolean | undefined;
  try {
    const reply = await sessions.edit(
      sessionId,
      intent,
      async (buffer, session) => {
        const saved = await savedContentOf(session);
        const outcome = stage(buffer, await session.repository.exportAll(), saved);
        hasFreeTranslations = outcome.hasFreeTranslations;
        const { sourceProjectId } = session.scope;
        return Promise.all(
          outcome.changedBooks.map(
            async (bookCode) =>
              (await bookService.getVerseBook(sourceProjectId, bookCode)) ?? missingBook(bookCode),
          ),
        );
      },
      {
        unsavedMark: ({ scope }) => unsavedMark(scope.interlinearProjectId !== undefined),
        changeId: changeId ?? undefined,
        step,
      },
    );
    if (hasFreeTranslations === undefined) {
      /* v8 ignore next -- defensive: a reply lacks the flag only when a discard reuses a non-discard command's change id */
      hasFreeTranslations = discardLeftFreeTranslations.get(reply) ?? false;
    } else discardLeftFreeTranslations.set(reply, hasFreeTranslations);
    return JSON.stringify({ ...reply, hasFreeTranslations });
  } catch (e) {
    logger.error(`Interlinearizer: failed to ${intent} in session ${sessionId}`, e);
    throw e;
  }
}

/**
 * Discards the unsaved changes to one book of a session's draft, restoring the book as the draft's
 * project holds it, or emptying the book when the draft has no project. A book whose stored
 * analysis could not be read keeps it. A draft saving to a project stays as saved or unsaved as it
 * was; one saving to none is marked unsaved when the discard changes anything.
 *
 * @returns As {@link runDiscard} does.
 * @throws As {@link runDiscard} does.
 */
function discardBook(
  sessionId: string,
  bookCode: string,
  changeId?: ChangeId | null,
): Promise<string> {
  return runDiscard(
    { sessionId, changeId, step: { summary: { kind: 'discardBook', book: bookCode } } },
    'discardBook',
    (buffer, stored, saved) => discardCommands.discardBook(buffer, stored, bookCode, saved),
    (savesToProject) => (savesToProject ? 'keep' : undefined),
  );
}

/**
 * Discards every unsaved change to a session's draft, restoring what the draft's project holds, or
 * emptying the draft when it has no project. A book whose stored analysis could not be read keeps
 * it. The draft is marked saved.
 *
 * @returns As {@link runDiscard} does.
 * @throws As {@link runDiscard} does.
 */
function discardAll(sessionId: string, changeId?: ChangeId | null): Promise<string> {
  return runDiscard(
    { sessionId, changeId, step: { summary: { kind: 'discardAll' } } },
    'discardAll',
    discardCommands.discardAll,
    () => 'clear',
  );
}

/**
 * Names the token analyses a command would remove from a session's draft, applying nothing.
 *
 * @returns A JSON string of the ids; `"[]"` when it would remove none.
 * @throws If the session is not open, the request names an intent it can't preview, or staging the
 *   command fails. The error is logged before rethrowing.
 */
async function previewRemovals(sessionId: string, request: RemovalPreviewRequest): Promise<string> {
  try {
    const changes = await sessions.preview(sessionId, request.intent, (buffer, session) => {
      const { now, linkId, analysisId: copyId } = editStamp();
      switch (request.intent) {
        case 'clearAnalysisGlosses':
          return catalogCommands.clearAnalysisGlosses(buffer, {
            analysisIds: request.analysisIds,
            analysisLanguage: session.analysisLanguage,
            now,
          });
        case 'discardStaleAnalysis':
          return staleCommands.discardStaleAnalysis(buffer, request);
        case 'reapplyStaleAnalysis':
          return staleCommands.reapplyStaleAnalysis(buffer, { ...request, copyId, linkId, now });
        default:
          throw new Error(
            `Interlinearizer: cannot preview the removals of ${JSON.stringify(request)}`,
          );
      }
    });
    return JSON.stringify(changes.tokenAnalyses?.deletes ?? []);
  } catch (e) {
    logger.error(`Interlinearizer: failed to preview removals in session ${sessionId}`, e);
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
  leftOutDraftBooks.clear();
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
    openWebViewsByProject.set(webView.projectId, webView.id);
  }
  const webViewOpenUnsubscriber = papi.webViews.onDidOpenWebView(trackWebView);
  const webViewUpdateUnsubscriber = papi.webViews.onDidUpdateWebView(trackWebView);

  const webViewCloseUnsubscriber = papi.webViews.onDidCloseWebView(({ webView }) => {
    if (webView.webViewType !== mainWebViewType || !webView.projectId) return;
    if (openWebViewsByProject.get(webView.projectId) !== webView.id) return;
    openWebViewsByProject.delete(webView.projectId);
    bookService.closeProject(webView.projectId);
  });
  // Added ahead of the registrations below, so a failure among them still disposes these.
  context.registrations.add(
    webViewOpenUnsubscriber,
    webViewUpdateUnsubscriber,
    webViewCloseUnsubscriber,
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

  const saveDraftToProjectCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.saveDraftToProject',
    saveDraftToProject,
    {
      method: {
        summary: "Copy a source project's stored draft into an existing interlinearizer project",
        params: [
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

  const getDraftCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getDraft',
    getInterlinearDraft,
    {
      method: {
        summary: 'Return the draft working buffer for a source project as a JSON string',
        params: [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible source project ID whose draft to fetch',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'JSON-stringified DraftProject; a fresh empty draft when none exists',
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

  /** The parameter naming the source project, or the session, whose text a query reads. */
  const textAddressParam = {
    name: 'address',
    required: true as const,
    summary:
      'Platform.Bible source project ID, or { sessionId } to read the source of a session and its analysis too',
    schema: {
      anyOf: [
        { type: 'string' as const },
        {
          type: 'object' as const,
          properties: { sessionId: { type: 'string' as const } },
          required: ['sessionId'],
        },
      ],
    },
  };

  /** Parameters naming the book a segment query reads. */
  const bookParams = [
    textAddressParam,
    {
      name: 'bookId',
      required: true,
      summary: 'Book code, such as GEN',
      schema: { type: 'string' },
    },
  ] as const;
  const segmentationParam = {
    name: 'segmentationJson',
    required: false,
    summary:
      "JSON-stringified SegmentationDelta of the book's custom boundaries; omit for one segment per verse, and for a session, which segments by its draft's",
    schema: { type: 'string' },
  } as const;

  const getBookOutlineCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.getBookOutline',
    getBookOutline,
    {
      method: {
        summary: "Return the outline of a source project's book, as a JSON string",
        params: [...bookParams, segmentationParam],
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
        summary: "Return a run of a source project's book's segments, as a JSON string",
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
          segmentationParam,
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
          "Return how far reading a source project's whole text has got, starting the read when the project has none, as a JSON string",
        params: [textAddressParam],
        result: {
          name: 'return value',
          summary: 'JSON-stringified TextReadStatus',
          schema: { type: 'string' },
        },
      },
    },
  );

  const saveDraftCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.saveDraft',
    saveInterlinearDraft,
    {
      method: {
        summary: 'Persist the draft working buffer for a source project',
        params: [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible source project ID whose draft to write',
            schema: { type: 'string' },
          },
          {
            name: 'draftJson',
            required: true,
            summary: 'JSON-stringified DraftProject to persist',
            schema: { type: 'string' },
          },
          {
            name: 'discardUnreadable',
            required: false,
            summary:
              'Whether the draft was started over (New, Open), so stored analysis that could not be read is discarded rather than kept',
            schema: { type: 'boolean' },
          },
        ],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  /** The parameter naming the session a session command acts on. */
  const sessionIdParam = {
    name: 'sessionId',
    required: true,
    summary: 'ID of the session, as openSession returned it',
    schema: { type: 'string' },
  } as const;

  /** The parameter naming the change a session command makes. */
  const changeIdParam = {
    name: 'changeId',
    required: false,
    summary:
      'Names the change; a command sent again under the id of a change the session has applied replies as it did then, applying nothing. Omit to have the session name it',
    schema: { type: 'string' },
  } as const;

  const openSessionCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.openSession',
    openSession,
    {
      method: {
        summary:
          "Open a session on a source project's draft, or read-only on its Paratext 9 import, closing the source's earlier session",
        params: [
          {
            name: 'sourceProjectId',
            required: true,
            summary: 'Platform.Bible source project ID whose analysis to open',
            schema: { type: 'string' },
          },
          {
            name: 'interlinearProjectId',
            required: false,
            summary:
              'UUID of the interlinear project the draft saves to, or of the Paratext 9 import to read; omit for the draft alone',
            schema: { type: 'string' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'JSON-stringified { sessionId, readOnly, hasFreeTranslations }',
          schema: { type: 'string' },
        },
      },
    },
  );

  const closeSessionCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.closeSession',
    (sessionId: string) => sessions.close(sessionId),
    {
      method: {
        summary: 'Close a session once the commands sent to it settle',
        params: [sessionIdParam],
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
        params: [
          sessionIdParam,
          {
            name: 'analysisLanguage',
            required: true,
            summary: 'BCP 47 tag of the language',
            schema: { type: 'string' },
          },
        ],
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
        params: [sessionIdParam, changeIdParam],
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
        params: [sessionIdParam, changeIdParam],
        result: appliedChangesResult,
      },
    },
  );

  /** The parameters naming the token a token edit acts on. */
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

  const writeGlossCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.writeGloss',
    writeGloss,
    {
      method: {
        summary: "Write a token's gloss in a session's analysis language; a blank value clears it",
        params: [
          sessionIdParam,
          ...tokenParams,
          {
            name: 'value',
            required: true,
            summary: 'The gloss',
            schema: { type: 'string' },
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const approveAnalysisForTokenCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.approveAnalysisForToken',
    approveAnalysisForToken,
    {
      method: {
        summary:
          'Approve a stored token analysis for a token, in place of any approval the token held',
        params: [
          sessionIdParam,
          ...tokenParams,
          {
            name: 'analysisId',
            required: true,
            summary: 'Id of the stored token analysis to approve',
            schema: { type: 'string' },
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const writeMorphemesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.writeMorphemes',
    writeMorphemes,
    {
      method: {
        summary: "Write a token's morpheme breakdown",
        params: [
          sessionIdParam,
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
        ],
        result: editResult,
      },
    },
  );

  const deleteMorphemesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.deleteMorphemes',
    deleteMorphemes,
    {
      method: {
        summary: "Remove a token's morpheme breakdown",
        params: [sessionIdParam, tokenParams[0], changeIdParam],
        result: editResult,
      },
    },
  );

  const writeMorphemeGlossCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.writeMorphemeGloss',
    writeMorphemeGloss,
    {
      method: {
        summary:
          "Gloss one morpheme of a token's breakdown in a session's analysis language; a blank value clears the morpheme's gloss",
        params: [
          sessionIdParam,
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
        ],
        result: editResult,
      },
    },
  );

  const staleAnalysisParam = {
    name: 'analysisId',
    required: true,
    summary: 'Id of the token analysis the stale link names',
    schema: { type: 'string' },
  } as const;

  const discardStaleAnalysisCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.discardStaleAnalysis',
    discardStaleAnalysis,
    {
      method: {
        summary: 'Give up the place an analysis went stale at, leaving its other places alone',
        params: [
          sessionIdParam,
          staleAnalysisParam,
          {
            name: 'tokenRef',
            required: true,
            summary: 'Token.ref the stale link names',
            schema: { type: 'string' },
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const reapplyStaleAnalysisCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.reapplyStaleAnalysis',
    reapplyStaleAnalysis,
    {
      method: {
        summary:
          'Move an analysis from a place it went stale at onto a token, approving it there in place of whatever the token held',
        params: [
          sessionIdParam,
          staleAnalysisParam,
          {
            name: 'staleTokenRef',
            required: true,
            summary: 'Token.ref the stale link names',
            schema: { type: 'string' },
          },
          ...tokenParams,
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const staleTranslationParam = {
    name: 'analysisId',
    required: true,
    summary: 'Id of the stale segment analysis',
    schema: { type: 'string' },
  } as const;

  const keepStaleFreeTranslationCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.keepStaleFreeTranslation',
    keepStaleFreeTranslation,
    {
      method: {
        summary:
          "Keep a stale free translation as a claim about a segment's current text, approving it for that segment",
        params: [
          sessionIdParam,
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
        ],
        result: editResult,
      },
    },
  );

  const discardStaleFreeTranslationCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.discardStaleFreeTranslation',
    discardStaleFreeTranslation,
    {
      method: {
        summary: 'Drop a stale free translation, one whose verse the book no longer holds included',
        params: [sessionIdParam, staleTranslationParam, changeIdParam],
        result: editResult,
      },
    },
  );

  /** The parameter naming the token analysis that a catalog-wide edit acts on. */
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

  const writeAnalysisGlossCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.writeAnalysisGloss',
    writeAnalysisGloss,
    {
      method: {
        summary:
          "Write a token analysis's gloss in a session's analysis language, for every token linked to it; a blank value clears it",
        params: [
          sessionIdParam,
          catalogAnalysisParam,
          { name: 'value', required: true, summary: 'The gloss', schema: { type: 'string' } },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const clearAnalysisGlossesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.clearAnalysisGlosses',
    clearAnalysisGlosses,
    {
      method: {
        summary: "Clear the glosses of several token analyses in a session's analysis language",
        params: [sessionIdParam, analysisIdsParam, changeIdParam],
        result: editResult,
      },
    },
  );

  const writeAnalysisMorphemesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.writeAnalysisMorphemes',
    writeAnalysisMorphemes,
    {
      method: {
        summary:
          "Re-split a token analysis's breakdown, for every token linked to it; no forms removes the breakdown",
        params: [
          sessionIdParam,
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
        ],
        result: editResult,
      },
    },
  );

  const confirmAnalysisMorphemesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.confirmAnalysisMorphemes',
    confirmAnalysisMorphemes,
    {
      method: {
        summary:
          "Keep a token analysis's stale breakdown as it stands, for every token linked to it",
        params: [sessionIdParam, catalogAnalysisParam, changeIdParam],
        result: editResult,
      },
    },
  );

  const writeAnalysisMorphemeGlossCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.writeAnalysisMorphemeGloss',
    writeAnalysisMorphemeGloss,
    {
      method: {
        summary:
          "Write the gloss of one morpheme of a token analysis in a session's analysis language, for every token linked to it; a blank value clears it",
        params: [
          sessionIdParam,
          catalogAnalysisParam,
          {
            name: 'morphemeId',
            required: true,
            summary: 'MorphemeAnalysis.id of the morpheme glossed',
            schema: { type: 'string' },
          },
          { name: 'value', required: true, summary: 'The gloss', schema: { type: 'string' } },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const deleteAnalysesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.deleteAnalyses',
    deleteAnalyses,
    {
      method: {
        summary: 'Remove token analyses with every token link to them',
        params: [sessionIdParam, analysisIdsParam, changeIdParam],
        result: editResult,
      },
    },
  );

  const mergeAnalysesIntoCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.mergeAnalysesInto',
    mergeAnalysesInto,
    {
      method: {
        summary:
          "Fold token analyses into a survivor and write the settled content onto it, in a session's analysis language",
        params: [
          sessionIdParam,
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
        ],
        result: editResult,
      },
    },
  );

  /** The parameter naming the phrase occurrence a phrase edit acts on. */
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

  const createPhraseCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.createPhrase',
    createPhrase,
    {
      method: {
        summary:
          'Add an approved phrase occurrence, sharing a content-identical stored payload where one exists',
        params: [
          sessionIdParam,
          {
            name: 'tokens',
            required: true,
            summary: "The phrase's token snapshots, in document order",
            schema: tokenSnapshotsSchema,
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const updatePhraseCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.updatePhrase',
    updatePhrase,
    {
      method: {
        summary:
          'Give a phrase occurrence a new token run, keeping its gloss; an empty run removes it',
        params: [
          sessionIdParam,
          phraseIdParam,
          {
            name: 'tokens',
            required: true,
            summary: 'The new token snapshots, in document order',
            schema: tokenSnapshotsSchema,
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const deletePhraseCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.deletePhrase',
    deletePhrase,
    {
      method: {
        summary: 'Remove a phrase occurrence, with its payload unless another occurrence shares it',
        params: [sessionIdParam, phraseIdParam, changeIdParam],
        result: editResult,
      },
    },
  );

  const mergePhrasesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.mergePhrases',
    mergePhrases,
    {
      method: {
        summary:
          'Grow a phrase occurrence to a merged token run, removing the absorbed occurrence when named',
        params: [
          sessionIdParam,
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
        ],
        result: editResult,
      },
    },
  );

  const writePhraseGlossCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.writePhraseGloss',
    writePhraseGloss,
    {
      method: {
        summary:
          "Write a phrase occurrence's gloss in a session's analysis language; a blank value clears it",
        params: [
          sessionIdParam,
          phraseIdParam,
          {
            name: 'value',
            required: true,
            summary: 'The gloss',
            schema: { type: 'string' },
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const approvePhraseCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.approvePhrase',
    approvePhrase,
    {
      method: {
        summary: 'Approve a phrase occurrence, unless any of its tokens is in an approved phrase',
        params: [sessionIdParam, phraseIdParam, changeIdParam],
        result: editResult,
      },
    },
  );

  const splitPhraseCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.splitPhrase',
    splitPhrase,
    {
      method: {
        summary:
          "Split a phrase occurrence just after a token, in the document order of the token's book",
        params: [
          sessionIdParam,
          phraseIdParam,
          {
            name: 'splitAfterTokenRef',
            required: true,
            summary: 'Token.ref of the token the first half ends with',
            schema: { type: 'string' },
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const writeSegmentFreeTranslationCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.writeSegmentFreeTranslation',
    writeSegmentFreeTranslation,
    {
      method: {
        summary:
          "Write a segment's free translation in a session's analysis language; a blank value clears it",
        params: [
          sessionIdParam,
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
        ],
        result: editResult,
      },
    },
  );

  const mergeSegmentsCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.mergeSegments',
    mergeSegments,
    {
      method: {
        summary: 'Merge the segment beginning at a token into the one before it',
        params: [
          sessionIdParam,
          {
            name: 'secondSegmentStartRef',
            required: true,
            summary: 'Token.ref of the first token of the segment merged away',
            schema: { type: 'string' },
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const splitSegmentCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.splitSegment',
    splitSegment,
    {
      method: {
        summary:
          'Split a segment so a new one begins at a token, first splitting every approved phrase the boundary would cut',
        params: [
          sessionIdParam,
          {
            name: 'tokenRef',
            required: true,
            summary: 'Token.ref of the token the new segment begins with',
            schema: { type: 'string' },
          },
          changeIdParam,
        ],
        result: editResult,
      },
    },
  );

  const moveBoundaryCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.moveBoundary',
    moveBoundary,
    {
      method: {
        summary:
          'Move a segment boundary from one token to another, first splitting every approved phrase the moved boundary would cut',
        params: [
          sessionIdParam,
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
        ],
        result: editResult,
      },
    },
  );

  const discardResult = {
    name: 'return value',
    summary:
      'JSON-stringified CommandReply with hasFreeTranslations: the ChangeSet the discard applied and the pool buckets it touched; whether any segment of the draft the discard leaves has a free translation',
    schema: { type: 'string' },
  } as const;

  const discardBookCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.discardBook',
    discardBook,
    {
      method: {
        summary:
          "Discard the unsaved changes to one book of a session's draft, restoring what the project it saves to holds for the book",
        params: [
          sessionIdParam,
          {
            name: 'bookCode',
            required: true,
            summary: 'Three-letter code of the book discarded',
            schema: { type: 'string' },
          },
          changeIdParam,
        ],
        result: discardResult,
      },
    },
  );

  const discardAllCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.discardAll',
    discardAll,
    {
      method: {
        summary:
          "Discard every unsaved change to a session's draft, restoring what the project it saves to holds",
        params: [sessionIdParam, changeIdParam],
        result: discardResult,
      },
    },
  );

  const previewRemovalsCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.previewRemovals',
    previewRemovals,
    {
      method: {
        summary: "Name the token analyses a command would remove from a session's draft",
        params: [
          sessionIdParam,
          {
            name: 'request',
            required: true,
            summary: 'RemovalPreviewRequest naming the command by intent, with its arguments',
            schema: { type: 'object' },
          },
        ],
        result: {
          name: 'return value',
          summary: 'JSON-stringified ids of the token analyses; "[]" when it would remove none',
          schema: { type: 'string' },
        },
      },
    },
  );

  const checkIndexesCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.checkIndexes',
    checkIndexes,
    {
      method: {
        summary:
          "Report where a session's derived indexes differ from ones built afresh from its records, for debugging",
        params: [sessionIdParam],
        result: {
          name: 'return value',
          summary: 'JSON-stringified IndexDifference[]; "[]" when none differ',
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
            "JSON-stringified { outcome: 'imported' | 'staleKept', projectId, report? }; rejects (throws) when the source has nothing to import or the import fails",
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
          'Open the project-info modal for the active project in the Interlinearizer WebView',
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

  analysisChangedEmitter = await papi.network.createNetworkEventEmitterAsync(
    'interlinearizer.onAnalysisChanged',
  );
  const bookReadUnsubscriber = bookService.onBookRead((sourceProjectId, book) =>
    sessions
      .reanchorBook(sourceProjectId, book)
      .catch((e) =>
        logger.warn(
          `Interlinearizer: could not re-anchor ${book.bookRef} of project ${sourceProjectId}`,
          e,
        ),
      ),
  );
  const textReadUnsubscriber = bookService.onTextRead((sourceProjectId, textBookIds) =>
    sessions
      .reanchorMissingBooks(sourceProjectId, textBookIds)
      .catch((e) =>
        logger.warn(
          `Interlinearizer: could not re-anchor the books project ${sourceProjectId} lacks`,
          e,
        ),
      ),
  );
  // A book's new text reaches its pass before its edit is reported, so the event waits for the pass.
  const bookTextUnsubscriber = bookService.onBookTextChanged((sourceProjectId, bookId) =>
    sessions.settled(sourceProjectId).then(() => emitScriptureEdit(sourceProjectId, bookId)),
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
    getDraftCommandRegistration,
    getTokenizedBookCommandRegistration,
    getBookOutlineCommandRegistration,
    getSegmentsCommandRegistration,
    getTextReadStatusCommandRegistration,
    saveDraftCommandRegistration,
    openSessionCommandRegistration,
    closeSessionCommandRegistration,
    setAnalysisLanguageCommandRegistration,
    undoEditCommandRegistration,
    redoEditCommandRegistration,
    checkIndexesCommandRegistration,
    writeGlossCommandRegistration,
    approveAnalysisForTokenCommandRegistration,
    writeMorphemesCommandRegistration,
    deleteMorphemesCommandRegistration,
    writeMorphemeGlossCommandRegistration,
    discardStaleAnalysisCommandRegistration,
    reapplyStaleAnalysisCommandRegistration,
    keepStaleFreeTranslationCommandRegistration,
    discardStaleFreeTranslationCommandRegistration,
    writeAnalysisGlossCommandRegistration,
    clearAnalysisGlossesCommandRegistration,
    writeAnalysisMorphemesCommandRegistration,
    confirmAnalysisMorphemesCommandRegistration,
    writeAnalysisMorphemeGlossCommandRegistration,
    deleteAnalysesCommandRegistration,
    mergeAnalysesIntoCommandRegistration,
    createPhraseCommandRegistration,
    updatePhraseCommandRegistration,
    deletePhraseCommandRegistration,
    mergePhrasesCommandRegistration,
    writePhraseGlossCommandRegistration,
    approvePhraseCommandRegistration,
    splitPhraseCommandRegistration,
    writeSegmentFreeTranslationCommandRegistration,
    mergeSegmentsCommandRegistration,
    splitSegmentCommandRegistration,
    moveBoundaryCommandRegistration,
    discardBookCommandRegistration,
    discardAllCommandRegistration,
    previewRemovalsCommandRegistration,
    setPerfMarksCommandRegistration,
    readPerfCommandRegistration,
    updateProjectMetadataCommandRegistration,
    importPt9ProjectCommandRegistration,
    createEditableCopyCommandRegistration,
    deleteProjectCommandRegistration,
    openSelectProjectModalCommandRegistration,
    openNewProjectModalCommandRegistration,
    openProjectInfoModalCommandRegistration,
    openAnalysisCatalogCommandRegistration,
    openConcordanceCommandRegistration,
    undoCommandRegistration,
    redoCommandRegistration,
    undoFromNotificationEmitter,
    undoFromNotificationCommandRegistration,
    analysisChangedEmitter,
    bookReadUnsubscriber,
    textReadUnsubscriber,
    bookTextUnsubscriber,
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
  await sessions.closeAll();
  await bookService.closeAllProjects();
  logger.debug('Interlinearizer extension is deactivating!');
  return true;
}

// #endregion
