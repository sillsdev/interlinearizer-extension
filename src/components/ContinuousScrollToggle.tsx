import { Label, Switch } from 'platform-bible-react';
import { useId } from 'react';

/**
 * Checkbox toggle UI for the `interlinearizer.continuousScroll` setting.
 *
 * @param props - Component props
 * @param props.checked - Current UI value for continuous scroll
 * @param props.disabled - Whether the toggle should be disabled
 * @param props.label - Accessible label for the toggle
 * @param props.onCheckedChange - Callback invoked when user toggles the switch
 * @returns A labeled checkbox for continuous-scroll mode
 */
export default function ContinuousScrollToggle({
  checked,
  disabled = false,
  label,
  onCheckedChange,
}: Readonly<{
  checked: boolean;
  disabled?: boolean;
  label?: string;
  onCheckedChange: (checked: boolean) => void;
}>) {
  const switchId = useId();

  return (
    <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm">
      <Switch
        checked={checked}
        disabled={disabled}
        id={switchId}
        onCheckedChange={onCheckedChange}
      />
      {label && (
        <Label className="tw-cursor-pointer" htmlFor={switchId}>
          {label}
        </Label>
      )}
    </div>
  );
}
