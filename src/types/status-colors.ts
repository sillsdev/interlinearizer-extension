/** @file Maps an analysis assignment status to the Tailwind text color the renderer shows it in. */

import type { AssignmentStatus } from 'interlinearizer';

/**
 * Tailwind `tw:` text-color classes per assignment status, so approved work always reads as plain
 * foreground while machine output reads as a subordinate color. Kept as a complete map (every
 * `AssignmentStatus` member) even though v1 only ever renders `approved` / `suggested` /
 * `candidate` — the `rejected` / `stale` colors are defined for completeness but no reducer
 * produces those statuses in v1. Indexed directly at the call site, so there is no accessor to
 * test; the map is data, which is why this lives in `types/`.
 *
 * The colors track Paratext 9: approved renders in the default foreground and the engine's pick in
 * blue; PT9 leaves the unselected alternatives in default, but we set them grey so a homograph
 * candidate reads as subordinate to the suggested pick. Approved uses the core `foreground` theme
 * token; the colored statuses use the local `gloss-suggested` / `gloss-candidate` /
 * `gloss-rejected` / `gloss-stale` utilities defined in `tailwind.css` (each light/dark aware), so
 * all the status colors live in one place rather than as raw palette strings scattered here. See
 * that file for which reuse a theme token (grey, red) and which use a raw palette shade (blue,
 * orange).
 *
 * - `approved` — plain foreground (the canonical, human-confirmed render).
 * - `suggested` — blue (the engine's single best pick; subordinate to approved).
 * - `candidate` — grey (an unselected homograph alternative a reviewer can promote).
 * - `rejected` — orange (a dismissed analysis).
 * - `stale` — red (drifted text needing re-review).
 */
export const STATUS_TEXT_COLOR_CLASS: Record<AssignmentStatus, string> = {
  approved: 'tw:text-foreground',
  suggested: 'tw:gloss-suggested',
  candidate: 'tw:gloss-candidate',
  rejected: 'tw:gloss-rejected',
  stale: 'tw:gloss-stale',
};
