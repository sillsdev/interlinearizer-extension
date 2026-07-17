import type { InterlinearProjectSummary } from '../../types/interlinear-project-summary';
import { formatModified } from '../../utils/project-summary-format';

/**
 * The two-line detail block shown for a project in a list: the name (with an optional "active"
 * badge and the right-aligned analysis-language tags) on the first line, and the localized modified
 * date on the second. Shared by {@link SelectInterlinearProjectModal} (inside its clickable row
 * button) and {@link SaveAsProjectModal} (inside each overwrite target) so both lists present the
 * same detail; it is purely presentational and owns no chrome (border, padding, click behavior),
 * which the parent supplies around it.
 *
 * @param props - Component props.
 * @param props.activeBadgeLabel - Localized text of the active badge.
 * @param props.className - Extra classes appended to the wrapper (e.g. `tw:flex-1` so the block
 *   grows to fill the row).
 * @param props.isActive - Whether this project is the currently active Save target; when `true` the
 *   active badge is shown beside the name.
 * @param props.modifiedPrefix - Localized `"Modified"` label preceding the formatted date.
 * @param props.project - The project summary to describe.
 * @param props.unnamedLabel - Localized fallback label rendered when the project has no name.
 * @returns The detail block.
 */
export function ProjectSummaryDetails({
  activeBadgeLabel,
  className,
  isActive,
  modifiedPrefix,
  project,
  unnamedLabel,
}: Readonly<{
  activeBadgeLabel: string;
  className?: string;
  isActive: boolean;
  modifiedPrefix: string;
  project: InterlinearProjectSummary;
  unnamedLabel: string;
}>) {
  return (
    <span className={`tw:flex tw:flex-col tw:gap-0.5 tw:min-w-0 ${className ?? ''}`}>
      <span className="tw:flex tw:items-center tw:gap-2 tw:min-w-0">
        <span className="tw:font-medium tw:text-foreground tw:truncate">
          {project.name ?? unnamedLabel}
        </span>
        {isActive && (
          <span className="tw:shrink-0 tw:rounded tw:bg-primary tw:px-1.5 tw:py-0.5 tw:text-xs tw:font-medium tw:text-primary-foreground">
            {activeBadgeLabel}
          </span>
        )}
        <span className="tw:font-mono tw:text-xs tw:text-muted-foreground tw:shrink-0 tw:ms-auto">
          {project.analysisLanguages.join(', ')}
        </span>
      </span>
      <span className="tw:text-xs tw:text-muted-foreground">
        {formatModified(modifiedPrefix, project.updatedAt)}
      </span>
    </span>
  );
}
