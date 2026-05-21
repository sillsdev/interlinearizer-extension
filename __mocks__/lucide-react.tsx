/**
 * @file Jest mock for lucide-react. Provides stub icon components used by extension components.
 */

import type { ReactElement } from 'react';

/**
 * Stub for the Trash2 icon; renders a bare SVG element so tests can locate the icon by test ID.
 *
 * @param props - SVG props forwarded from the component, including optional className and size.
 * @returns A ReactElement SVG element used as a trash icon stub in tests.
 */
export function Trash2(props: Readonly<{ className?: string; size?: number }>): ReactElement {
  return <svg data-testid="trash-icon" {...props} />;
}

/**
 * Stub for the Info icon; renders a bare SVG element so tests can locate the icon by test ID.
 *
 * @param props - SVG props forwarded from the component, including optional className and size.
 * @returns A ReactElement SVG element used as an info icon stub in tests.
 */
export function Info(props: Readonly<{ className?: string; size?: number }>): ReactElement {
  return <svg data-testid="info-icon" {...props} />;
}
