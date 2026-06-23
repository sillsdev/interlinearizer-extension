import papi, { logger } from '@papi/backend';
import type {
  ExecutionActivationContext,
  ExecutionToken,
  IWebViewProvider,
  OpenWebViewOptions,
  SavedWebViewDefinition,
  WebViewDefinition,
} from '@papi/core';
import interlinearizerReact from './interlinearizer.web-view?inline';
import interlinearizerStyles from './interlinearizer.web-view.scss?inline';
import * as projectStorage from './services/projectStorage';
import { isDraftProject, isTextAnalysis } from './types/type-guards';

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
}

/** WebView provider that provides the Interlinearizer React WebView when Platform.Bible requests it. */
const mainWebViewProvider: IWebViewProvider = {
  /**
   * Returns the Interlinearizer WebView definition (React component + styles) for the given saved
   * definition. Rejects if the requested webViewType does not match this provider's type.
   *
   * @param savedWebView - Platform-provided definition (webViewType, etc.).
   * @param openWebViewOptions - Options passed by the caller; may include a projectId to link.
   * @returns WebView definition with title, content, and styles.
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
    return {
      ...savedWebView,
      projectId: openWebViewOptions?.projectId ?? savedWebView.projectId,
      title: 'Interlinearizer',
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
 * tab to front instead of opening a duplicate. Populated and pruned via `onDidOpenWebView` and
 * `onDidCloseWebView` subscriptions registered during activation.
 */
const openWebViewsByProject = new Map<string, string>();

// #endregion

// #region Command handlers

/**
 * Opens the Interlinearizer WebView for the given project. If no projectId is provided, shows a
 * project picker dialog. Each project gets its own tab; reopening an already-open project brings
 * that tab to front.
 *
 * @param projectId - Project to open; if omitted a picker dialog is shown.
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

  const options: InterlinearizerOpenOptions = {
    existingId: openWebViewsByProject.get(resolvedProjectId),
    projectId: resolvedProjectId,
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
 * @throws Any error thrown by {@link openInterlinearizer} (dialog or WebView errors).
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
 * @returns JSON-stringified `InterlinearProject` for the new project.
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
 * @param interlinearProjectId - UUID of the interlinearizer project to delete.
 * @returns A promise that resolves when the deletion (or no-op) is complete.
 * @throws {SyntaxError} If the project-IDs index contains invalid JSON (propagated from
 *   `projectStorage.deleteProject`).
 * @throws If `papi.storage.deleteUserData` rejects for a non-ENOENT reason, or if
 *   `papi.storage.writeUserData` rejects when updating the index. All storage errors are logged and
 *   shown as a notification before being re-thrown so the caller can handle failure UX.
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
 * user saves edits in the project info modal. Returns the updated project as a JSON string, or
 * `undefined` if no project with the given ID exists.
 *
 * @param interlinearProjectId - UUID of the interlinearizer project to update.
 * @param name - New user-facing name, or `undefined` to clear it.
 * @param description - New user-facing description, or `undefined` to clear it.
 * @param analysisLanguages - New BCP 47 analysis language tags. Required and must be non-empty;
 *   pass the current value to leave it unchanged.
 * @param targetProjectId - New target-project ID; omit to clear the target binding.
 * @returns JSON string of the updated `InterlinearProject`, or `undefined` if the project ID is not
 *   found.
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
 * Returns the interlinearizer project with the given ID as a JSON string, including its full
 * `TextAnalysis`. The WebView calls this when the active project changes to load the stored
 * analysis into the interlinearizer.
 *
 * @param interlinearProjectId - UUID of the interlinearizer project to fetch.
 * @returns JSON-stringified `InterlinearProject`, or `undefined` if no project with that ID exists.
 * @throws {SyntaxError} If the project's storage value contains invalid JSON.
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
 * Persists an updated `TextAnalysis` for an interlinearizer project. Called from the WebView via
 * `papi.commands.sendCommand` after each gloss write so that analysis changes survive tab restores
 * and project switches.
 *
 * @param interlinearProjectId - UUID of the interlinearizer project to update.
 * @param analysisJson - JSON-stringified `TextAnalysis` to persist.
 * @returns A promise that resolves when the analysis has been written to storage.
 * @throws If JSON parsing, validation, or storage fails. The error is logged and an error
 *   notification is sent before rethrowing so the frontend `catch` block can suppress it without a
 *   second notification.
 */
async function saveInterlinearAnalysis(
  interlinearProjectId: string,
  analysisJson: string,
): Promise<void> {
  try {
    const analysis = JSON.parse(analysisJson);
    if (!isTextAnalysis(analysis)) {
      throw new TypeError('saveInterlinearAnalysis: analysisJson does not conform to TextAnalysis');
    }
    await projectStorage.updateAnalysis(executionToken, interlinearProjectId, analysis);
  } catch (e) {
    logger.error('Interlinearizer: failed to save analysis', e);
    await papi.notifications
      .send({
        message: '%interlinearizer_error_save_analysis_failed%',
        severity: 'error',
      })
      .catch(() => {});
    throw e;
  }
}

/**
 * Returns the draft working buffer for a source project as a JSON string, creating a fresh empty
 * draft when none has been written. The WebView loads this on mount to seed the editor.
 *
 * @param sourceProjectId - Platform.Bible source project ID whose draft to fetch.
 * @returns JSON-stringified `DraftProject`.
 * @throws {SyntaxError} If the draft's storage value contains invalid JSON.
 * @throws If `papi.storage.readUserData` rejects for a non-ENOENT reason. The error is logged
 *   before rethrowing.
 */
async function getInterlinearDraft(sourceProjectId: string): Promise<string> {
  try {
    const draft = await projectStorage.getDraft(executionToken, sourceProjectId);
    return JSON.stringify(draft);
  } catch (e) {
    logger.error('Interlinearizer: failed to get draft', e);
    throw e;
  }
}

/**
 * Persists the draft working buffer for a source project. Called from the WebView after every edit
 * (auto-save) and whenever the draft is reset (New), opened from a project, or wiped.
 *
 * @param sourceProjectId - Platform.Bible source project ID whose draft to write.
 * @param draftJson - JSON-stringified `DraftProject` to persist.
 * @returns A promise that resolves when the draft has been written to storage.
 * @throws If JSON parsing, validation, or storage fails. The error is logged and an error
 *   notification is sent before rethrowing so the frontend `catch` block can suppress it without a
 *   second notification.
 */
async function saveInterlinearDraft(sourceProjectId: string, draftJson: string): Promise<void> {
  try {
    const draft = JSON.parse(draftJson);
    if (!isDraftProject(draft)) {
      throw new TypeError('saveInterlinearDraft: draftJson does not conform to DraftProject');
    }
    await projectStorage.saveDraft(executionToken, sourceProjectId, draft);
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
}

/**
 * Returns all interlinearizer projects for the given source project as a JSON string. The WebView
 * deserializes this to populate its project picker and to decide whether to prompt "create new" or
 * "select existing" when the user opens the project menu.
 *
 * @param sourceProjectId - Platform.Bible project ID of the source text to query.
 * @returns A JSON string of `InterlinearProject[]`, or `"[]"` if none exist.
 * @throws {SyntaxError} If the project-IDs index contains invalid JSON. Corrupted individual
 *   project records are logged and skipped, not thrown.
 * @throws If `papi.storage.readUserData` rejects for a non-ENOENT reason (propagated from
 *   `projectStorage.getProjectsForSource`). Callers can use this to distinguish a storage outage
 *   from a legitimately empty list.
 */
async function getProjectsForSource(sourceProjectId: string): Promise<string> {
  try {
    const projects = await projectStorage.getProjectsForSource(executionToken, sourceProjectId);
    return JSON.stringify(projects);
  } catch (e) {
    logger.error('Interlinearizer: failed to list projects for source', e);
    throw e;
  }
}

// #endregion

// #region Lifecycle

/**
 * Extension entry point. Registers the Interlinearizer WebView provider and the open command.
 * Called by the platform when the extension is loaded.
 *
 * @param context - Activation context; used to register disposables so the platform can clean them
 *   up on deactivation.
 * @returns A promise that resolves when all registrations are complete.
 */
export async function activate(context: ExecutionActivationContext): Promise<void> {
  logger.debug('Interlinearizer extension is activating!');

  executionToken = context.executionToken;

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
        // response, so the schema only describes the shape when a value is present. All other
        // WebView-opening commands in paranext-core use `{ type: 'string' }` for this same pattern
        // (e.g. platform-scripture-editor openScriptureEditor, platform-get-resources).
        result: {
          name: 'return value',
          summary: 'The ID of the opened WebView, if opened; omitted when the user cancels',
          schema: { type: 'string' },
        },
      },
    },
  );

  /**
   * Returns whether the supplied project-setting value is a boolean.
   *
   * @param newValue - Candidate project-setting value.
   * @returns A promise that resolves to `true` when `newValue` is a boolean.
   */
  /* v8 ignore next 3 */
  function isBoolean(newValue: unknown): Promise<boolean> {
    return Promise.resolve(typeof newValue === 'boolean');
  }

  const continuousScrollValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.continuousScroll',
    isBoolean,
  );

  const hideInactiveLinkButtonsValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.hideInactiveLinkButtons',
    isBoolean,
  );

  const simplifyPhrasesValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.simplifyPhrases',
    isBoolean,
  );

  const chapterLabelInVerseValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.chapterLabelInVerse',
    isBoolean,
  );

  const showMorphologyValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.showMorphology',
    isBoolean,
  );

  const showFreeTranslationValidatorRegistration = await papi.projectSettings.registerValidator(
    'interlinearizer.showFreeTranslation',
    isBoolean,
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

  const saveAnalysisCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.saveAnalysis',
    saveInterlinearAnalysis,
    {
      method: {
        summary: 'Persist an updated TextAnalysis for an interlinearizer project',
        params: [
          {
            name: 'interlinearProjectId',
            required: true,
            summary: 'UUID of the interlinearizer project to update',
            schema: { type: 'string' },
          },
          {
            name: 'analysisJson',
            required: true,
            summary: 'JSON-stringified TextAnalysis to persist',
            schema: { type: 'string' },
          },
        ],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
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
          summary: 'JSON-stringified InterlinearProject[] for the given source',
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
        ],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
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

  const wipeCommandRegistration = await papi.commands.registerCommand(
    'interlinearizer.wipe',
    // Handled entirely in the WebView; backend registration makes the command known to the platform.
    /* v8 ignore next */ async () => {},
    {
      method: {
        summary:
          "Open the wipe dialog to remove the current book's or the whole draft's analysis (handled in the WebView)",
        params: [],
        result: { name: 'return value', summary: 'void', schema: { type: 'null' } },
      },
    },
  );

  const webViewOpenUnsubscriber = papi.webViews.onDidOpenWebView(({ webView }) => {
    if (webView.webViewType !== mainWebViewType || !webView.projectId) return;
    openWebViewsByProject.set(webView.projectId, webView.id);
  });

  const webViewCloseUnsubscriber = papi.webViews.onDidCloseWebView(({ webView }) => {
    if (webView.webViewType !== mainWebViewType || !webView.projectId) return;
    if (openWebViewsByProject.get(webView.projectId) === webView.id)
      openWebViewsByProject.delete(webView.projectId);
  });

  context.registrations.add(
    mainWebViewProviderRegistration,
    openForWebViewCommandRegistration,
    continuousScrollValidatorRegistration,
    hideInactiveLinkButtonsValidatorRegistration,
    simplifyPhrasesValidatorRegistration,
    chapterLabelInVerseValidatorRegistration,
    showMorphologyValidatorRegistration,
    showFreeTranslationValidatorRegistration,
    createProjectCommandRegistration,
    getProjectCommandRegistration,
    saveAnalysisCommandRegistration,
    getProjectsForSourceCommandRegistration,
    getDraftCommandRegistration,
    saveDraftCommandRegistration,
    updateProjectMetadataCommandRegistration,
    deleteProjectCommandRegistration,
    openSelectProjectModalCommandRegistration,
    openNewProjectModalCommandRegistration,
    openProjectInfoModalCommandRegistration,
    saveCommandRegistration,
    openSaveAsModalCommandRegistration,
    wipeCommandRegistration,
    webViewOpenUnsubscriber,
    webViewCloseUnsubscriber,
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
  logger.debug('Interlinearizer extension is deactivating!');
  return true;
}

// #endregion
