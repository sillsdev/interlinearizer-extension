namespace Interlinearizer.Crdt.Tests;

public class SegmentAnalysisTests : CrdtTestBase
{
    private readonly Guid _analysisId = Guid.NewGuid();
    private readonly Guid _linkId = Guid.NewGuid();

    [Test]
    public async Task CreateProjectsEveryField()
    {
        var change = Fixtures.CreateSegmentAnalysis(_analysisId);
        var commit = await WriteNextChange(change);

        var analysis = await DataModel.GetLatest<SegmentAnalysis>(_analysisId);
        await Assert.That(analysis).IsNotNull();
        await Assert.That(analysis!.Id).IsEqualTo(_analysisId);
        await Assert.That(analysis.DeletedAt).IsNull();
        await Assert.That(analysis.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(analysis.SurfaceText).IsEqualTo(change.SurfaceText);
        await Assert.That(analysis.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(analysis.Producer).IsEqualTo(change.Producer);
        await Assert.That(analysis.SourceUser).IsEqualTo(change.SourceUser);
        await Assert.That(analysis.FreeTranslation).IsEquivalentTo(change.FreeTranslation!);
        await Assert.That(analysis.LiteralTranslation).IsEquivalentTo(change.LiteralTranslation!);
    }

    [Test]
    public async Task CreateFillsTheProjectedTable()
    {
        await WriteNextChange(Fixtures.CreateSegmentAnalysis(_analysisId));

        var rows = await DataModel.QueryLatest<SegmentAnalysis>().ToListAsync();
        await Assert.That(rows).HasSingleItem();
        await Assert.That(rows[0].FreeTranslation).IsEquivalentTo(Fixtures.CreateSegmentAnalysis(_analysisId).FreeTranslation!);
    }

    [Test]
    public async Task ReplaceOverwritesEveryFieldButIdentityAndCreation()
    {
        var created = await WriteNextChange(Fixtures.CreateSegmentAnalysis(_analysisId));
        var change = Fixtures.ReplaceSegmentAnalysis(_analysisId);
        var replaced = await WriteNextChange(change);

        var analysis = await DataModel.GetLatest<SegmentAnalysis>(_analysisId);
        await Assert.That(analysis!.CreatedAt).IsEqualTo(created.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(replaced.DateTime);
        await Assert.That(analysis.SurfaceText).IsEqualTo(change.SurfaceText);
        await Assert.That(analysis.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(analysis.Producer).IsEqualTo(change.Producer);
        await Assert.That(analysis.SourceUser).IsNull();
        await Assert.That(analysis.FreeTranslation).IsEquivalentTo(change.FreeTranslation!);
        await Assert.That(analysis.LiteralTranslation).IsNull();
    }

    [Test]
    public async Task DeleteMarksTheAnalysisDeleted()
    {
        await WriteNextChange(Fixtures.CreateSegmentAnalysis(_analysisId));
        var deleted = await WriteNextChange(new DeleteChange<SegmentAnalysis>(_analysisId));

        var analysis = await DataModel.GetLatest<SegmentAnalysis>(_analysisId);
        await Assert.That(analysis!.DeletedAt).IsEqualTo(deleted.DateTime);
        await Assert.That(await DataModel.QueryLatest<SegmentAnalysis>().ToListAsync()).IsEmpty();
    }

    [Test]
    public async Task CreateLinkProjectsEveryField()
    {
        await WriteNextChange(Fixtures.CreateSegmentAnalysis(_analysisId));
        var change = Fixtures.CreateSegmentAnalysisLink(_linkId, _analysisId);
        var commit = await WriteNextChange(change);

        var link = await DataModel.GetLatest<SegmentAnalysisLink>(_linkId);
        await Assert.That(link).IsNotNull();
        await Assert.That(link!.Id).IsEqualTo(_linkId);
        await Assert.That(link.DeletedAt).IsNull();
        await Assert.That(link.AnalysisId).IsEqualTo(_analysisId);
        await Assert.That(link.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(link.UpdatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(link.Status).IsEqualTo(change.Status);
        await Assert.That(link.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(link.SegmentId).IsEqualTo(change.SegmentId);
    }

    [Test]
    public async Task ReplaceLinkOverwritesEveryFieldButIdentityAndCreation()
    {
        var otherAnalysisId = Guid.NewGuid();
        await WriteNextChange([
            Fixtures.CreateSegmentAnalysis(_analysisId),
            Fixtures.CreateSegmentAnalysis(otherAnalysisId),
        ]);
        var created = await WriteNextChange(Fixtures.CreateSegmentAnalysisLink(_linkId, _analysisId));
        var change = Fixtures.ReplaceSegmentAnalysisLink(_linkId, otherAnalysisId);
        var replaced = await WriteNextChange(change);

        var link = await DataModel.GetLatest<SegmentAnalysisLink>(_linkId);
        await Assert.That(link!.CreatedAt).IsEqualTo(created.DateTime);
        await Assert.That(link.UpdatedAt).IsEqualTo(replaced.DateTime);
        await Assert.That(link.AnalysisId).IsEqualTo(otherAnalysisId);
        await Assert.That(link.Status).IsEqualTo(change.Status);
        await Assert.That(link.Confidence).IsNull();
        await Assert.That(link.SegmentId).IsEqualTo(change.SegmentId);
    }

    [Test]
    public async Task DeleteLinkMarksTheLinkDeleted()
    {
        await WriteNextChange(Fixtures.CreateSegmentAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreateSegmentAnalysisLink(_linkId, _analysisId));
        var deleted = await WriteNextChange(new DeleteChange<SegmentAnalysisLink>(_linkId));

        var link = await DataModel.GetLatest<SegmentAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsEqualTo(deleted.DateTime);
    }

    [Test]
    public async Task DeletingTheAnalysisDeletesItsLink()
    {
        await WriteNextChange(Fixtures.CreateSegmentAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreateSegmentAnalysisLink(_linkId, _analysisId));
        var deleted = await WriteNextChange(new DeleteChange<SegmentAnalysis>(_analysisId));

        var link = await DataModel.GetLatest<SegmentAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsEqualTo(deleted.DateTime);
    }
}
