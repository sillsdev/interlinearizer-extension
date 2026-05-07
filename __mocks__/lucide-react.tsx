/**
 * @file Jest mock for lucide-react. Provides stub icon components used by extension components.
 */

import type { ReactElement } from 'react';

/** @param props - SVG props forwarded from the component. */
export function Trash2(props: Readonly<{ className?: string; size?: number }>): ReactElement {
  return <svg data-testid="trash-icon" {...props} />;
}

/** @param props - SVG props forwarded from the component. */
export function Info(props: Readonly<{ className?: string; size?: number }>): ReactElement {
  return <svg data-testid="info-icon" {...props} />;
}
