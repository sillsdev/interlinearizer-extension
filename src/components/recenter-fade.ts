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
const RECENTER_FADE_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * Duration of the recenter fade, in milliseconds. Both views must use this value for their CSS
 * transition and for the `setTimeout` that swaps content at the midpoint, so they fade as one.
 */
export const RECENTER_FADE_MS = 500;

/**
 * Inline `style` for any element whose opacity fades on the shared recenter clock. Pairs the
 * duration and easing so the four fade wrappers (loader curtain, mode-toggle wrapper, segment list,
 * continuous strip) can't drift onto different timings — set `opacity` alongside this and add the
 * `tw:transition-opacity` class. Frozen so the shared reference is safe to spread into any style
 * object.
 */
export const RECENTER_FADE_TRANSITION_STYLE = Object.freeze({
  transitionDuration: `${RECENTER_FADE_MS}ms`,
  transitionTimingFunction: RECENTER_FADE_EASING,
});
