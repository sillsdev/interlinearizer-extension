/** @file Maps an analysis assignment status to the Tailwind text color the renderer shows it in. */

import type { AssignmentStatus } from 'interlinearizer';

/**
 * Tailwind `tw:` text-color classes per assignment status, so approved work always reads as plain
 * foreground while machine output reads as a subordinate color. Kept as a complete map (every
 * `AssignmentStatus` member) even though v1 only ever renders `approved` / `suggested` /
 * `candidate` — the `rejected` / `stale` colors are defined for completeness but no reducer
 * produces those statuses in v1.
 *
 * Approved uses the core `foreground` theme token; the colored statuses use the local
 * `gloss-suggested` / `gloss-candidate` / `gloss-rejected` / `gloss-stale` utilities defined in
 * `tailwind.css` (each light/dark aware), so all the status colors live in one place rather than as
 * raw palette strings scattered here. See that file for which reuse a theme token (green, red) and
 * which use a raw palette shade (blue, orange).
 *
 * - `approved` — plain foreground (the canonical, human-confirmed render).
 * - `suggested` — green (the engine's single best pick; subordinate to approved).
 * - `candidate` — blue (an unselected homograph alternative a reviewer can promote).
 * - `rejected` — orange (a dismissed analysis).
 * - `stale` — red (drifted text needing re-review).
 */
const STATUS_TEXT_COLOR_CLASS: Record<AssignmentStatus, string> = {
  approved: 'tw:text-foreground',
  suggested: 'tw:gloss-suggested',
  candidate: 'tw:gloss-candidate',
  rejected: 'tw:gloss-rejected',
  stale: 'tw:gloss-stale',
};

/**
 * Returns the Tailwind `tw:` text-color class(es) for rendering a gloss at the given assignment
 * status. Centralizes the status→color mapping so suggested (green) and candidate (blue) glosses
 * stay visually subordinate to approved (foreground) from one source of truth.
 *
 * @param status - The analysis assignment status to color.
 * @returns The `tw:`-prefixed Tailwind text-color class for that status.
 */
export function statusTextColorClass(status: AssignmentStatus): string {
  return STATUS_TEXT_COLOR_CLASS[status];
}
