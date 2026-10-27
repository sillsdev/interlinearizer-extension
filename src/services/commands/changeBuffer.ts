import type {
  AssignmentStatus,
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
  ChangeSet,
  ScopeRecord,
} from '../../types/analysis-repository';
import { bookOfRef } from '../../utils/analysis-book';
import { normalizeSurfaceForm } from '../../utils/analysis-identity';
import { jsonCopy } from '../../utils/json-copy';

/** A record kind, named as {@link TextAnalysis} names its list. */
export type RecordKind = keyof TextAnalysis;

/** A record of one kind. */
export type RecordOf<Kind extends RecordKind> = TextAnalysis[Kind][number];

/** One kind's staged changes. */
type Staged<T> = {
  /** Records to store, by id. */
  puts: Map<string, T>;
  /** Records to remove, as they were staged, by id. */
  deletes: Map<string, T>;
  /** Ids of the staged puts that no stored record shares, so removing one stages nothing. */
  created: Set<string>;
};

function emptyStaged<T>(): Staged<T> {
  return { puts: new Map(), deletes: new Map(), created: new Set() };
}

/**
 * A command's changes, staged over a repository until they apply. Reads through the buffer answer
 * as if the changes had applied. Each read returns copies that the command may change.
 */
export class ChangeBuffer {
  private readonly repository: AnalysisRepository;

  private readonly staged: { [Kind in RecordKind]: Staged<RecordOf<Kind>> } = {
    segmentAnalyses: emptyStaged(),
    segmentAnalysisLinks: emptyStaged(),
    tokenAnalyses: emptyStaged(),
    tokenAnalysisLinks: emptyStaged(),
    phraseAnalyses: emptyStaged(),
    phraseAnalysisLinks: emptyStaged(),
  };

  /** The scope's record to store whole; absent while none is staged. */
  private stagedScope?: ScopeRecord;

  constructor(repository: AnalysisRepository) {
    this.repository = repository;
  }

  /** The token analyses stored under `ids` once the staged changes apply. */
  async getTokenAnalyses(ids: string[]): Promise<TokenAnalysis[]> {
    const wanted = new Set(ids);
    const stored = await this.repository.getTokenAnalyses(ids);
    return this.overlay('tokenAnalyses', stored, ({ id }) => wanted.has(id));
  }

  /** The phrase analyses stored under `ids` once the staged changes apply. */
  async getPhraseAnalyses(ids: string[]): Promise<PhraseAnalysis[]> {
    const wanted = new Set(ids);
    const stored = await this.repository.getPhraseAnalyses(ids);
    return this.overlay('phraseAnalyses', stored, ({ id }) => wanted.has(id));
  }

  /** The segment analyses stored under `ids` once the staged changes apply. */
  async getSegmentAnalyses(ids: string[]): Promise<SegmentAnalysis[]> {
    const wanted = new Set(ids);
    const stored = await this.repository.getSegmentAnalyses(ids);
    return this.overlay('segmentAnalyses', stored, ({ id }) => wanted.has(id));
  }

  /** The phrase links stored under `ids` once the staged changes apply. */
  async getPhraseAnalysisLinks(ids: string[]): Promise<PhraseAnalysisLink[]> {
    const wanted = new Set(ids);
    const stored = await this.repository.getPhraseAnalysisLinks(ids);
    return this.overlay('phraseAnalysisLinks', stored, ({ id }) => wanted.has(id));
  }

  /**
   * The token links on the tokens `tokenRefs` names, and the phrase links touching any of them,
   * once the staged changes apply.
   */
  async findLinksByToken(
    tokenRefs: string[],
  ): Promise<Pick<AnalysisLinks, 'tokenAnalysisLinks' | 'phraseAnalysisLinks'>> {
    const wanted = new Set(tokenRefs);
    const stored = await this.repository.findLinksByToken(tokenRefs);
    return {
      tokenAnalysisLinks: this.overlay('tokenAnalysisLinks', stored.tokenAnalysisLinks, (link) =>
        wanted.has(link.token.tokenRef),
      ),
      phraseAnalysisLinks: this.overlay('phraseAnalysisLinks', stored.phraseAnalysisLinks, (link) =>
        link.tokens.some(({ tokenRef }) => wanted.has(tokenRef)),
      ),
    };
  }

  /** The segment links on the segments `segmentIds` names once the staged changes apply. */
  async findLinksBySegment(segmentIds: string[]): Promise<SegmentAnalysisLink[]> {
    const wanted = new Set(segmentIds);
    const stored = await this.repository.findLinksBySegment(segmentIds);
    return this.overlay('segmentAnalysisLinks', stored, (link) => wanted.has(link.segmentId));
  }

  /** The links of every kind to the analyses `analysisIds` names once the staged changes apply. */
  async findLinksToAnalyses(analysisIds: string[]): Promise<AnalysisLinks> {
    const wanted = new Set(analysisIds);
    const stored = await this.repository.findLinksToAnalyses(analysisIds);
    const linksTo = ({ analysisId }: { analysisId: string }) => wanted.has(analysisId);
    return {
      tokenAnalysisLinks: this.overlay('tokenAnalysisLinks', stored.tokenAnalysisLinks, linksTo),
      phraseAnalysisLinks: this.overlay('phraseAnalysisLinks', stored.phraseAnalysisLinks, linksTo),
      segmentAnalysisLinks: this.overlay(
        'segmentAnalysisLinks',
        stored.segmentAnalysisLinks,
        linksTo,
      ),
    };
  }

