import { CSharpRepository, REPOSITORY_COMMAND_PREFIX } from '../../services/csharpRepository';
import type { AnalysisRepository } from '../../types/analysis-repository';
import { emptyAnalysis, emptyDraft } from '../../types/empty-factories';
import { scopeRecordOf } from '../../utils/change-set';

const PROJECT = 'project-1';
const SOURCE = 'source-project';

function createRepository() {
  const send = jest.fn();
  return { send, repository: new CSharpRepository(send, SOURCE, PROJECT) };
}

describe('CSharpRepository', () => {
  it('is writable', () => {
    expect(createRepository().repository.capabilities).toStrictEqual({ readOnly: false });
  });

  describe('forwarding', () => {
    const answer = { answered: true };
    const cases: {
      command: string;
      call: (r: AnalysisRepository) => Promise<unknown>;
      sent: object;
    }[] = [
      { command: 'getTokenAnalyses', call: (r) => r.getTokenAnalyses(['a']), sent: { ids: ['a'] } },
      {
        command: 'getPhraseAnalyses',
        call: (r) => r.getPhraseAnalyses(['a']),
        sent: { ids: ['a'] },
      },
      {
        command: 'getSegmentAnalyses',
        call: (r) => r.getSegmentAnalyses(['a']),
        sent: { ids: ['a'] },
      },
      {
        command: 'getPhraseAnalysisLinks',
        call: (r) => r.getPhraseAnalysisLinks(['a']),
        sent: { ids: ['a'] },
      },
      {
        command: 'findLinksByToken',
        call: (r) => r.findLinksByToken(['GEN 1:1:0']),
        sent: { keys: ['GEN 1:1:0'] },
      },
      {
        command: 'findLinksBySegment',
        call: (r) => r.findLinksBySegment(['GEN 1:1']),
        sent: { keys: ['GEN 1:1'] },
      },
      {
        command: 'findLinksToAnalyses',
        call: (r) => r.findLinksToAnalyses(['a']),
        sent: { ids: ['a'] },
      },
      {
        command: 'findLinksInBooks',
        call: (r) => r.findLinksInBooks(['GEN'], ['approved']),
        sent: { bookCodes: ['GEN'], statuses: ['approved'] },
      },
      { command: 'findLinkedBooks', call: (r) => r.findLinkedBooks(), sent: {} },
      {
        command: 'findTokenAnalysesByForm',
        call: (r) => r.findTokenAnalysesByForm(['and']),
        sent: { keys: ['and'] },
      },
      {
        command: 'findPhraseAnalysesByForm',
        call: (r) => r.findPhraseAnalysesByForm(['in the']),
        sent: { keys: ['in the'] },
      },
      { command: 'countApprovals', call: (r) => r.countApprovals(['a']), sent: { ids: ['a'] } },
    ];

    it.each(cases)('$command sends its command and answers with the reply', async (c) => {
      const { send, repository } = createRepository();
      send.mockResolvedValue(answer);

      await expect(c.call(repository)).resolves.toBe(answer);

      expect(send).toHaveBeenCalledWith(`${REPOSITORY_COMMAND_PREFIX}${c.command}`, {
        sourceProjectId: SOURCE,
        projectId: PROJECT,
        ...c.sent,
      });
    });
  });

  it('applies through the host, reporting an inverse that restores nothing and a clean draft', async () => {
    const { send, repository } = createRepository();
    send.mockResolvedValue(undefined);
    const changes = { intent: 'edit', tokenAnalyses: { puts: [], deletes: ['a'] } };

    await expect(repository.apply(changes)).resolves.toStrictEqual({
      inverse: { intent: 'edit' },
      wasDirty: false,
    });

    expect(send).toHaveBeenCalledWith(`${REPOSITORY_COMMAND_PREFIX}apply`, {
      sourceProjectId: SOURCE,
      projectId: PROJECT,
      changes,
    });
  });

  it('refuses a change set carrying the scope record, sending nothing', async () => {
    const { send, repository } = createRepository();

    await expect(
      repository.apply({ intent: 'rescope', scope: scopeRecordOf(emptyDraft(SOURCE)) }),
    ).rejects.toThrow('stores no scope record');

    expect(send).not.toHaveBeenCalled();
  });

  it('exports every record the host holds in an otherwise empty draft', async () => {
    const { send, repository } = createRepository();
    const analysis = { ...emptyAnalysis(), tokenAnalyses: [{ id: 'a' }] };
    send.mockResolvedValue(analysis);

    await expect(repository.exportAll()).resolves.toStrictEqual({
      draft: { ...emptyDraft(SOURCE), analysis },
      unreadableBooks: [],
    });
    await expect(repository.getWholeDraft()).resolves.toStrictEqual({
      ...emptyDraft(SOURCE),
      analysis,
    });
    expect(send).toHaveBeenCalledWith(`${REPOSITORY_COMMAND_PREFIX}readAll`, {
      sourceProjectId: SOURCE,
      projectId: PROJECT,
    });
  });

  it('reports no index differences, keeping no index', async () => {
    const { send, repository } = createRepository();

    await expect(repository.checkIndexes()).resolves.toStrictEqual([]);

    expect(send).not.toHaveBeenCalled();
  });

  const unsupported: { method: string; call: (r: AnalysisRepository) => Promise<unknown> }[] = [
    { method: 'exportForCopy', call: (r) => r.exportForCopy() },
    { method: 'replaceAll', call: (r) => r.replaceAll(emptyDraft(SOURCE)) },
    { method: 'markClean', call: (r) => r.markClean() },
    { method: 'getScope', call: (r) => r.getScope() },
  ];

  it.each(unsupported)('$method throws, since the host stores no draft record', async (c) => {
    const { send, repository } = createRepository();

    await expect(c.call(repository)).rejects.toThrow(`${c.method} is not supported`);

    expect(send).not.toHaveBeenCalled();
  });
});
