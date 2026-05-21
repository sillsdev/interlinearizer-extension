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
