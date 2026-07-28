/**
 * @file Jest mock for lucide-react. Provides stub icon components used by extension components.
 */

import type { ReactElement } from 'react';

/**
 * Stub for the LocateFixed icon; renders a bare SVG element so tests can locate the icon by test
 * ID.
 */
export function LocateFixed(props: Readonly<{ className?: string }>): ReactElement {
  return <svg data-testid="locate-fixed-icon" {...props} />;
}

/**
 * Stub for the Info icon.
 */
export function Info(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="info-icon" {...props} />;
}

/**
 * Stub for the Trash2 icon.
 */
export function Trash2(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="trash2-icon" {...props} />;
}

/**
 * Stub for the X icon.
 */
export function X(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="x-icon" {...props} />;
}

/**
 * Stub for the Link2 (link) icon used by the between-token link button.
 */
export function Link2(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="link2-icon" {...props} />;
}

/**
 * Stub for the Link2Off (unlink) icon used by the arc-split button.
 */
export function Link2Off(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="link2off-icon" {...props} />;
}

/**
 * Stub for the Unlink2 icon used by the between-token unlink button; a broken-chain glyph whose
 * chain sits at the same vertical position as Link2 so their button centers line up.
 */
export function Unlink2(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="unlink2-icon" {...props} />;
}

/**
 * Stub for the Settings gear icon used by the view-options dropdown button.
 */
export function Settings(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="settings-icon" {...props} />;
}

/**
 * Stub for the Plus icon used by the token chip's suggestion-dropdown toggle.
 */
export function Plus(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="plus-icon" {...props} />;
}
/**
 * Stub for the Merge icon used by both merge controls (the row-gap merge in the segment list and the
 * cross-segment merge in the continuous strip). A single Y-join glyph, deliberately a different
 * shape from the split marker's arrows-apart glyph.
 */
export function Merge(props: Readonly<{ className?: string }>): ReactElement {
  return <svg data-testid="merge-icon" {...props} />;
}

/**
 * Stub for the Split icon used by the Alt-gated split markers (token-chip and baseline-text). One
 * stroke diverging into two — the mirror of the `Merge` glyph's join.
 */
export function Split(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="split-icon" {...props} />;
}
