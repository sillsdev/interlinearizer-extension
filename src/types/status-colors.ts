import type { AssignmentStatus } from 'interlinearizer';

/**
 * Tailwind text-color class per assignment status, so human-confirmed work reads as plain
 * foreground and machine output reads as subordinate to it.
 *
 * The palette tracks Paratext 9, with one deliberate divergence: PT9 leaves unselected homograph
 * alternatives in the default foreground, but `candidate` is grey here so it reads as subordinate
 * to the engine's `suggested` pick. The map is complete even though v1 never produces `rejected` or
 * `stale`.
 *
 * - `approved` — plain foreground (the canonical, human-confirmed render).
 * - `suggested` — blue (the engine's single best pick).
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
