import { useLocalizedStrings } from '@papi/frontend/react';
import { Info } from 'lucide-react';
import { Button } from 'platform-bible-react';
import useProjectsForSource from '../../hooks/useProjectsForSource';
import usePt9ImportAvailability from '../../hooks/usePt9ImportAvailability';
import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
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
  '%interlinearizer_modal_select_importPt9%',
  '%interlinearizer_readonly_chip%',
];

/**
 * Modal that lists all existing interlinearizer projects for a source project and lets the user
 * select one, view its details (via the info icon), or request that a new one be created.
 *
 * @param props.sourceProjectId - Platform.Bible project ID whose interlinear projects to list.
 * @param props.activeProjectId - ID of the project currently open as the active Save target, if
 *   any; the matching list entry is highlighted and badged so the user can tell which project the
 *   draft is currently working against.
 * @param props.isOpening - When `true`, a project the user already chose is still opening, so the
 *   modal's controls go inert for the duration: the open completes regardless, so letting the modal
 *   be dismissed would read as having canceled it, and choosing another project would race the open
 *   already in flight. A caller may leave it `false` for an open the user cannot reach this modal
 *   behind.
 * @param props.onSelect - Called with the chosen project when the user picks an existing one.
 * @param props.onCreateNew - Called when the user chooses to create a new project instead.
 * @param props.onImportPt9 - Called when the user chooses to import the source's Paratext 9
 *   interlinear data; the button only renders when a probe found data and no import exists yet.
 * @param props.onClose - Called when the user cancels without selecting.
 * @param props.onViewInfo - Called with a project when the user clicks its info icon, so the caller
 *   can open the project metadata modal for that project.
 * @returns The modal overlay with the project list, or nothing while strings are loading.
 */
export function SelectInterlinearProjectModal({
  sourceProjectId,
  activeProjectId,
  isOpening = false,
  onSelect,
  onCreateNew,
  onImportPt9,
  onClose,
  onViewInfo,
}: Readonly<{
  sourceProjectId: string;
  activeProjectId?: string;
  isOpening?: boolean;
  onSelect: (project: InterlinearProjectSummary) => void;
  onCreateNew: () => void;
  onImportPt9: () => void;
  onClose: () => void;
  onViewInfo: (project: InterlinearProjectSummary) => void;
}>) {
  const [localizedStrings, stringsLoading] = useLocalizedStrings(
    SELECT_INTERLINEAR_PROJECT_STRING_KEYS,
  );

  const { projects, isLoading } = useProjectsForSource(sourceProjectId);
  const showImportPt9 = usePt9ImportAvailability(sourceProjectId, projects, isLoading);

  /* v8 ignore next */ if (stringsLoading) return undefined;

  return (
    <ModalShell
      titleTestId="select-project-modal-title"
      title={localizedStrings['%interlinearizer_modal_select_title%']}
      width="tw:w-lg"
      // The list load deliberately does not suppress dismissal: it is a read-only fetch with
      // nothing to abandon, and withholding `onClose` for it would strand the user in a modal that
      // looks idle — empty list, disabled buttons — for as long as the backend takes.
      onClose={isOpening ? undefined : onClose}
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
                  disabled={isOpening}
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
                  {project.pt9Import !== undefined && (
                    <span
                      className="tw:ml-2 tw:shrink-0 tw:self-center tw:rounded tw:bg-muted tw:px-1.5 tw:py-0.5 tw:text-xs tw:text-muted-foreground"
                      data-testid="readonly-chip"
                    >
                      {localizedStrings['%interlinearizer_readonly_chip%']}
                    </span>
                  )}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={localizedStrings['%interlinearizer_modal_select_info_button_label%']}
                  className="tw:shrink-0"
                  disabled={isOpening}
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
        <Button variant="secondary" onClick={onClose} disabled={isLoading || isOpening}>
          {localizedStrings['%interlinearizer_modal_select_cancel%']}
        </Button>
        {showImportPt9 && (
          <Button
            data-testid="import-pt9-button"
            variant="secondary"
            onClick={onImportPt9}
            disabled={isOpening}
          >
            {localizedStrings['%interlinearizer_modal_select_importPt9%']}
          </Button>
        )}
        <Button onClick={onCreateNew} disabled={isLoading || isOpening}>
          {localizedStrings['%interlinearizer_modal_select_create_new%']}
        </Button>
      </div>
    </ModalShell>
  );
}
