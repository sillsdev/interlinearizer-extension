import type {
  AssignmentStatus,
  DraftProject,
  PhraseAnalysis,
  PhraseAnalysisLink,
  SegmentAnalysis,
  SegmentAnalysisLink,
  TextAnalysis,
  TokenAnalysis,
} from 'interlinearizer';
import type {
  AnalysisLinks,
  AnalysisRepository,
  ApplyResult,
  ChangeSet,
  DraftExport,
  IndexDifference,
  RepositoryCapabilities,
  ScopeRecord,
} from '../types/analysis-repository';
import { emptyDraft } from '../types/empty-factories';

/**
 * Sends one of the C# host's commands with its one object of named fields, and resolves with what
 * the host answers.
 */
export type CommandSender = <T>(command: string, args: object) => Promise<T>;

/** Each command's name is this, then the repository method it serves. */
export const REPOSITORY_COMMAND_PREFIX = 'interlinearizer.repository.';

/**
 * The C# host's slice of {@link AnalysisRepository}, reached one command per method. Every command
 * names the source project the host has open and the interlinear project in it, which the host must
 * already store. Every record id must be a GUID string, as the host stores ids.
 *
 * The scope's record and the unsaved mark are not stored yet. An apply refuses a change set
 * carrying a scope. It reports an inverse that restores nothing, and the draft as clean. The calls
 * that read the scope or clear the mark throw, as do those that copy or replace the draft whole.
 */
export class CSharpRepository implements AnalysisRepository {
  readonly capabilities: RepositoryCapabilities = { readOnly: false };

  /**
   * @param sourceProjectId - The source project the host has open, which every command names and
   *   the draft read whole is stamped with.
   * @param projectId - The interlinear project the host stores in that source, which every command
   *   names.
   */
  constructor(
    private readonly send: CommandSender,
    private readonly sourceProjectId: string,
    private readonly projectId: string,
  ) {}

  /** Every record stored, in an otherwise empty draft, with no book unreadable. */
  async exportAll(): Promise<DraftExport> {
    const analysis = await this.command<TextAnalysis>('readAll', {});
    return { draft: { ...emptyDraft(this.sourceProjectId), analysis }, unreadableBooks: [] };
  }

  exportForCopy(): Promise<DraftExport> {
    return this.notStored('exportForCopy');
  }

  markClean(): Promise<void> {
    return this.notStored('markClean');
  }

  /** @throws {Error} If the change set carries the scope's record, which the host stores nowhere. */
  async apply(changes: ChangeSet): Promise<ApplyResult> {
    if (changes.scope) {
      throw new Error(
        `The C# host stores no scope record for ${this.projectId}: the change set must not carry one`,
      );
    }
    await this.command('apply', { changes });
    return { inverse: { intent: changes.intent }, wasDirty: false };
  }

  async getWholeDraft(): Promise<DraftProject> {
    return (await this.exportAll()).draft;
  }

  getScope(): Promise<ScopeRecord> {
    return this.notStored('getScope');
  }

  getTokenAnalyses(ids: string[]): Promise<TokenAnalysis[]> {
    return this.command('getTokenAnalyses', { ids });
  }

  getPhraseAnalyses(ids: string[]): Promise<PhraseAnalysis[]> {
    return this.command('getPhraseAnalyses', { ids });
  }

  getSegmentAnalyses(ids: string[]): Promise<SegmentAnalysis[]> {
    return this.command('getSegmentAnalyses', { ids });
  }

  getPhraseAnalysisLinks(ids: string[]): Promise<PhraseAnalysisLink[]> {
    return this.command('getPhraseAnalysisLinks', { ids });
  }

  findLinksByToken(
    tokenRefs: string[],
  ): Promise<Pick<AnalysisLinks, 'tokenAnalysisLinks' | 'phraseAnalysisLinks'>> {
    return this.command('findLinksByToken', { keys: tokenRefs });
  }

  findLinksBySegment(segmentIds: string[]): Promise<SegmentAnalysisLink[]> {
    return this.command('findLinksBySegment', { keys: segmentIds });
  }

  findLinksToAnalyses(analysisIds: string[]): Promise<AnalysisLinks> {
    return this.command('findLinksToAnalyses', { ids: analysisIds });
  }

  findLinksInBooks(bookCodes: string[], statuses?: AssignmentStatus[]): Promise<AnalysisLinks> {
    return this.command('findLinksInBooks', { bookCodes, statuses });
  }

  findLinkedBooks(): Promise<string[]> {
    return this.command('findLinkedBooks', {});
  }

  findTokenAnalysesByForm(normalizedForms: string[]): Promise<TokenAnalysis[]> {
    return this.command('findTokenAnalysesByForm', { keys: normalizedForms });
  }

  findPhraseAnalysesByForm(normalizedForms: string[]): Promise<PhraseAnalysis[]> {
    return this.command('findPhraseAnalysesByForm', { keys: normalizedForms });
  }

  countApprovals(analysisIds: string[]): Promise<Record<string, number>> {
    return this.command('countApprovals', { ids: analysisIds });
  }

  /** Nothing, since the host answers every lookup from its tables rather than a kept index. */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this -- the seam's method, with nothing to check
  async checkIndexes(): Promise<IndexDifference[]> {
    return [];
  }

  private command<T>(method: string, args: object): Promise<T> {
    return this.send<T>(`${REPOSITORY_COMMAND_PREFIX}${method}`, {
      sourceProjectId: this.sourceProjectId,
      projectId: this.projectId,
      ...args,
    });
  }

  private notStored(method: string): Promise<never> {
    return Promise.reject(
      new Error(
        `${method} is not supported: the C# host stores no draft record for ${this.projectId} yet`,
      ),
    );
  }
}
