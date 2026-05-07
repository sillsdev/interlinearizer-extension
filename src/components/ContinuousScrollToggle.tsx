import { useLocalizedStrings } from '@papi/frontend/react';
import { Label, Switch } from 'platform-bible-react';
import { useId, useMemo } from 'react';

const STRING_KEYS = ['%interlinearizer_continuousScrollToggle%'] as const;

/**
 * Checkbox toggle UI for the `interlinearizer.continuousScroll` setting.
 *
 * @param props - Component props
 * @param props.checked - Current UI value for continuous scroll
 * @param props.onCheckedChange - Callback invoked when user toggles the switch
 * @returns A labeled checkbox for continuous-scroll mode
 */
export default function ContinuousScrollToggle({
  checked,
  onCheckedChange,
}: Readonly<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}>) {
  const [localizedStrings] = useLocalizedStrings(useMemo(() => [...STRING_KEYS], []));
  const switchId = useId();

  return (
    <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm">
      <Switch checked={checked} id={switchId} onCheckedChange={onCheckedChange} />
      <Label className="tw-cursor-pointer" htmlFor={switchId}>
        {localizedStrings['%interlinearizer_continuousScrollToggle%']}
      </Label>
    </div>
  );
}
