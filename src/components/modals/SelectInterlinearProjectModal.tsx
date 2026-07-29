import papi, { logger } from '@papi/frontend';
import { useLocalizedStrings } from '@papi/frontend/react';
import { Info } from 'lucide-react';
import { Button } from 'platform-bible-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import { isInterlinearProjectSummary } from '../../types/type-guards';
import { compareUpdatedAtDescending } from '../../utils/project-summary-format';
import { ModalShell } from './ModalShell';
import { ProjectSummaryDetails } from './ProjectSummaryDetails';

/** Localized string keys requested for this modal's rendered text. */
const SELECT_INTERLINEAR_PROJECT_STRING_KEYS: `%${string}%`[] = [
  '%interlinearizer_modal_select_title%',
  '%interlinearizer_modal_select_none%',
  '%interlinearizer_modal_select_create_new%',
  '%interlinearizer_modal_select_cancel%',
  '%interlinearizer_modal_select_name_unnamed%',
  '%interlinearizer_modal_select_info_button_label%',
  '%interlinearizer_modal_select_active_badge%',
  '%interlinearizer_modal_select_modified_prefix%',
];

/**
 * Modal that lists all existing interlinearizer projects for a source project and lets the user
 * select one, view its details (via the info icon), or request that a new one be created. Fires
 * `interlinearizer.getProjectsForSource` to load the list on mount.
 *
 * @param props.sourceProjectId - Platform.Bible project ID whose interlinear projects to list.
 * @param props.activeProjectId - ID of the project currently open as the active Save target, if
 *   any; the matching list entry is highlighted and badged so the user can tell which project the
 *   draft is currently working against.
 * @param props.onSelect - Called with the chosen project when the user picks an existing one.
 * @param props.onCreateNew - Called when the user chooses to create a new project instead.
 * @param props.onClose - Called when the user cancels without selecting.
 * @param props.onViewInfo - Called with a project when the user clicks its info icon, so the caller
 *   can open the project metadata modal for that project.
 * @returns The modal overlay with the project list, or nothing while strings are loading.
 */
export function SelectInterlinearProjectModal({
  sourceProjectId,
  activeProjectId,
  onSelect,
  onCreateNew,
  onClose,
  onViewInfo,
}: Readonly<{
  sourceProjectId: string;
  activeProjectId?: string;
  onSelect: (project: InterlinearProjectSummary) => void;
  onCreateNew: () => void;
  onClose: () => void;
  onViewInfo: (project: InterlinearProjectSummary) => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    SELECT_INTERLINEAR_PROJECT_STRING_KEYS,
  );

  const [projects, setProjects] = useState<InterlinearProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /** Incremented each time a load starts; lets an in-flight response detect it has been superseded. */
  const loadGenRef = useRef(0);

  /**
   * Fetches interlinear projects for `sourceProjectId` and updates the `projects` state. Logs and
   * shows a notification on failure. Ignores the response if a newer load has started since this
   * one was initiated.
   */
  const loadProjects = useCallback(async () => {
    loadGenRef.current += 1;
    const gen = loadGenRef.current;
    setIsLoading(true);
    setProjects([]);
    try {
      const json = await papi.commands.sendCommand(
        'interlinearizer.getProjectsForSource',
        sourceProjectId,
      );
      if (gen !== loadGenRef.current) return;
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
      // Most-recently-modified first so the project the user is likeliest to reopen sits at the top,
      // and the modified date distinguishes otherwise-identical unnamed projects.
      valid.sort((a, b) => compareUpdatedAtDescending(a.updatedAt, b.updatedAt));
      setProjects(valid);
    } catch (e) {
      logger.error('Interlinearizer: failed to load projects for source', e);
      await papi.notifications
        .send({ message: '%interlinearizer_error_load_projects_failed%', severity: 'error' })
        .catch(() => {});
    } finally {
      if (gen === loadGenRef.current) setIsLoading(false);
    }
  }, [sourceProjectId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleId="select-project-modal-title"
      title={localizedStrings['%interlinearizer_modal_select_title%']}
      width="tw:w-lg"
      onClose={isLoading ? undefined : onClose}
    >
      {projects.length === 0 ? (
        <p className="tw:text-sm tw:text-muted-foreground tw:mb-4">
          {localizedStrings['%interlinearizer_modal_select_none%']}
        </p>
      ) : (
        <ul className="tw:flex tw:flex-col tw:gap-1 tw:mb-4 tw:max-h-96 tw:overflow-y-auto">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <li key={project.id} className="tw:flex tw:items-center tw:gap-1">
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  className={`tw:flex-1 tw:flex tw:rounded tw:border tw:px-3 tw:py-2 tw:text-left tw:text-sm tw:transition-colors tw:min-w-0 ${
                    isActive
                      ? 'tw:border-primary tw:bg-primary/10 tw:hover:bg-primary/20'
                      : 'tw:border-border tw:bg-muted/40 tw:hover:bg-muted/70'
                  }`}
                  onClick={() => onSelect(project)}
                >
                  <ProjectSummaryDetails
                    activeBadgeLabel={
                      localizedStrings['%interlinearizer_modal_select_active_badge%']
                    }
                    className="tw:flex-1"
                    isActive={isActive}
                    modifiedPrefix={
                      localizedStrings['%interlinearizer_modal_select_modified_prefix%']
                    }
                    project={project}
                    unnamedLabel={localizedStrings['%interlinearizer_modal_select_name_unnamed%']}
                  />
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={localizedStrings['%interlinearizer_modal_select_info_button_label%']}
                  className="tw:shrink-0"
                  onClick={() => onViewInfo(project)}
                >
                  <Info className="tw:size-[15px]" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="tw:modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={isLoading}>
          {localizedStrings['%interlinearizer_modal_select_cancel%']}
        </Button>
        <Button onClick={onCreateNew} disabled={isLoading}>
          {localizedStrings['%interlinearizer_modal_select_create_new%']}
        </Button>
      </div>
    </ModalShell>
  );
}
