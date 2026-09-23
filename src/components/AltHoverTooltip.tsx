import { Tooltip, TooltipContent, TooltipTrigger } from 'platform-bible-react';
import { useCallback, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactElement, ReactNode } from 'react';

/** Props for {@link AltHoverTooltip}. */
type AltHoverTooltipProps = Readonly<{
  /** Tooltip content, or `undefined` for none. */
  content: ReactNode | undefined;
  /** Inline style for the tooltip content. */
  contentStyle?: CSSProperties;
  /** Renders the trigger element, which must attach the given handler as its `onMouseMove`. */
  children: (onMouseMove: (event: MouseEvent) => void) => ReactElement;
}>;

/**
 * A tooltip that mounts only once its trigger is hovered with Alt held, and shows only while Alt is
 * held.
 */
export function AltHoverTooltip({ content, contentStyle, children }: AltHoverTooltipProps) {
  const [armed, setArmed] = useState(false);
  const arm = useCallback((event: MouseEvent) => {
    if (event.altKey) setArmed(true);
  }, []);
  const trigger = children(arm);
  if (!armed || content === undefined) return trigger;
  // Opened on mount: the Alt-hover that armed it came before the trigger could listen for one.
  return (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent className="tw:hidden tw:alt-held:block" style={contentStyle}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
