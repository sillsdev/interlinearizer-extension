import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { useState, useCallback } from 'react';
import {
  type InterlinearProjectSummary,
  isInterlinearProjectSummary,
} from './SelectInterlinearProjectModal';

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
 * @param props.onClose - Callback invoked when the modal should be dismissed (cancel or submit)
 * @param props.onProjectCreated - Optional callback invoked with the full persisted project after
 *   successful creation, before `onClose` is called.
 * @returns The modal overlay with name, description, language inputs and submit/cancel buttons, or
 *   nothing while localized strings are loading.
 */
export function CreateProjectModal({
  projectId,
  onClose,
  onProjectCreated,
}: Readonly<{
  projectId: string;
  onClose: () => void;
  onProjectCreated?: (project: InterlinearProjectSummary) => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(CREATE_PROJECT_MODAL_STRING_KEYS);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [analysisLanguage, setAnalysisLanguage] = useState('und');
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Sends the `interlinearizer.createProject` command with the collected form values, notifies the
   * caller via `onProjectCreated`, then closes the modal. Logs and shows a notification on
   * failure.
   *
   * @returns A promise that resolves when the command completes or the error notification is sent.
   */
  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    const normalizedAnalysisLanguage = analysisLanguage.trim() || 'und';
    try {
      const projectJson = await papi.commands.sendCommand(
        'interlinearizer.createProject',
        projectId,
        normalizedAnalysisLanguage,
        name || undefined,
        description || undefined,
      );
      if (!projectJson) return;
      const parsed: unknown = JSON.parse(projectJson);
      if (!isInterlinearProjectSummary(parsed))
        throw new Error('Created project has unexpected shape');
      onProjectCreated?.(parsed);
      onClose();
    } catch (e) {
      logger.error('Interlinearizer: failed to create project', e);
      await papi.notifications
        .send({ message: '%interlinearizer_error_create_project_failed%', severity: 'error' })
        .catch(() => {});
    } finally {
      setIsSubmitting(false);
    }
  }, [projectId, analysisLanguage, name, description, onClose, onProjectCreated]);

  if (stringsLoading) return undefined;

  return (
    <div className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-bg-black/40">
      <dialog
        aria-labelledby="create-project-modal-title"
        className="tw-bg-background tw-text-foreground tw-rounded tw-border tw-border-border tw-p-6 tw-w-96 tw-shadow-lg"
        open
      >
        <h2
          id="create-project-modal-title"
          className="tw-text-base tw-font-semibold tw-text-foreground tw-mb-4"
        >
          {localizedStrings['%interlinearizer_modal_create_title%']}
        </h2>
        <label className="tw-block tw-text-sm tw-mb-1" htmlFor="project-name">
          {localizedStrings['%interlinearizer_modal_create_name_label%']}
        </label>
        <input
          id="project-name"
          className="tw-w-full tw-rounded tw-border tw-border-border tw-bg-muted tw-text-foreground tw-px-3 tw-py-1.5 tw-text-sm tw-mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={localizedStrings['%interlinearizer_modal_create_name_placeholder%']}
        />
        <label className="tw-block tw-text-sm tw-mb-1" htmlFor="project-description">
          {localizedStrings['%interlinearizer_modal_create_description_label%']}
        </label>
        <textarea
          id="project-description"
          className="tw-w-full tw-rounded tw-border tw-border-border tw-bg-muted tw-text-foreground tw-px-3 tw-py-1.5 tw-text-sm tw-mb-3 tw-resize-none"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={localizedStrings['%interlinearizer_modal_create_description_placeholder%']}
        />
        <label className="tw-block tw-text-sm tw-mb-1" htmlFor="analysis-language">
          {localizedStrings['%interlinearizer_modal_create_language_label%']}
        </label>
        <input
          id="analysis-language"
          className="tw-w-full tw-rounded tw-border tw-border-border tw-bg-muted tw-text-foreground tw-px-3 tw-py-1.5 tw-text-sm tw-mb-4"
          value={analysisLanguage}
          onChange={(e) => setAnalysisLanguage(e.target.value)}
          placeholder={localizedStrings['%interlinearizer_modal_create_language_placeholder%']}
        />
        <div className="tw-flex tw-gap-2 tw-justify-end">
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
