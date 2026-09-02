/**
 * @file Jest mock for lucide-react. Each stub renders a bare SVG carrying a `data-testid` so tests
 *   can locate the icon.
 */

import type { ReactElement } from 'react';

/**
 * Stub for the LocateFixed icon.
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
 * Stub for the Link2 (link) icon.
 */
export function Link2(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="link2-icon" {...props} />;
}

/**
 * Stub for the Link2Off (unlink) icon.
 */
export function Link2Off(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="link2off-icon" {...props} />;
}

/**
 * Stub for the Unlink2 icon: a broken-chain glyph whose chain sits at the same vertical position as
 * {@link Link2}, so buttons carrying either one line up.
 */
export function Unlink2(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="unlink2-icon" {...props} />;
}

/**
 * Stub for the Settings gear icon.
 */
export function Settings(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="settings-icon" {...props} />;
}

/**
 * Stub for the Plus icon.
 */
export function Plus(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="plus-icon" {...props} />;
}

/**
 * Stub for the Merge icon: a single Y-join glyph, deliberately a different shape from the split
 * marker's arrows-apart glyph.
 */
export function Merge(props: Readonly<{ className?: string }>): ReactElement {
  return <svg data-testid="merge-icon" {...props} />;
}

/**
 * Stub for the Split icon: one stroke diverging into two, the mirror of the {@link Merge} glyph's
 * join.
 */
export function Split(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="split-icon" {...props} />;
}

/**
 * Stub for the ChevronRight icon, marking a collapsed catalog row.
 */
export function ChevronRight(props: Readonly<{ className?: string }>): ReactElement {
  return <svg data-testid="chevron-right-icon" {...props} />;
}

/**
 * Stub for the ChevronDown icon, marking an expanded catalog row.
 */
export function ChevronDown(props: Readonly<{ className?: string }>): ReactElement {
  return <svg data-testid="chevron-down-icon" {...props} />;
}

/**
 * Stub for the ListFilter icon, marking the catalog's filter control.
 */
export function ListFilter(props: Readonly<{ className?: string }>): ReactElement {
  return <svg data-testid="list-filter-icon" {...props} />;
}

/**
 * Stub for the ArrowUpDown icon, marking the catalog's sort control.
 */
export function ArrowUpDown(props: Readonly<{ className?: string }>): ReactElement {
  return <svg data-testid="arrow-up-down-icon" {...props} />;
}
