import { useLocalizedStrings, useProjectSetting } from '@papi/frontend/react';
import { Label, Switch } from 'platform-bible-react';
import { useId, useMemo } from 'react';

const STRING_KEYS = ['%interlinearizer_continuousScrollToggle%'] as const;

/**
 * Checkbox toggle that reads and writes the `interlinearizer.continuousScroll` project setting.
 *
 * @param props - Component props
 * @param props.projectId - PAPI project ID whose setting to bind
 * @returns A labeled checkbox bound to the continuous-scroll project setting
 */
export default function ContinuousScrollToggle({ projectId }: Readonly<{ projectId: string }>) {
  const [continuousScroll, setContinuousScroll] = useProjectSetting(
    projectId,
    'interlinearizer.continuousScroll',
    true,
  );

  const [localizedStrings] = useLocalizedStrings(useMemo(() => [...STRING_KEYS], []));
  const switchId = useId();

  return (
    <div className="tw-flex tw-items-center tw-gap-2 tw-text-sm">
      <Switch
        id={switchId}
        checked={continuousScroll === true}
        onCheckedChange={(checked) => setContinuousScroll?.(checked)}
      />
      <Label className="tw-cursor-pointer" htmlFor={switchId}>
        {localizedStrings['%interlinearizer_continuousScrollToggle%']}
      </Label>
    </div>
  );
}
