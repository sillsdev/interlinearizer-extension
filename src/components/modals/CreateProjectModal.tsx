import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { useState, useCallback, useRef } from 'react';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import { isInterlinearProjectSummary } from '../../types/type-guards';

/** Localized string keys used by {@link CreateProjectModal}. */
const CREATE_PROJECT_MODAL_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_modal_create_title%',
  '%interlinearizer_modal_create_name_label%',
  '%interlinearizer_modal_create_name_placeholder%',
  '%interlinearizer_modal_create_description_label%',
  '%interlinearizer_modal_create_description_placeholder%',
  '%interlinearizer_modal_create_language_label%',
  '%interlinearizer_modal_create_language_placeholder%',
  '%interlinearizer_modal_create_submit%',
  '%interlinearizer_modal_create_cancel%',
];

/**
 * Modal dialog that collects project name, description, and analysis language tag before creating a
 * new interlinear project. Submitting sends the `interlinearizer.createProject` command with the
 * known source project ID and the entered values.
 *
 * @param props - Component props
 * @param props.projectId - Source project to create the interlinear project for
 * @param props.defaultAnalysisLanguage - BCP 47 tag pre-populated in the analysis language field;
 *   caller should pass the platform UI language so the user sees a sensible starting value.
 *   Defaults to `'und'` when absent.
 * @param props.onClose - Callback invoked when the modal should be dismissed (cancel or submit)
 * @param props.onProjectCreated - Optional callback invoked with the full persisted project after
 *   successful creation, before `onClose` is called.
 * @returns The modal overlay with name, description, language inputs and submit/cancel buttons, or
 *   nothing while localized strings are loading.
 */
export function CreateProjectModal({
  projectId,
  defaultAnalysisLanguage,
  onClose,
  onProjectCreated,
}: Readonly<{
  projectId: string;
  /** BCP 47 tag pre-populated in the analysis language field; defaults to `'und'` when absent. */
  defaultAnalysisLanguage?: string;
  onClose: () => void;
  onProjectCreated?: (project: InterlinearProjectSummary) => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(CREATE_PROJECT_MODAL_STRING_KEYS);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [analysisLanguages, setAnalysisLanguages] = useState(defaultAnalysisLanguage ?? 'und');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  /**
   * Sends the `interlinearizer.createProject` command with the collected form values, then notifies
   * the caller via `onProjectCreated` and closes the modal. Shows a user-visible error notification
   * if the response cannot be parsed (SyntaxError); for other errors, logs and defers to the
   * backend command handler to surface the notification.
   *
   * The analysis-languages input is interpreted as a comma-separated list of BCP 47 tags; entries
   * are trimmed and empty entries dropped. Falls back to `['und']` when the user clears the field.
   *
   * @returns A promise that resolves when the command completes or the error is handled.
   */
  const handleSubmit = useCallback(async () => {
    /* v8 ignore next -- button is disabled while submitting; ref guards against programmatic races */
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    const parsedLanguages = analysisLanguages
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const normalizedAnalysisLanguages = parsedLanguages.length > 0 ? parsedLanguages : ['und'];
    try {
      const projectJson = await papi.commands.sendCommand(
        'interlinearizer.createProject',
        projectId,
        normalizedAnalysisLanguages,
        undefined,
        name.trim() || undefined,
        description.trim() || undefined,
      );
      const parsed: unknown = JSON.parse(projectJson);
      if (!isInterlinearProjectSummary(parsed)) {
        await papi.notifications.send({
          message: '%interlinearizer_error_create_project_failed%',
          severity: 'error',
        });
        return;
      }
      onProjectCreated?.(parsed);
      onClose();
    } catch (e) {
      if (e instanceof SyntaxError) {
        logger.error('Interlinearizer: failed to parse create project response', e);
        await papi.notifications.send({
          message: '%interlinearizer_error_create_project_failed%',
          severity: 'error',
        });
        return;
      }
      logger.error('Interlinearizer: failed to create project', e);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [projectId, analysisLanguages, name, description, onClose, onProjectCreated]);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <div className="tw:modal-overlay">
      <dialog
        aria-labelledby="create-project-modal-title"
        aria-modal="true"
        className="tw:modal-dialog tw:rounded tw:w-96"
        open
      >
        <h2 id="create-project-modal-title" className="tw:modal-title">
          {localizedStrings['%interlinearizer_modal_create_title%']}
        </h2>
        <label className="tw:block tw:text-sm tw:mb-1" htmlFor="project-name">
          {localizedStrings['%interlinearizer_modal_create_name_label%']}
        </label>
        <input
          id="project-name"
          className="tw:modal-form-input tw:mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={localizedStrings['%interlinearizer_modal_create_name_placeholder%']}
        />
        <label className="tw:block tw:text-sm tw:mb-1" htmlFor="project-description">
          {localizedStrings['%interlinearizer_modal_create_description_label%']}
        </label>
        <textarea
          id="project-description"
          className="tw:modal-form-input tw:mb-3 tw:resize-none"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={localizedStrings['%interlinearizer_modal_create_description_placeholder%']}
        />
        <label className="tw:block tw:text-sm tw:mb-1" htmlFor="analysis-language">
          {localizedStrings['%interlinearizer_modal_create_language_label%']}
        </label>
        <input
          id="analysis-language"
          className="tw:modal-form-input tw:mb-4"
          value={analysisLanguages}
          onChange={(e) => setAnalysisLanguages(e.target.value)}
          placeholder={localizedStrings['%interlinearizer_modal_create_language_placeholder%']}
        />
        <div className="tw:flex tw:gap-2 tw:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {localizedStrings['%interlinearizer_modal_create_cancel%']}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {localizedStrings['%interlinearizer_modal_create_submit%']}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
