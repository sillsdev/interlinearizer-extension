import type { DraftProject, InterlinearProject } from 'interlinearizer';
import type {
  AnalysisRepository,
  ApplyResult,
  DraftExport,
  RepositoryCapabilities,
} from '../types/analysis-repository';
import { CURRENT_MODEL_VERSION } from '../types/model-version';
import { ReadOnlyAnalysisError } from '../types/read-only-analysis-error';
import { AnalysisIndex } from './analysisIndex';
import { IndexedRepository, type IndexedDraft } from './indexedRepository';

/**
 * A Paratext 9 import's analysis, read in a draft's shape. Only a sync replaces an import's
 * content, so every write is refused.
 */
export class Pt9ImportRepository extends IndexedRepository implements AnalysisRepository {
  readonly capabilities: RepositoryCapabilities = { readOnly: true };

  private readonly interlinearProjectId: string;

  private readonly readProject: () => Promise<InterlinearProject | undefined>;

  private readonly revision: () => number;

  /**
   * The import as first read for a lookup, with the index over its records; dropped once a sync
   * replaces the import or a deletion removes it.
   */
  private loaded: { draft: DraftProject; revision: number; index: AnalysisIndex } | undefined;

  /**
   * @param interlinearProjectId - Id of the project to read, which must be a Paratext 9 import.
   * @param readProject - Reads the project stored under that id afresh, as a new object that the
   *   repository may hand out, resolving `undefined` when none is stored.
   * @param revision - The import's revision, which moves whenever a sync replaces the import or a
   *   deletion removes it.
   */
  constructor(
    interlinearProjectId: string,
    readProject: () => Promise<InterlinearProject | undefined>,
    revision: () => number,
  ) {
    super();
    this.interlinearProjectId = interlinearProjectId;
    this.readProject = readProject;
    this.revision = revision;
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
    return { draft: await this.readImport(), unreadableBooks: [] };
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

  /** @throws Whatever {@link exportAll} throws. */
  protected async indexed(): Promise<IndexedDraft> {
    const kept = this.kept();
    if (kept) return kept;
    // The revision is taken before the read, so a sync landing during it forces another.
    const revision = this.revision();
    const draft = await this.readImport();
    this.loaded = { draft, revision, index: new AnalysisIndex(draft.analysis) };
    return this.loaded;
  }

  protected keptIndex(): IndexedDraft | undefined {
    return this.kept();
  }

  /** The import as last read, unless a sync or a deletion has changed it since. */
  private kept() {
    if (this.loaded?.revision !== this.revision()) this.loaded = undefined;
    return this.loaded;
  }

  /**
   * Reads the import as {@link exportAll} describes.
   *
   * @throws Whatever {@link exportAll} throws.
   */
  private async readImport(): Promise<DraftProject> {
    const project = await this.readProject();
    if (!project?.pt9Import) {
      throw new Error(
        `Interlinearizer: no Paratext 9 import is stored as project ${this.interlinearProjectId}`,
      );
    }
    const { sourceProjectId, analysisLanguages, targetProjectId, analysis, segmentation } = project;
    return {
      sourceProjectId,
      modelVersion: CURRENT_MODEL_VERSION,
      analysisLanguages,
      ...(targetProjectId !== undefined && { targetProjectId }),
      analysis,
      dirty: false,
      ...(segmentation !== undefined && { segmentation }),
    };
  }

  private readOnlyError(): ReadOnlyAnalysisError {
    return new ReadOnlyAnalysisError(
      `Interlinearizer: Paratext 9 import ${this.interlinearProjectId} is read-only`,
    );
  }
}
