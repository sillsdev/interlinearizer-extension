/// <reference types="jest" />

import papi from '@papi/frontend';
import { emptyAnalysis } from '../../types/empty-factories';
import { readOpenableProject } from '../../utils/read-openable-project';
import { makeStubProject } from '../test-helpers';

const mockSendCommand = jest.mocked(papi.commands.sendCommand);

/** Has `getProject` reply with `project` serialized. */
function mockStoredProject(project: unknown): void {
  mockSendCommand.mockResolvedValue(JSON.stringify(project));
}

describe('readOpenableProject', () => {
  it('reads the project the id names', async () => {
    mockStoredProject(makeStubProject('proj-1'));

    await readOpenableProject('proj-1');

    expect(mockSendCommand).toHaveBeenCalledWith('interlinearizer.getProject', 'proj-1');
  });

  it("returns the project's analysis and languages", async () => {
    const stored = makeStubProject();
    mockStoredProject(stored);

    await expect(readOpenableProject(stored.id)).resolves.toEqual({
      analysisLanguages: stored.analysisLanguages,
      analysis: stored.analysis,
    });
  });

  it("returns the project's alignment target and boundaries when it stores them", async () => {
    const segmentation = { removedVerseStarts: ['GEN 1:2:0'], addedStarts: [] };
    mockStoredProject({ ...makeStubProject(), targetProjectId: 'target-1', segmentation });

    await expect(readOpenableProject('proj-id')).resolves.toMatchObject({
      targetProjectId: 'target-1',
      segmentation,
    });
  });

  it('returns undefined when the project is missing', async () => {
    mockSendCommand.mockResolvedValue(undefined);

    await expect(readOpenableProject('proj-id')).resolves.toBeUndefined();
  });

  it('returns undefined when the reply is not a project', async () => {
    mockStoredProject({ analysis: emptyAnalysis() });

    await expect(readOpenableProject('proj-id')).resolves.toBeUndefined();
  });

  it('returns undefined when the project holds no analysis', async () => {
    mockStoredProject({ ...makeStubProject(), analysis: undefined });

    await expect(readOpenableProject('proj-id')).resolves.toBeUndefined();
  });

  it('returns undefined when the project holds an invalid analysis', async () => {
    mockStoredProject({ ...makeStubProject(), analysis: { tokenAnalyses: 'oops' } });

    await expect(readOpenableProject('proj-id')).resolves.toBeUndefined();
  });

  it('returns undefined when the project holds invalid boundaries', async () => {
    mockStoredProject({ ...makeStubProject(), segmentation: { removedVerseStarts: 'oops' } });

    await expect(readOpenableProject('proj-id')).resolves.toBeUndefined();
  });

  it('rejects when the command rejects', async () => {
    mockSendCommand.mockRejectedValue(new Error('storage offline'));

    await expect(readOpenableProject('proj-id')).rejects.toThrow('storage offline');
  });
});
