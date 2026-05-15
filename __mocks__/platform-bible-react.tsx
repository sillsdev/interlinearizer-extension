/**
 * @file Jest mock for platform-bible-react. The real package ships ESM which Jest cannot parse
 * without extra transform configuration. This stub provides the subset used by extension
 * components: `TabToolbar`, `Switch`, and `Label`.
 */

import type { ReactElement, ReactNode } from 'react';

export function TabToolbar({
  startAreaChildren,
  endAreaChildren,
}: Readonly<{
  className?: string;
  startAreaChildren?: ReactNode;
  endAreaChildren?: ReactNode;
  onSelectProjectMenuItem?: () => void;
  onSelectViewInfoMenuItem?: () => void;
}>): ReactElement {
  return (
    <div data-testid="tab-toolbar">
      <div data-testid="tab-toolbar-start">{startAreaChildren}</div>
      <div data-testid="tab-toolbar-end">{endAreaChildren}</div>
    </div>
  );
}

export function Switch({
  checked,
  disabled,
  id,
  onCheckedChange,
}: Readonly<{
  checked?: boolean;
  disabled?: boolean;
  id?: string;
  onCheckedChange?: (checked: boolean) => void;
}>): ReactElement {
  return (
    <input
      checked={checked ?? false}
      disabled={disabled}
      id={id}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      type="checkbox"
    />
  );
}

export function Label({
  children,
  className,
  htmlFor,
}: Readonly<{
  children?: ReactNode;
  className?: string;
  htmlFor?: string;
}>): ReactElement {
  return (
    <label className={className} htmlFor={htmlFor}>
      {children}
    </label>
  );
}
