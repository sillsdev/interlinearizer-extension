import type { AnalysisRepository, ChangeSet } from '../types/analysis-repository';
import { ReadOnlyAnalysisError } from '../types/read-only-analysis-error';
import type { InterlinearProjectSummary } from '../types/interlinear-project-summary';
import { isEmptyChangeSet } from '../utils/change-set';
import { analysisHasFreeTranslations } from '../utils/free-translations';
import { assertApprovalRule } from './commands/approvalRule';
import { ChangeBuffer } from './commands/changeBuffer';
import { EditHistory } from './editHistory';

/** BCP 47 tag for a language that cannot be determined. */
export const UNDETERMINED_LANGUAGE = 'und';

/**
 * What a session opens: a source project's draft, paired with the interlinear project it saves to
 * when it has one, or a Paratext 9 import on its own.
 */
export type SessionScope =
  | {
      kind: 'draft';
      sourceProjectId: string;
      /** The interlinear project the draft saves to; absent when it has none. */
      interlinearProjectId?: string;
    }
  | { kind: 'pt9Import'; sourceProjectId: string; interlinearProjectId: string };

/** What opening a session tells its caller. */
export type OpenedSession = {
  /** Addresses the session in every later call. */
  sessionId: string;
  /** Whether the session refuses edits, as it does for a Paratext 9 import. */
  readOnly: boolean;
  /** Whether any segment of the opened analysis had a free translation when it opened. */
  hasFreeTranslations: boolean;
};

/** An open session, as seen by the commands sent to it. */
export type Session = {
  readonly id: string;
  readonly scope: SessionScope;
  readonly repository: AnalysisRepository;
  /** Every edit to the session's analysis is applied through it, so that undo can revert each one. */
  readonly history: EditHistory;
  /** BCP 47 tag of the language that glosses are read and written in. */
  analysisLanguage: string;
};

/** What sessions reach projects and storage through. */
export interface SessionHost {
  /**
   * The summary of `interlinearProjectId` among `sourceProjectId`'s interlinear projects, or
   * `undefined` when the source has none by that id.
   */
  findProject(
    sourceProjectId: string,
    interlinearProjectId: string,
  ): Promise<InterlinearProjectSummary | undefined>;
  /**
   * The source project's draft repository. Every handle for a source reaches the same repository,
   * one call at a time.
   */
  openDraftRepository(sourceProjectId: string): AnalysisRepository;
  /** Releases the source project's draft repository once the calls already queued on it settle. */
  releaseDraftRepository(sourceProjectId: string): Promise<void>;
  /** A read-only repository over the Paratext 9 import `interlinearProjectId`. */
  openPt9ImportRepository(interlinearProjectId: string): AnalysisRepository;
  /** The platform's interface languages, most preferred first. */
  getInterfaceLanguages(): Promise<string[]>;
}

type OpenSession = {
  session: Session;
  /** Settles once every command sent to the session so far has settled; never rejects. */
  queue: Promise<unknown>;
  /** Settles once the session is closed; set from the moment a close is sent. */
  closed?: Promise<void>;
};

/**
 * The open sessions, at most one per source project. Each runs the commands sent to it one at a
 * time, in the order they were sent.
 */
export class AnalysisSessions {
  private readonly host: SessionHost;

  private readonly sessions = new Map<string, OpenSession>();

  private readonly sessionsBySource = new Map<string, OpenSession>();

  /**
   * Each source project's opens and closes, chained so an open never interleaves with the close of
   * the session it replaces.
   */
  private readonly lifecycles = new Map<string, Promise<unknown>>();

  constructor(host: SessionHost) {
    this.host = host;
  }

  /**
   * Opens a session read-only on `interlinearProjectId` when it names a Paratext 9 import,
   * otherwise on the source project's draft, which saves to `interlinearProjectId` when given.
   * Opening closes the source's earlier session, if any, and starts the new one on what storage
   * holds, with nothing to undo.
   *
   * The session starts on the opened draft's first analysis language. When the draft lists none, it
   * starts on the platform's first interface language, or {@link UNDETERMINED_LANGUAGE} when the
   * platform lists none either.
   *
   * @throws {Error} If the source project has no interlinear project `interlinearProjectId`.
   * @throws Whatever finding the project or loading the scope's analysis throws; the source is left
   *   with no session.
   */
  open(sourceProjectId: string, interlinearProjectId?: string): Promise<OpenedSession> {
    return this.onLifecycle(sourceProjectId, async () => {
      const replaced = this.sessionsBySource.get(sourceProjectId);
      if (replaced) await this.closeNow(replaced);

      const scope = await this.resolveScope(sourceProjectId, interlinearProjectId);
      const repository =
        scope.kind === 'pt9Import'
          ? this.host.openPt9ImportRepository(scope.interlinearProjectId)
          : this.host.openDraftRepository(sourceProjectId);
      const { draft: opened } = await repository.exportAll();
      const session: Session = {
        id: crypto.randomUUID(),
        scope,
        repository,
        history: new EditHistory(repository),
        analysisLanguage:
          opened.analysisLanguages[0] ??
          ((await this.host.getInterfaceLanguages())[0] || UNDETERMINED_LANGUAGE),
      };
      const entry: OpenSession = { session, queue: Promise.resolve() };
      this.sessions.set(session.id, entry);
      this.sessionsBySource.set(sourceProjectId, entry);
      return {
        sessionId: session.id,
        readOnly: repository.capabilities.readOnly,
        hasFreeTranslations: analysisHasFreeTranslations(opened.analysis),
      };
    });
  }

  /**
   * Closes the session, refusing every command sent to it from now on. Resolves once the commands
   * sent before have settled and its repository is released. Closing a session that is not open
   * does nothing.
   */
  close(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return Promise.resolve();
    entry.closed ??= this.onLifecycle(entry.session.scope.sourceProjectId, () =>
      this.closeNow(entry),
    );
    return entry.closed;
  }

