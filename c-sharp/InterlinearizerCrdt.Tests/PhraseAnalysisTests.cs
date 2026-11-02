namespace Interlinearizer.Crdt.Tests;

public class PhraseAnalysisTests : CrdtTestBase
{
    private readonly Guid _analysisId = Guid.NewGuid();
    private readonly Guid _linkId = Guid.NewGuid();

    [Test]
    public async Task CreateProjectsEveryField()
    {
        var change = Fixtures.CreatePhraseAnalysis(_analysisId);
        var commit = await WriteNextChange(change);

        var analysis = await DataModel.GetLatest<PhraseAnalysis>(_analysisId);
        await Assert.That(analysis).IsNotNull();
        await Assert.That(analysis!.Id).IsEqualTo(_analysisId);
        await Assert.That(analysis.DeletedAt).IsNull();
        await Assert.That(analysis.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(analysis.SurfaceText).IsEqualTo(change.SurfaceText);
        await Assert.That(analysis.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(analysis.Producer).IsEqualTo(change.Producer);
        await Assert.That(analysis.SourceUser).IsEqualTo(change.SourceUser);
        await Assert.That(analysis.Gloss).IsEquivalentTo(change.Gloss!);
        await Assert.That(analysis.SenseRef).IsEqualTo(change.SenseRef);
    }

    [Test]
    public async Task CreateFillsTheProjectedTable()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));

        var rows = await DataModel.QueryLatest<PhraseAnalysis>().ToListAsync();
        await Assert.That(rows).HasSingleItem();
        await Assert.That(rows[0].SenseRef).IsEqualTo(Fixtures.Sense);
    }

    [Test]
    public async Task ReplaceOverwritesEveryFieldButIdentityAndCreation()
    {
        var created = await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        var change = Fixtures.ReplacePhraseAnalysis(_analysisId);
        var replaced = await WriteNextChange(change);

        var analysis = await DataModel.GetLatest<PhraseAnalysis>(_analysisId);
        await Assert.That(analysis!.CreatedAt).IsEqualTo(created.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(replaced.DateTime);
        await Assert.That(analysis.SurfaceText).IsEqualTo(change.SurfaceText);
        await Assert.That(analysis.Confidence).IsNull();
        await Assert.That(analysis.Producer).IsNull();
        await Assert.That(analysis.SourceUser).IsNull();
        await Assert.That(analysis.Gloss).IsNull();
        await Assert.That(analysis.SenseRef).IsEqualTo(change.SenseRef);
    }

    [Test]
    public async Task DeleteMarksTheAnalysisDeleted()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        var deleted = await WriteNextChange(new DeleteChange<PhraseAnalysis>(_analysisId));

        var analysis = await DataModel.GetLatest<PhraseAnalysis>(_analysisId);
        await Assert.That(analysis!.DeletedAt).IsEqualTo(deleted.DateTime);
        await Assert.That(await DataModel.QueryLatest<PhraseAnalysis>().ToListAsync()).IsEmpty();
    }

    [Test]
    public async Task CreateLinkProjectsEveryField()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        var change = Fixtures.CreatePhraseAnalysisLink(_linkId, _analysisId);
        var commit = await WriteNextChange(change);

        var link = await DataModel.GetLatest<PhraseAnalysisLink>(_linkId);
        await Assert.That(link).IsNotNull();
        await Assert.That(link!.Id).IsEqualTo(_linkId);
        await Assert.That(link.DeletedAt).IsNull();
        await Assert.That(link.AnalysisId).IsEqualTo(_analysisId);
        await Assert.That(link.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(link.UpdatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(link.Status).IsEqualTo(change.Status);
        await Assert.That(link.Confidence).IsEqualTo(change.Confidence);
        await Assert.That(link.Tokens).IsEquivalentTo(change.Tokens);
    }

    [Test]
    public async Task CreateLinkFillsTheProjectedTable()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreatePhraseAnalysisLink(_linkId, _analysisId));

        var rows = await DataModel.QueryLatest<PhraseAnalysisLink>().ToListAsync();
        await Assert.That(rows).HasSingleItem();
        await Assert.That(rows[0].Tokens).IsEquivalentTo([Fixtures.Token1, Fixtures.Token2]);
    }

    [Test]
    public async Task ReplaceLinkOverwritesEveryFieldButIdentityAndCreation()
    {
        var otherAnalysisId = Guid.NewGuid();
        await WriteNextChange([
            Fixtures.CreatePhraseAnalysis(_analysisId),
            Fixtures.CreatePhraseAnalysis(otherAnalysisId),
        ]);
        var created = await WriteNextChange(Fixtures.CreatePhraseAnalysisLink(_linkId, _analysisId));
        var change = Fixtures.ReplacePhraseAnalysisLink(_linkId, otherAnalysisId);
        var replaced = await WriteNextChange(change);

        var link = await DataModel.GetLatest<PhraseAnalysisLink>(_linkId);
        await Assert.That(link!.CreatedAt).IsEqualTo(created.DateTime);
        await Assert.That(link.UpdatedAt).IsEqualTo(replaced.DateTime);
        await Assert.That(link.AnalysisId).IsEqualTo(otherAnalysisId);
        await Assert.That(link.Status).IsEqualTo(change.Status);
        await Assert.That(link.Confidence).IsNull();
        await Assert.That(link.Tokens).IsEquivalentTo(change.Tokens);
    }

    [Test]
    public async Task DeleteLinkMarksTheLinkDeleted()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreatePhraseAnalysisLink(_linkId, _analysisId));
        var deleted = await WriteNextChange(new DeleteChange<PhraseAnalysisLink>(_linkId));

        var link = await DataModel.GetLatest<PhraseAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsEqualTo(deleted.DateTime);
    }

    [Test]
    public async Task DeletingTheAnalysisDeletesItsLink()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreatePhraseAnalysisLink(_linkId, _analysisId));
        var deleted = await WriteNextChange(new DeleteChange<PhraseAnalysis>(_analysisId));

        var link = await DataModel.GetLatest<PhraseAnalysisLink>(_linkId);
        await Assert.That(link!.DeletedAt).IsEqualTo(deleted.DateTime);
    }
}
