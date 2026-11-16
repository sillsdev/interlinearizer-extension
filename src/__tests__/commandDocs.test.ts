import { commandDocs, extensionCommands } from '../commandDocs';

describe('extensionCommands', () => {
  it('lists every documented command once, in the order of the docs', () => {
    expect(extensionCommands).toEqual(Object.keys(commandDocs));
  });
});

describe('commandDocs', () => {
  it("documents a session command's fields beside sessionId, the required ones as required", () => {
    const [args] = commandDocs['interlinearizer.writeGloss'].params;

    expect(args).toMatchObject({
      name: 'args',
      schema: {
        type: 'object',
        properties: { sessionId: { type: 'string' }, value: { type: 'string' } },
        required: expect.arrayContaining(['sessionId', 'tokenRef', 'value']),
      },
    });
  });

  it("leaves an optional field out of the argument's required fields", () => {
    const [args] = commandDocs['interlinearizer.writeGloss'].params;

    expect(args).toMatchObject({ schema: { required: expect.not.arrayContaining(['changeId']) } });
  });
});
