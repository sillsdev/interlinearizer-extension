/**
 * @file Jest mock for lucide-react. Provides stub icon components used by extension components.
 */

import type { ReactElement } from 'react';

/**
 * Stub for the LocateFixed icon; renders a bare SVG element so tests can locate the icon by test
 * ID.
 *
 * @param props - SVG props forwarded from the component, including optional className.
 * @returns A ReactElement SVG element used as a locate-fixed icon stub in tests.
 */
export function LocateFixed(props: Readonly<{ className?: string }>): ReactElement {
  return <svg data-testid="locate-fixed-icon" {...props} />;
}

/**
 * Stub for the Info icon.
 *
 * @param props - SVG props forwarded from the component.
 * @returns A ReactElement SVG element used as an info icon stub in tests.
 */
export function Info(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="info-icon" {...props} />;
}

/**
 * Stub for the Trash2 icon.
 *
 * @param props - SVG props forwarded from the component.
 * @returns A ReactElement SVG element used as a trash icon stub in tests.
 */
export function Trash2(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="trash2-icon" {...props} />;
}

/**
 * Stub for the X icon.
 *
 * @param props - SVG props forwarded from the component.
 * @returns A ReactElement SVG element used as an X icon stub in tests.
 */
export function X(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="x-icon" {...props} />;
}

/**
 * Stub for the Link2 (link) icon used by the between-token link button.
 *
 * @param props - SVG props forwarded from the component.
 * @returns A ReactElement SVG element used as a link icon stub in tests.
 */
export function Link2(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="link2-icon" {...props} />;
}

/**
 * Stub for the Link2Off (unlink) icon used by the between-token unlink and arc-split buttons.
 *
 * @param props - SVG props forwarded from the component.
 * @returns A ReactElement SVG element used as an unlink icon stub in tests.
 */
export function Link2Off(props: Readonly<{ size?: number; className?: string }>): ReactElement {
  return <svg data-testid="link2off-icon" {...props} />;
}
