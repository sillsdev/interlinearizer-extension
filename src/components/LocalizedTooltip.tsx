import { Tooltip, TooltipContent, TooltipTrigger } from 'platform-bible-react';
import type { ReactElement } from 'react';
import { resolvedOrEmpty, tooltipContentOrUndefined } from '../utils/localized-strings';

/** Props for {@link LocalizedTooltip}. */
type LocalizedTooltipProps = Readonly<{
  /** Localized text to show, possibly a localize key still awaiting resolution. */
  label: string;
  /** The trigger, which must take a ref and pointer handlers as a native element does. */
  children: ReactElement;
}>;

/** Shows a localized label on hovering `children`, showing nothing until the label resolves. */
export default function LocalizedTooltip({ label, children }: LocalizedTooltipProps) {
  const content = tooltipContentOrUndefined(resolvedOrEmpty(label));
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {content !== undefined && <TooltipContent>{content}</TooltipContent>}
    </Tooltip>
  );
}
