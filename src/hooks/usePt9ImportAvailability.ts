import { logger } from '@papi/frontend';
import { useEffect, useState } from 'react';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import { readPt9Manifest } from '../utils/pt9-manifest';

/** What a probe knows so far: undetermined, found data, or found none (failures included). */
export type Pt9ProbeState = 'pending' | 'available' | 'unavailable';

/**
 * Probes whether the source project serves Paratext 9 interlinear data, one manifest read per
 * enablement: `pending` until an enabled probe answers, `available` when the manifest lists any
 * file, `unavailable` when it is empty or the read fails - a source without the projectInterface is
 * the common failure, and it simply has nothing to import. Each probe starts from `pending`, so a
 * failing re-probe cannot leave a stale answer standing.
 *
 * @param sourceProjectId - Platform.Bible project ID to probe.
 * @param enabled - Whether to probe at all; while `false` the state stays `pending`.
 */
export function usePt9ImportProbe(sourceProjectId: string, enabled: boolean): Pt9ProbeState {
  const [state, setState] = useState<Pt9ProbeState>('pending');

  useEffect(() => {
    if (!enabled) return undefined;
    setState('pending');
    let ignore = false;
    (async () => {
      try {
        const manifest = await readPt9Manifest(sourceProjectId);
        if (!ignore) setState(Object.keys(manifest).length > 0 ? 'available' : 'unavailable');
      } catch (e) {
        logger.debug(`Interlinearizer: PT9 import probe failed for ${sourceProjectId}`, e);
        if (!ignore) setState('unavailable');
      }
    })();
    return () => {
      ignore = true;
    };
  }, [sourceProjectId, enabled]);

  return state;
}

/**
 * Reports whether the source project has Paratext 9 interlinear data to import: `true` only when no
 * listed project already carries `pt9Import` and the probe found files. `false` while the projects
 * are still loading, while the probe is in flight, and on any probe failure - the import affordance
 * simply stays absent, which is the whole message for a project with nothing to import.
 *
 * @param sourceProjectId - Platform.Bible project ID to probe.
 * @param projects - The source's interlinear projects, as listed by the caller.
 * @param projectsLoading - Whether that list is still loading; the probe waits for it, since an
 *   existing import makes probing pointless.
 */
export default function usePt9ImportAvailability(
  sourceProjectId: string,
  projects: readonly InterlinearProjectSummary[],
  projectsLoading: boolean,
): boolean {
  const hasImport = projects.some((project) => project.pt9Import !== undefined);
  const probe = usePt9ImportProbe(sourceProjectId, !projectsLoading && !hasImport);
  return probe === 'available' && !projectsLoading && !hasImport;
}
