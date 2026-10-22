import type { InterlinearProject } from 'interlinearizer';
import type {
  AnalysisRepository,
  ApplyResult,
  DraftExport,
  RepositoryCapabilities,
} from '../types/analysis-repository';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
import { ReadOnlyAnalysisError } from '../types/read-only-analysis-error';

/**
 * A Paratext 9 import's analysis, read in a draft's shape. Only a sync replaces an import's
 * content, so every write is refused.
 */
export class Pt9ImportRepository implements AnalysisRepository {
  readonly capabilities: RepositoryCapabilities = { readOnly: true };

  private readonly interlinearProjectId: string;

  private readonly readProject: () => Promise<InterlinearProject | undefined>;

  /**
   * @param interlinearProjectId - Id of the project to read, which must be a Paratext 9 import.
   * @param readProject - Reads the project stored under that id afresh, as a new object that the
   *   repository may hand out, resolving `undefined` when none is stored.
   */
  constructor(
    interlinearProjectId: string,
    readProject: () => Promise<InterlinearProject | undefined>,
  ) {
    this.interlinearProjectId = interlinearProjectId;
    this.readProject = readProject;
  }

  /**
   * Loads the import as a clean draft of its source project, carrying every field the two share. It
   * reports no unreadable books, since an import is stored whole.
   *
   * @throws {Error} If no project is stored under the import's id, or the one stored there is not a
   *   Paratext 9 import.
   * @throws Whatever reading the project throws.
   */
  async exportAll(): Promise<DraftExport> {
    const project = await this.readProject();
    if (!project?.pt9Import) {
      throw new Error(
        `Interlinearizer: no Paratext 9 import is stored as project ${this.interlinearProjectId}`,
      );
    }
    const { sourceProjectId, analysisLanguages, targetProjectId, analysis, segmentation } = project;
    return {
      draft: {
        sourceProjectId,
        modelVersion: CURRENT_MODEL_VERSION,
        analysisLanguages,
        ...(targetProjectId !== undefined && { targetProjectId }),
        analysis,
        dirty: false,
        ...(segmentation !== undefined && { segmentation }),
      },
      unreadableBooks: [],
    };
  }

  /**
   * Loads the import as {@link exportAll} does.
   *
   * @throws Whatever {@link exportAll} throws.
   */
  exportForCopy(): Promise<DraftExport> {
    return this.exportAll();
  }

  /** @throws {ReadOnlyAnalysisError} Always; nothing is written. */
  async replaceAll(): Promise<string[]> {
    throw this.readOnlyError();
  }

  /** @throws {ReadOnlyAnalysisError} Always; nothing is written. */
  async markClean(): Promise<void> {
    throw this.readOnlyError();
  }

  /** @throws {ReadOnlyAnalysisError} Always; nothing is applied. */
  async apply(): Promise<ApplyResult> {
    throw this.readOnlyError();
  }

  private readOnlyError(): ReadOnlyAnalysisError {
    return new ReadOnlyAnalysisError(
      `Interlinearizer: Paratext 9 import ${this.interlinearProjectId} is read-only`,
    );
  }
}
