/**
 * @file Shared fade timing for the recenter animation used by both the continuous strip and the
 *   segment list. Both views fade out, refocus on the externally-navigated verse, and fade back in;
 *   importing the duration and easing from a single source keeps the two animations in lockstep so
 *   an external navigation never shows one view fading on a different clock than the other.
 */

/**
 * CSS easing for the recenter opacity fade-in/out. A sine-like curve gives a natural feel at both
 * ends of the transition.
 */
export const RECENTER_FADE_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * Duration of the recenter fade, in milliseconds. Both views must use this value for their CSS
 * transition and for the `setTimeout` that swaps content at the midpoint, so they fade as one.
 */
export const RECENTER_FADE_MS = 500;
