/**
 * Hover delay, in milliseconds, before any tooltip in the extension opens. The interlinear view and
 * the tab toolbar sit in separate React trees and so need a `TooltipProvider` each; both read this
 * value, so a tooltip does not open on a different clock depending on which tree it belongs to.
 */
export const TOOLTIP_DELAY_MS = 700;
