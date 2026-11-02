namespace Interlinearizer.Crdt.Tests;

public class TokenAnalysisTests : CrdtTestBase
{
    private readonly Guid _analysisId = Guid.NewGuid();
    private readonly Guid _linkId = Guid.NewGuid();

    [Test]
    public async Task CreateProjectsEveryField()
    {
        var change = Fixtures.CreateTokenAnalysis(_analysisId);
        var commit = await WriteNextChange(change);

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis).IsNotNull();
        await Assert.That(analysis!.Id).IsEqualTo(_analysisId);
        await Assert.That(analysis.DeletedAt).IsNull();
        await Assert.That(analysis.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(analysis.SurfaceText).IsEqualTo(change.SurfaceText);
        await Assert.That(analysis.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(analysis.Producer).IsEqualTo(change.Producer);
        await Assert.That(analysis.SourceUser).IsNull();
        await Assert.That(analysis.Morphemes).IsEquivalentTo(change.Morphemes!);
        await Assert.That(analysis.MorphemesStale).IsEqualTo(change.MorphemesStale);
        await Assert.That(analysis.Pos).IsEqualTo(change.Pos);
        await Assert.That(analysis.Features).IsEquivalentTo(change.Features!);
        await Assert.That(analysis.Gloss).IsEquivalentTo(change.Gloss!);
        await Assert.That(analysis.GlossSenseRef).IsEqualTo(change.GlossSenseRef);
    }

    [Test]
    public async Task CreateFillsTheProjectedTable()
    {
        var change = Fixtures.CreateTokenAnalysis(_analysisId);
        await WriteNextChange(change);

        var rows = await DataModel.QueryLatest<TokenAnalysis>().ToListAsync();
        await Assert.That(rows).HasSingleItem();
        await Assert.That(rows[0].Morphemes).IsEquivalentTo(change.Morphemes!);
        await Assert.That(rows[0].Features).IsEquivalentTo(change.Features!);
        await Assert.That(rows[0].GlossSenseRef).IsEqualTo(change.GlossSenseRef);
    }

    [Test]
    public async Task ReplaceOverwritesEveryFieldButIdentityAndCreation()
    {
        var created = await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        var change = Fixtures.ReplaceTokenAnalysis(_analysisId);
        var replaced = await WriteNextChange(change);

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.CreatedAt).IsEqualTo(created.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(replaced.DateTime);
        await Assert.That(analysis.SurfaceText).IsEqualTo(change.SurfaceText);
        await Assert.That(analysis.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(analysis.Producer).IsEqualTo(change.Producer);
        await Assert.That(analysis.SourceUser).IsEqualTo(change.SourceUser);
        await Assert.That(analysis.Morphemes).IsEquivalentTo(change.Morphemes!);
        await Assert.That(analysis.MorphemesStale).IsEqualTo(change.MorphemesStale);
        await Assert.That(analysis.Pos).IsEqualTo(change.Pos);
        await Assert.That(analysis.Features).IsNull();
        await Assert.That(analysis.Gloss).IsEquivalentTo(change.Gloss!);
        await Assert.That(analysis.GlossSenseRef).IsNull();
    }

    [Test]
    public async Task DeleteMarksTheAnalysisDeleted()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        var deleted = await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.DeletedAt).IsEqualTo(deleted.DateTime);
        await Assert.That(await DataModel.QueryLatest<TokenAnalysis>().ToListAsync()).IsEmpty();
    }

    [Test]
    public async Task CreateLinkProjectsEveryField()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        var change = Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId);
        var commit = await WriteNextChange(change);

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link).IsNotNull();
        await Assert.That(link!.Id).IsEqualTo(_linkId);
        await Assert.That(link.DeletedAt).IsNull();
        await Assert.That(link.AnalysisId).IsEqualTo(_analysisId);
        await Assert.That(link.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(link.UpdatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(link.Status).IsEqualTo(change.Status);
        await Assert.That(link.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(link.Token).IsEqualTo(change.Token);
    }

    [Test]
    public async Task CreateLinkFillsTheProjectedTable()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));

        var rows = await DataModel.QueryLatest<TokenAnalysisLink>().ToListAsync();
        await Assert.That(rows).HasSingleItem();
        await Assert.That(rows[0].Token).IsEqualTo(Fixtures.Token1);
    }

    [Test]
    public async Task ReplaceLinkOverwritesEveryFieldButIdentityAndCreation()
    {
        var otherAnalysisId = Guid.NewGuid();
        await WriteNextChange([
            Fixtures.CreateTokenAnalysis(_analysisId),
            Fixtures.CreateTokenAnalysis(otherAnalysisId),
        ]);
        var created = await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));
        var change = Fixtures.ReplaceTokenAnalysisLink(_linkId, otherAnalysisId);
        var replaced = await WriteNextChange(change);

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.CreatedAt).IsEqualTo(created.DateTime);
        await Assert.That(link.UpdatedAt).IsEqualTo(replaced.DateTime);
        await Assert.That(link.AnalysisId).IsEqualTo(otherAnalysisId);
        await Assert.That(link.Status).IsEqualTo(change.Status);
        await Assert.That(link.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(link.Token).IsEqualTo(change.Token);
    }

    [Test]
    public async Task DeleteLinkMarksTheLinkDeleted()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));
        var deleted = await WriteNextChange(new DeleteChange<TokenAnalysisLink>(_linkId));

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsEqualTo(deleted.DateTime);
    }

    [Test]
    public async Task DeletingTheAnalysisDeletesItsLink()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));
        var deleted = await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsEqualTo(deleted.DateTime);
    }

    [Test]
    public async Task DeletingTheAnalysisLeavesOtherLinksAlone()
    {
        var otherAnalysisId = Guid.NewGuid();
        var otherLinkId = Guid.NewGuid();
        await WriteNextChange([
            Fixtures.CreateTokenAnalysis(_analysisId),
            Fixtures.CreateTokenAnalysis(otherAnalysisId),
            Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId),
            Fixtures.CreateTokenAnalysisLink(otherLinkId, otherAnalysisId),
        ]);
        await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));

        var otherLink = await DataModel.GetLatest<TokenAnalysisLink>(otherLinkId);
        await Assert.That(otherLink!.DeletedAt).IsNull();
    }

    [Test]
    public async Task ALinkToADeletedAnalysisIsCreatedDeleted()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(new DeleteChange<TokenAnalysis>(_analysisId));
        var commit = await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsEqualTo(commit.DateTime);
    }

    [Test]
    public async Task ADeleteSyncedLateStillDeletesTheLink()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        var linked = await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));
        await WriteChangeBefore(linked, new DeleteChange<TokenAnalysis>(_analysisId));

        // Replayed in time order, the link is created after the delete, so it is created deleted.
        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsEqualTo(linked.DateTime);
    }
}
