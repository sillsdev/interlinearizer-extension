import papi, { logger } from '@papi/frontend';
import { useEffect, useState } from 'react';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import { isInterlinearProjectSummary } from '../types/type-guards';
import { compareUpdatedAtDescending } from '../utils/project-summary-format';

/** Return value of {@link useProjectsForSource}. */
export type UseProjectsForSourceResult = {
  /** The source's interlinear projects; empty while loading. */
  projects: InterlinearProjectSummary[];
  /** True from the moment a load starts until its response settles. */
  isLoading: boolean;
};

/**
 * Loads the interlinear projects belonging to `sourceProjectId`, most-recently-modified first so
 * the one the user is likeliest to want sits at the top and the modified date tells otherwise
 * identical unnamed projects apart.
 *
 * A malformed response reads as an empty list and is logged only, since the list is a convenience
 * the user can work without; a load that fails outright also raises an error notification.
 *
 * A source change or unmount abandons an in-flight load, so neither its list nor its failure can
 * land on a modal that has moved on.
 */
export default function useProjectsForSource(sourceProjectId: string): UseProjectsForSourceResult {
  const [projects, setProjects] = useState<InterlinearProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    setIsLoading(true);
    setProjects([]);

    const load = async () => {
      try {
        const json = await papi.commands.sendCommand(
          'interlinearizer.getProjectsForSource',
          sourceProjectId,
        );
        if (ignore) return;
        const parsed: unknown = JSON.parse(json);
        if (!Array.isArray(parsed)) {
          logger.warn('Interlinearizer: getProjectsForSource returned non-array', parsed);
          return;
        }
        const valid = parsed.filter(isInterlinearProjectSummary);
        if (valid.length !== parsed.length)
          logger.warn(
            'Interlinearizer: skipped malformed project entries',
            parsed.length - valid.length,
          );
        valid.sort((a, b) => compareUpdatedAtDescending(a.updatedAt, b.updatedAt));
        setProjects(valid);
      } catch (e) {
        if (ignore) return;
        logger.error('Interlinearizer: failed to load projects for source', e);
        await papi.notifications
          .send({ message: '%interlinearizer_error_load_projects_failed%', severity: 'error' })
          .catch(() => {});
      } finally {
        if (!ignore) setIsLoading(false);
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, [sourceProjectId]);

  return { projects, isLoading };
}
