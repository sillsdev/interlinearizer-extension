import papi from '@papi/frontend';
import type { SessionAnalysisChange } from 'interlinearizer';
import type { NetworkEvents } from 'papi-shared-types';
import { useEvent } from 'platform-bible-react';
import { useCallback, useMemo } from 'react';
import useLatestRef from './useLatestRef';

/** Calls `onChange` with each change the host reports to the session that `sessionId` names. */
export default function useSessionChange(
  sessionId: string | undefined,
  onChange: (change: SessionAnalysisChange) => void,
): void {
  const event = useMemo(
    () => papi.network.getNetworkEvent('interlinearizer.onAnalysisChanged'),
    [],
  );
  const onChangeRef = useLatestRef(onChange);
  useEvent(
    event,
    useCallback(
      (change: NetworkEvents['interlinearizer.onAnalysisChanged']) => {
        if ('sessionId' in change && change.sessionId === sessionId) onChangeRef.current(change);
      },
      [sessionId, onChangeRef],
    ),
  );
}
