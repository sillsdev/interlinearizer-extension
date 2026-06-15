import { useLocalizedStrings } from '@papi/frontend/react';
import { Button } from 'platform-bible-react';
import { useState, useCallback } from 'react';

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

/** Configuration collected by {@link CreateProjectModal} for a new draft. */
export type CreateDraftConfig = {
  /**
   * BCP 47 analysis language tags parsed from the language field (never empty; falls back to
   * `und`).
   */
  analysisLanguages: string[];
  /** Trimmed name, or `undefined` when the field was left blank. */
  name?: string;
  /** Trimmed description, or `undefined` when the field was left blank. */
  description?: string;
};

/**
 * Modal dialog that collects the configuration for a new draft — name, description, and analysis
 * language(s) — then hands it back via {@link onCreateDraft}. No project is persisted here: "New"
 * resets the working draft to an empty baseline, and a project is only materialized later via Save
 * As. The typed name/description are retained on the draft to prefill that Save As dialog.
 *
 * @param props - Component props
 * @param props.defaultAnalysisLanguage - BCP 47 tag pre-populated in the analysis language field;
 *   caller should pass the platform UI language so the user sees a sensible starting value.
 *   Defaults to `'und'` when absent.
 * @param props.onClose - Callback invoked when the modal should be dismissed (cancel).
 * @param props.onCreateDraft - Callback invoked with the collected configuration on submit.
 * @returns The modal overlay with name, description, and language inputs, or nothing while
 *   localized strings are loading.
 */
export function CreateProjectModal({
  defaultAnalysisLanguage,
  onClose,
  onCreateDraft,
}: Readonly<{
  /** BCP 47 tag pre-populated in the analysis language field; defaults to `'und'` when absent. */
  defaultAnalysisLanguage?: string;
  onClose: () => void;
  onCreateDraft: (config: CreateDraftConfig) => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(CREATE_PROJECT_MODAL_STRING_KEYS);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [analysisLanguages, setAnalysisLanguages] = useState(defaultAnalysisLanguage ?? 'und');

  /**
   * Parses the analysis-languages input (comma-separated BCP 47 tags; entries trimmed and empties
   * dropped; falls back to `['und']` when cleared) and hands the configuration to
   * {@link onCreateDraft}.
   */
  const handleSubmit = useCallback(() => {
    const parsedLanguages = analysisLanguages
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const normalizedAnalysisLanguages = parsedLanguages.length > 0 ? parsedLanguages : ['und'];
    onCreateDraft({
      analysisLanguages: normalizedAnalysisLanguages,
      name: name.trim() || undefined,
      description: description.trim() || undefined,
    });
  }, [analysisLanguages, name, description, onCreateDraft]);

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
          <Button variant="secondary" onClick={onClose}>
            {localizedStrings['%interlinearizer_modal_create_cancel%']}
          </Button>
          <Button onClick={handleSubmit}>
            {localizedStrings['%interlinearizer_modal_create_submit%']}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
