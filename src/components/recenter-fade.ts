/**
 * CSS easing for the recenter opacity fade-in/out. A sine-like curve gives a natural feel at both
 * ends of the transition.
 */
const RECENTER_FADE_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';

/**
 * Duration of the recenter fade, in milliseconds. Both views fade out, refocus on the
 * externally-navigated verse, and fade back in; both must use this value for their CSS transition
 * and for the timeout that swaps content at the midpoint, so an external navigation never shows one
 * view fading on a different clock than the other.
 */
export const RECENTER_FADE_MS = 500;

/**
 * Inline `style` for any element whose opacity fades on the shared recenter clock. Pairs the
 * duration and easing so the fade wrappers can't drift onto different timings — set `opacity`
 * alongside this and add the `tw:transition-opacity` class. Frozen so the shared reference is safe
 * to spread into any style object.
 */
export const RECENTER_FADE_TRANSITION_STYLE = Object.freeze({
  transitionDuration: `${RECENTER_FADE_MS}ms`,
  transitionTimingFunction: RECENTER_FADE_EASING,
});