  /**
   * The links of every kind into any of `bookCodes`, limited to `statuses` when given, once the
   * staged changes apply.
   */
  async findLinksInBooks(
    bookCodes: string[],
    statuses?: AssignmentStatus[],
  ): Promise<AnalysisLinks> {
    const books = new Set(bookCodes);
    const stored = await this.repository.findLinksInBooks(bookCodes, statuses);
    const inBooks = (bookCode: string, status: AssignmentStatus) =>
      books.has(bookCode) && (!statuses || statuses.includes(status));
    return {
      tokenAnalysisLinks: this.overlay('tokenAnalysisLinks', stored.tokenAnalysisLinks, (link) =>
        inBooks(bookOfRef(link.token.tokenRef), link.status),
      ),
      phraseAnalysisLinks: this.overlay('phraseAnalysisLinks', stored.phraseAnalysisLinks, (link) =>
        inBooks(bookOfRef(link.tokens[0].tokenRef), link.status),
      ),
      segmentAnalysisLinks: this.overlay(
        'segmentAnalysisLinks',
        stored.segmentAnalysisLinks,
        (link) => inBooks(bookOfRef(link.segmentId), link.status),
      ),
    };
  }

  /** The scope's record once the staged changes apply. */
  async getScope(): Promise<ScopeRecord> {
    return jsonCopy(this.stagedScope ?? (await this.repository.getScope()));
  }

  /**
   * The token analyses whose surface text normalizes to one of `normalizedForms` once the staged
   * changes apply.
   */
  async findTokenAnalysesByForm(normalizedForms: string[]): Promise<TokenAnalysis[]> {
    const wanted = new Set(normalizedForms);
    const stored = await this.repository.findTokenAnalysesByForm(normalizedForms);
    return this.overlay('tokenAnalyses', stored, ({ surfaceText }) =>
      wanted.has(normalizeSurfaceForm(surfaceText)),
    );
  }

  /**
   * The phrase analyses whose surface text normalizes to one of `normalizedForms` once the staged
   * changes apply.
   */
  async findPhraseAnalysesByForm(normalizedForms: string[]): Promise<PhraseAnalysis[]> {
    const wanted = new Set(normalizedForms);
    const stored = await this.repository.findPhraseAnalysesByForm(normalizedForms);
    return this.overlay('phraseAnalyses', stored, ({ surfaceText }) =>
      wanted.has(normalizeSurfaceForm(surfaceText)),
    );
  }

  /** Stages a new record of `kind`, under an id no stored record has. */
  create<Kind extends RecordKind>(kind: Kind, record: RecordOf<Kind>): void {
    this.stagedOf(kind).created.add(record.id);
    this.put(kind, record);
  }

  /** Stages `record` to be stored whole under its id. */
  put<Kind extends RecordKind>(kind: Kind, record: RecordOf<Kind>): void {
    const staged = this.stagedOf(kind);
    staged.deletes.delete(record.id);
    staged.puts.set(record.id, jsonCopy(record));
  }

  /** Stages `record`'s removal; removing one the buffer created stages nothing for it. */
  delete<Kind extends RecordKind>(kind: Kind, record: RecordOf<Kind>): void {
    const staged = this.stagedOf(kind);
    staged.puts.delete(record.id);
    if (staged.created.delete(record.id)) return;
    staged.deletes.set(record.id, jsonCopy(record));
  }

  /** Stages `scope` to be stored whole as the scope's record. */
  putScope(scope: ScopeRecord): void {
    this.stagedScope = jsonCopy(scope);
  }

  /**
   * Every staged record of `kind`: those to store as they will be stored, those to remove as they
   * were staged.
   */
  touched<Kind extends RecordKind>(kind: Kind): RecordOf<Kind>[] {
    const staged = this.stagedOf(kind);
    return [...staged.puts.values(), ...staged.deletes.values()].map((record) => jsonCopy(record));
  }

  /**
   * The staged changes as one change set. A kind with nothing staged is left out, and so is the
   * scope's record while none is staged.
   */
  toChangeSet(intent: string): ChangeSet {
    const changes: ChangeSet = { intent };
    if (this.stagedScope) changes.scope = jsonCopy(this.stagedScope);
    const kinds: RecordKind[] = [
      'segmentAnalyses',
      'segmentAnalysisLinks',
      'tokenAnalyses',
      'tokenAnalysisLinks',
      'phraseAnalyses',
      'phraseAnalysisLinks',
    ];
    kinds.forEach((kind) => this.collect(changes, kind));
    return changes;
  }

  /**
   * `stored` as it stands once the staged changes of `kind` apply, keeping only the records
   * `matches` accepts; `stored` must hold every stored record `matches` accepts.
   */
  private overlay<Kind extends RecordKind>(
    kind: Kind,
    stored: readonly RecordOf<Kind>[],
    matches: (record: RecordOf<Kind>) => boolean,
  ): RecordOf<Kind>[] {
    const staged = this.stagedOf(kind);
    const latest = new Map<string, RecordOf<Kind>>();
    stored.forEach((record) => {
      if (!staged.deletes.has(record.id)) latest.set(record.id, record);
    });
    staged.puts.forEach((record, id) => latest.set(id, record));
    return [...latest.values()].filter(matches).map((record) => jsonCopy(record));
  }

  private collect<Kind extends RecordKind>(changes: ChangeSet, kind: Kind): void {
    const { puts, deletes } = this.stagedOf(kind);
    if (puts.size === 0 && deletes.size === 0) return;
    Object.assign(changes, {
      [kind]: {
        puts: [...puts.values()].map((record) => jsonCopy(record)),
        deletes: [...deletes.keys()],
      },
    });
  }

  private stagedOf<Kind extends RecordKind>(kind: Kind): Staged<RecordOf<Kind>> {
    return this.staged[kind];
  }
}
