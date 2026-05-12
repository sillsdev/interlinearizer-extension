import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Info } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { useCallback, useEffect, useState } from 'react';
import type { InterlinearProject } from 'interlinearizer';

/** Localized string keys used by {@link SelectInterlinearProjectModal}. */
const SELECT_INTERLINEAR_PROJECT_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_modal_select_title%',
  '%interlinearizer_modal_select_none%',
  '%interlinearizer_modal_select_create_new%',
  '%interlinearizer_modal_select_cancel%',
  '%interlinearizer_modal_select_name_unnamed%',
  '%interlinearizer_modal_select_info_button_label%',
];

/** The subset of InterlinearProject fields this modal displays and returns. */
export type InterlinearProjectSummary = Pick<
  InterlinearProject,
  'id' | 'createdAt' | 'sourceProjectId' | 'analysisLanguages' | 'name' | 'description'
>;

/** Fields of the active interlinear project persisted in WebView state. */
export type ActiveProjectState = Pick<
  InterlinearProjectSummary,
  'id' | 'createdAt' | 'name' | 'description' | 'sourceProjectId' | 'analysisLanguages'
>;

/**
 * Type guard for {@link InterlinearProjectSummary} parsed from unknown JSON.
 *
 * @param p - The value to test, typically a parsed JSON object of unknown shape.
 * @returns `true` if `p` satisfies the {@link InterlinearProjectSummary} shape, narrowing its type
 *   accordingly.
 */
export function isInterlinearProjectSummary(p: unknown): p is InterlinearProjectSummary {
  return (
    !!p &&
    typeof p === 'object' &&
    'id' in p &&
    typeof p.id === 'string' &&
    'createdAt' in p &&
    typeof p.createdAt === 'string' &&
    'sourceProjectId' in p &&
    typeof p.sourceProjectId === 'string' &&
    'analysisLanguages' in p &&
    Array.isArray(p.analysisLanguages)
  );
}

/**
 * Modal that lists all existing interlinearizer projects for a source project and lets the user
 * select one, view its details (via the info icon), or request that a new one be created. Fires
 * `interlinearizer.getProjectsForSource` to load the list on mount.
 *
 * @param props - Component props.
 * @param props.sourceProjectId - Platform.Bible project ID whose interlinear projects to list.
 * @param props.onSelect - Called with the chosen project when the user picks an existing one.
 * @param props.onCreateNew - Called when the user chooses to create a new project instead.
 * @param props.onClose - Called when the user cancels without selecting.
 * @param props.onViewInfo - Called with a project when the user clicks its info icon, so the caller
 *   can open the project metadata modal for that project.
 * @returns The modal overlay with the project list, or nothing while strings are loading.
 */
export function SelectInterlinearProjectModal({
  sourceProjectId,
  onSelect,
  onCreateNew,
  onClose,
  onViewInfo,
}: Readonly<{
  sourceProjectId: string;
  onSelect: (project: InterlinearProjectSummary) => void;
  onCreateNew: () => void;
  onClose: () => void;
  onViewInfo: (project: InterlinearProjectSummary) => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    SELECT_INTERLINEAR_PROJECT_STRING_KEYS,
  );

  const [projects, setProjects] = useState<InterlinearProjectSummary[]>([]);

  /**
   * Fetches interlinear projects for `sourceProjectId` and updates the `projects` state. Logs and
   * shows a notification on failure.
   *
   * @returns A promise that resolves when the project list is loaded or the error notification is
   *   sent.
   */
  const loadProjects = useCallback(async () => {
    try {
      const json = await papi.commands.sendCommand(
        'interlinearizer.getProjectsForSource',
        sourceProjectId,
      );
      const parsed: unknown = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        logger.warn('Interlinearizer: getProjectsForSource returned non-array', parsed);
        return;
      }
      const valid = parsed.filter(isInterlinearProjectSummary);
      if (valid.length !== parsed.length)
        logger.warn(
          'Interlinearizer: skipped malformed project entries',
          parsed.length - valid.length,
        );
      setProjects(valid);
    } catch (e) {
      logger.error('Interlinearizer: failed to load projects for source', e);
      await papi.notifications
        .send({ message: '%interlinearizer_error_load_projects_failed%', severity: 'error' })
        .catch(() => {});
    }
  }, [sourceProjectId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  if (stringsLoading) return undefined;

  return (
    <div className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-bg-black/40">
      <dialog
        aria-labelledby="select-project-modal-title"
        className="tw-bg-background tw-text-foreground tw-rounded-lg tw-border tw-border-border tw-p-6 tw-w-[32rem] tw-shadow-lg"
        open
      >
        <h2
          id="select-project-modal-title"
          className="tw-text-base tw-font-semibold tw-text-foreground tw-mb-4"
        >
          {localizedStrings['%interlinearizer_modal_select_title%']}
        </h2>

        {projects.length === 0 ? (
          <p className="tw-text-sm tw-text-muted-foreground tw-mb-4">
            {localizedStrings['%interlinearizer_modal_select_none%']}
          </p>
        ) : (
          <ul className="tw-flex tw-flex-col tw-gap-1 tw-mb-4 tw-max-h-96 tw-overflow-y-auto">
            {projects.map((project) => (
              <li key={project.id} className="tw-flex tw-items-center tw-gap-1">
                <button
                  type="button"
                  className="tw-flex-1 tw-flex tw-items-center tw-gap-2 tw-rounded tw-border tw-border-border tw-bg-muted/40 tw-px-3 tw-py-2 tw-text-left tw-text-sm hover:tw-bg-muted/70 tw-transition-colors tw-min-w-0"
                  onClick={() => onSelect(project)}
                >
                  <span className="tw-font-medium tw-text-foreground tw-truncate">
                    {project.name ??
                      localizedStrings['%interlinearizer_modal_select_name_unnamed%']}
                  </span>
                  <span className="tw-font-mono tw-text-xs tw-text-muted-foreground tw-shrink-0">
                    {project.analysisLanguages.join(', ')}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={localizedStrings['%interlinearizer_modal_select_info_button_label%']}
                  className="tw-shrink-0"
                  onClick={() => onViewInfo(project)}
                >
                  <Info size={15} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="tw-flex tw-gap-2 tw-justify-end">
          <Button variant="secondary" onClick={onClose}>
            {localizedStrings['%interlinearizer_modal_select_cancel%']}
          </Button>
          <Button onClick={onCreateNew}>
            {localizedStrings['%interlinearizer_modal_select_create_new%']}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
