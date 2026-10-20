import type { InterlinearProject } from 'interlinearizer';
import type { KeyValueStorage } from '../types/analysis-repository';
import { toProjectSummary } from '../types/interlinear-project-summary';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import { assertSupportedModelVersion, CURRENT_MODEL_VERSION } from '../types/model-version';
import { isInterlinearProjectSummary } from '../types/type-guards';
import { summarizeAnalysis } from '../utils/project-analysis-summary';

const PROJECT_SUMMARIES_KEY = 'projectSummaries';

/** The summaries record as stored. */
interface StoredSummaries {
  modelVersion: number;
  /** In creation order. */
  summaries: InterlinearProjectSummary[];
}

function isStoredSummaries(value: unknown): value is StoredSummaries {
  return (
    !!value &&
    typeof value === 'object' &&
    'modelVersion' in value &&
    typeof value.modelVersion === 'number' &&
    'summaries' in value &&
    Array.isArray(value.summaries) &&
    value.summaries.every(isInterlinearProjectSummary)
  );
}

/** What a project list shows about `project`, its analysis described rather than carried. */
export function summarizeProject(project: InterlinearProject): InterlinearProjectSummary {
  return { ...toProjectSummary(project), ...summarizeAnalysis(project.analysis) };
}

/**
 * The summary of every saved project, for listing projects without reading their analyses. A
 * project is listed exactly when this holds its summary.
 *
 * Writes must not overlap.
 */
export class ProjectSummaries {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage) {
    this.storage = storage;
  }

  /**
   * Every listed project's summary, in creation order.
   *
   * @throws {SyntaxError} If the stored record contains invalid JSON.
   * @throws {Error} If the stored record was written by a newer build, or is not a list of
   *   summaries.
   * @throws If storage rejects the read.
   */
  async list(): Promise<InterlinearProjectSummary[]> {
    const raw = await this.storage.read(PROJECT_SUMMARIES_KEY);
    if (raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    assertSupportedModelVersion(parsed, 'the project summaries');
    if (!isStoredSummaries(parsed))
      throw new Error(
        `Interlinearizer: '${PROJECT_SUMMARIES_KEY}' is corrupt (expected a list of project summaries)`,
      );
    return parsed.summaries;
  }

  /**
   * The summaries of the projects analyzing `sourceProjectId`, in creation order.
   *
   * @throws As {@link list} does.
   */
  async listForSource(sourceProjectId: string): Promise<InterlinearProjectSummary[]> {
    return (await this.list()).filter((summary) => summary.sourceProjectId === sourceProjectId);
  }

  /**
   * Lists a new project after every listed one.
   *
   * @throws As {@link list} does, writing nothing.
   * @throws If storage rejects the write.
   */
  async add(summary: InterlinearProjectSummary): Promise<void> {
    await this.write([...(await this.list()), summary]);
  }

  /**
   * Replaces a listed project's summary with `summary`. A project not listed stays unlisted.
   *
   * @returns Whether the project is listed.
   * @throws As {@link list} does, writing nothing.
   * @throws If storage rejects the write.
   */
  async replace(summary: InterlinearProjectSummary): Promise<boolean> {
    const summaries = await this.list();
    if (!summaries.some(({ id }) => id === summary.id)) return false;
    await this.write(summaries.map((listed) => (listed.id === summary.id ? summary : listed)));
    return true;
  }

  /**
   * Unlists project `id`, if listed.
   *
   * @throws As {@link list} does, writing nothing.
   * @throws If storage rejects the write.
   */
  async remove(id: string): Promise<void> {
    const summaries = await this.list();
    const kept = summaries.filter((summary) => summary.id !== id);
    if (kept.length !== summaries.length) await this.write(kept);
  }

  private async write(summaries: InterlinearProjectSummary[]): Promise<void> {
    const stored: StoredSummaries = { modelVersion: CURRENT_MODEL_VERSION, summaries };
    await this.storage.write(PROJECT_SUMMARIES_KEY, JSON.stringify(stored));
  }
}