  /** Closes every session, including any whose open is still underway. */
  async closeAll(): Promise<void> {
    await Promise.all(this.lifecycles.values());
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.close(sessionId)));
  }

  /**
   * Sets the language that the session's glosses are read and written in, unchecked against the
   * languages its draft lists. A read-only session takes it too, since it changes nothing stored.
   *
   * @throws {Error} If the session is not open.
   */
  setAnalysisLanguage(sessionId: string, analysisLanguage: string): Promise<void> {
    return this.run(sessionId, async (session) => {
      session.analysisLanguage = analysisLanguage;
    });
  }

  /**
   * Runs `command` on the session once every command sent to it before has settled.
   *
   * @throws {Error} If the session is not open.
   * @throws Whatever `command` throws; later commands still run.
   */
  run<T>(sessionId: string, command: (session: Session) => Promise<T>): Promise<T> {
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.closed) {
      return Promise.reject(new Error(`Interlinearizer: no session ${sessionId} is open`));
    }
    const result = entry.queue.then(() => command(entry.session));
    entry.queue = result.catch(() => {});
    return result;
  }

  /**
   * Runs `edit` as {@link run} does, refusing it on a read-only session without running it.
   *
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {Error} If the session is not open.
   * @throws Whatever `edit` throws; later commands still run.
   */
  runEdit<T>(sessionId: string, edit: (session: Session) => Promise<T>): Promise<T> {
    if (this.sessions.get(sessionId)?.session.repository.capabilities.readOnly) {
      return Promise.reject(
        new ReadOnlyAnalysisError(`Interlinearizer: session ${sessionId} is read-only`),
      );
    }
    return this.run(sessionId, edit);
  }

  /**
   * Runs `command` as one edit of the session's analysis, in the session's turn. What it stages
   * applies as one undo step, marking the draft dirty; a command staging nothing applies nothing.
   *
   * @returns The changes applied, naming `intent`.
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {ApprovalRuleError} If the changes would give a token or segment a second approved
   *   link; nothing is applied.
   * @throws {Error} If the session is not open.
   * @throws Whatever the command or applying its changes throws; nothing is applied.
   */
  edit(
    sessionId: string,
    intent: string,
    command: (buffer: ChangeBuffer, session: Session) => Promise<void>,
  ): Promise<ChangeSet> {
    return this.runEdit(sessionId, async (session) => {
      const buffer = new ChangeBuffer(session.repository);
      await command(buffer, session);
      const changes = buffer.toChangeSet(intent);
      if (isEmptyChangeSet(changes)) return changes;
      await assertApprovalRule(buffer, session.repository);
      const scope = await session.repository.getScope();
      if (!scope.dirty) changes.scope = { ...scope, dirty: true };
      await session.history.apply(changes);
      return changes;
    });
  }

  /**
   * Reverts the session's latest edit not yet undone.
   *
   * @returns The changes that reverted it, or `undefined` when there is none.
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {Error} If the session is not open.
   * @throws Whatever applying the changes throws; the edit stays the next to undo.
   */
  undo(sessionId: string): Promise<ChangeSet | undefined> {
    return this.runEdit(sessionId, (session) => session.history.undo());
  }

  /**
   * Redoes the session's latest undone edit.
   *
   * @returns The changes that redid it, or `undefined` when there is none.
   * @throws {ReadOnlyAnalysisError} If the session is read-only.
   * @throws {Error} If the session is not open.
   * @throws Whatever applying the changes throws; the edit stays the next to redo.
   */
  redo(sessionId: string): Promise<ChangeSet | undefined> {
    return this.runEdit(sessionId, (session) => session.history.redo());
  }

  /**
   * Resolves the scope for a session on the source project, paired with `interlinearProjectId` when
   * given.
   *
   * @throws {Error} If the source project has no interlinear project `interlinearProjectId`.
   */
  private async resolveScope(
    sourceProjectId: string,
    interlinearProjectId: string | undefined,
  ): Promise<SessionScope> {
    if (interlinearProjectId === undefined) return { kind: 'draft', sourceProjectId };
    const project = await this.host.findProject(sourceProjectId, interlinearProjectId);
    if (!project) {
      throw new Error(
        `Interlinearizer: source project ${sourceProjectId} has no interlinear project ${interlinearProjectId}`,
      );
    }
    return {
      kind: project.pt9Import ? 'pt9Import' : 'draft',
      sourceProjectId,
      interlinearProjectId,
    };
  }

  /**
   * Makes the session unreachable by id or source, then, for a draft, releases its repository once
   * the commands sent to it have settled. A session that an earlier step already closed is left
   * alone, so its repository is released only once.
   */
  private async closeNow(entry: OpenSession): Promise<void> {
    const { id, scope } = entry.session;
    if (this.sessions.get(id) !== entry) return;
    this.sessions.delete(id);
    this.sessionsBySource.delete(scope.sourceProjectId);
    await entry.queue;
    if (scope.kind === 'draft') await this.host.releaseDraftRepository(scope.sourceProjectId);
  }

  /** Runs `step` once every open and close of the source project enqueued before has settled. */
  private onLifecycle<T>(sourceProjectId: string, step: () => Promise<T>): Promise<T> {
    const result = (this.lifecycles.get(sourceProjectId) ?? Promise.resolve()).then(step);
    let settled: Promise<void>;
    const cleanup = () => {
      if (this.lifecycles.get(sourceProjectId) === settled) this.lifecycles.delete(sourceProjectId);
    };
    settled = result.then(cleanup, cleanup);
    this.lifecycles.set(sourceProjectId, settled);
    return result;
  }
}
