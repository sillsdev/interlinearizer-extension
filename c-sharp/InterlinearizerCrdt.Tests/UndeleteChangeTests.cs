namespace Interlinearizer.Crdt.Tests;

public class UndeleteChangeTests : CrdtTestBase
{
    private readonly Guid _analysisId = Guid.NewGuid();
    private readonly Guid _linkId = Guid.NewGuid();

    [Test]
    public async Task UndeleteBringsBackADeletedAnalysis()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));

        await WriteNextChange(new UndeleteChange<TokenAnalysis>(_analysisId));

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.DeletedAt).IsNull();
        await Assert.That(await DataModel.QueryLatest<TokenAnalysis>().ToListAsync()).HasSingleItem();
    }

    [Test]
    public async Task UndeleteKeepsTheFieldsTheAnalysisWasDeletedWith()
    {
        var change = Fixtures.CreateTokenAnalysis(_analysisId);
        var created = await WriteNextChange(change);
        await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));

        await WriteNextChange(new UndeleteChange<TokenAnalysis>(_analysisId));

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.Gloss).IsEquivalentTo(change.Gloss!);
        await Assert.That(analysis.Pos).IsEqualTo(change.Pos);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(created.DateTime);
    }

    [Test]
    public async Task UndeleteBringsBackADeletedLink()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));
        await WriteNextChange(new DeleteChange<TokenAnalysisLink>(_linkId));

        await WriteNextChange(new UndeleteChange<TokenAnalysisLink>(_linkId));

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsNull();
    }

    [Test]
    public async Task UndeleteOfAnAnalysisLeavesTheLinksItsDeleteTookDeleted()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));
        await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));

        await WriteNextChange(new UndeleteChange<TokenAnalysis>(_analysisId));

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsNotNull();
    }

    [Test]
    public async Task UndeleteLeavesALinkDeletedWhenADeleteOfItsAnalysisArrivesLateDatedBeforeIt()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));
        await WriteNextChange(new DeleteChange<TokenAnalysisLink>(_linkId));
        var deleteAt = NextDate();
        await WriteNextChange(new UndeleteChange<TokenAnalysisLink>(_linkId));

        await WriteChangeAt(deleteAt, [new DeleteChange<TokenAnalysis>(_analysisId)]);

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsNotNull();
    }

    [Test]
    public async Task UndeleteLeavesAnAnalysisDeletedWhenADeleteOfItsProjectArrivesLateDatedBeforeIt()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));
        var deleteAt = NextDate();
        await WriteNextChange(new UndeleteChange<TokenAnalysis>(_analysisId));

        await WriteChangeAt(deleteAt, [new DeleteChange<InterlinearProject>(ProjectId)]);

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.DeletedAt).IsNotNull();
    }

    [Test]
    public async Task UndeleteKeepsAnEditThatArrivesLateDatedBetweenTheDeleteAndTheUndelete()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));
        var editAt = NextDate();
        await WriteNextChange(new UndeleteChange<TokenAnalysis>(_analysisId));

        await WriteChangeAt(editAt, [new PatchTokenAnalysisChange(_analysisId) { Pos = new("verb") }]);

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.Pos).IsEqualTo("verb");
        await Assert.That(analysis.DeletedAt).IsNull();
    }
}
