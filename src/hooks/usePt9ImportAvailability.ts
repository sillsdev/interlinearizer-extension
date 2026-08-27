import papi, { logger } from '@papi/frontend';
import { useEffect, useState } from 'react';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';

/**
 * Reports whether the source project has Paratext 9 interlinear data to import: `true` only when no
 * listed project already carries `pt9Import` and a one-shot manifest probe finds files. `false`
 * while the projects are still loading, while the probe is in flight, and on any probe failure -
 * the import affordance simply stays absent, which is the whole message for a project with nothing
 * to import.
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
  const [hasData, setHasData] = useState(false);
  const hasImport = projects.some((project) => project.pt9Import !== undefined);

  useEffect(() => {
    if (projectsLoading || hasImport) return undefined;
    let ignore = false;
    (async () => {
      try {
        const pdp = await papi.projectDataProviders.get(
          'platformScripture.Pt9Interlinear',
          sourceProjectId,
        );
        const manifest = await pdp.getPt9InterlinearManifest();
        if (!ignore) setHasData(Object.keys(manifest).length > 0);
      } catch (e) {
        // Expected for any source without the projectInterface (or whose probe fails): the button
        // stays hidden and nothing is surfaced.
        logger.debug(`Interlinearizer: PT9 import probe found nothing for ${sourceProjectId}`, e);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [sourceProjectId, projectsLoading, hasImport]);

  return hasData && !projectsLoading && !hasImport;
}
