namespace Interlinearizer.Crdt.Tests;

public class PatchChangeTests : CrdtTestBase
{
    private readonly Guid _analysisId = Guid.NewGuid();
    private readonly Guid _linkId = Guid.NewGuid();

    [Test]
    public async Task APatchSetsOnlyTheFieldsItCarries()
    {
        var created = Fixtures.CreateTokenAnalysis(_analysisId);
        var createdAt = await WriteNextChange(created);
        var patched = await WriteNextChange(new PatchTokenAnalysisChange(_analysisId) { Pos = "N" });

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.Pos).IsEqualTo("N");
        await Assert.That(analysis.SurfaceText).IsEqualTo(created.SurfaceText);
        await Assert.That(analysis.Confidence).IsEqualTo(created.Confidence);
        await Assert.That(analysis.Producer).IsEqualTo(created.Producer);
        await Assert.That(analysis.Morphemes).IsEquivalentTo(created.Morphemes!);
        await Assert.That(analysis.MorphemesStale).IsEqualTo(created.MorphemesStale);
        await Assert.That(analysis.Gloss).IsEquivalentTo(created.Gloss!);
        await Assert.That(analysis.GlossSenseRef).IsEqualTo(created.GlossSenseRef);
        await Assert.That(analysis.CreatedAt).IsEqualTo(createdAt.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(patched.DateTime);
    }

    [Test]
    public async Task AFieldSetToNullIsCleared()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(new PatchTokenAnalysisChange(_analysisId) { Pos = null, GlossSenseRef = null });

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.Pos).IsNull();
        await Assert.That(analysis.GlossSenseRef).IsNull();
    }

    [Test]
    public async Task AMultiStringPatchSetsAndRemovesKeysLeavingOthersAlone()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        await WriteNextChange(new PatchTokenAnalysisChange(_analysisId)
        {
            Gloss = new MultiStringPatch { ["fr"] = null, ["de"] = "Anfang" },
            Features = new MultiStringPatch { ["Case"] = "Gen", ["Number"] = null, ["Gender"] = "Fem" },
        });

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.Gloss).IsEquivalentTo(new Dictionary<string, string> { ["en"] = "beginning", ["de"] = "Anfang" });
        await Assert.That(analysis.Features).IsEquivalentTo(new Dictionary<string, string> { ["Case"] = "Gen", ["Gender"] = "Fem" });
    }

    [Test]
    public async Task AMultiStringPatchOverAnAbsentValueCreatesIt()
    {
        await WriteNextChange(new CreateTokenAnalysisChange(_analysisId) { SurfaceText = "bare" });
        await WriteNextChange(new PatchTokenAnalysisChange(_analysisId) { Gloss = new MultiStringPatch { ["en"] = "bare", ["fr"] = null } });

        var analysis = await DataModel.GetLatest<TokenAnalysis>(_analysisId);
        await Assert.That(analysis!.Gloss).IsEquivalentTo(new Dictionary<string, string> { ["en"] = "bare" });
    }

    [Test]
    public async Task AMultiStringEmptiedOfEveryKeyBecomesAbsent()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        await WriteNextChange(new PatchPhraseAnalysisChange(_analysisId) { Gloss = new MultiStringPatch { ["en"] = null, ["fr"] = null } });

        var analysis = await DataModel.GetLatest<PhraseAnalysis>(_analysisId);
        await Assert.That(analysis!.Gloss).IsNull();
    }

    [Test]
    public async Task APatchedSurfaceTextRefilesTheAnalysisUnderItsNewForm()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        await WriteNextChange(new PatchPhraseAnalysisChange(_analysisId) { SurfaceText = "In the beginning" });

        await Assert.That(await Repository.FindPhraseAnalysesByForm(["in the"])).IsEmpty();
        await Assert.That((await Repository.FindPhraseAnalysesByForm(["in the beginning"])).Select(a => a.Id)).IsEquivalentTo([_analysisId]);
    }

    [Test]
    public async Task ALinkPatchSetsOnlyTheFieldsItCarries()
    {
        await WriteNextChange(Fixtures.CreateTokenAnalysis(_analysisId));
        var created = Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId);
        await WriteNextChange(created);
        await WriteNextChange(new PatchTokenAnalysisLinkChange(_linkId) { Token = Fixtures.Token2 });

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.Token).IsEqualTo(Fixtures.Token2);
        await Assert.That(link.Status).IsEqualTo(created.Status);
        await Assert.That(link.Confidence).IsEqualTo(created.Confidence);
        await Assert.That(link.AnalysisId).IsEqualTo(_analysisId);
        await Assert.That((await Repository.FindLinksByToken([Fixtures.Token2.TokenRef])).TokenAnalysisLinks.Select(l => l.Id)).IsEquivalentTo([_linkId]);
    }

    [Test]
    public async Task ALinkPatchedOntoADeletedAnalysisIsDeleted()
    {
        var deletedAnalysisId = Guid.NewGuid();
        await WriteNextChange([Fixtures.CreateTokenAnalysis(_analysisId), Fixtures.CreateTokenAnalysis(deletedAnalysisId)]);
        await WriteNextChange(Fixtures.CreateTokenAnalysisLink(_linkId, _analysisId));
        await WriteNextChange(new DeleteChange<TokenAnalysis>(deletedAnalysisId));
        var patched = await WriteNextChange(new PatchTokenAnalysisLinkChange(_linkId) { AnalysisId = deletedAnalysisId });

        var link = await DataModel.GetLatest<TokenAnalysisLink>(_linkId);
        await Assert.That(link!.AnalysisId).IsEqualTo(deletedAnalysisId);
        await Assert.That(link.DeletedAt).IsEqualTo(patched.DateTime);
    }

    [Test]
    public async Task APhraseLinkPatchReplacesTheRunWhole()
    {
        await WriteNextChange(Fixtures.CreatePhraseAnalysis(_analysisId));
        await WriteNextChange(Fixtures.CreatePhraseAnalysisLink(_linkId, _analysisId));
        await WriteNextChange(new PatchPhraseAnalysisLinkChange(_linkId) { Tokens = new List<TokenSnapshot> { Fixtures.Token2 } });

        var link = await DataModel.GetLatest<PhraseAnalysisLink>(_linkId);
        await Assert.That(link!.Tokens).IsEquivalentTo([Fixtures.Token2]);
    }

    [Test]
    public async Task APatchAppliesTheSameAfterASnapshotRegeneration()
    {
        var created = Fixtures.CreateSegmentAnalysis(_analysisId);
        await WriteNextChange(created);
        await WriteNextChange(new PatchSegmentAnalysisChange(_analysisId)
        {
            SourceUser = null,
            FreeTranslation = new MultiStringPatch { ["en"] = "At first", ["fr"] = null },
        });

        // A regeneration reads the stored patch back, so an unset field must still read as unset.
        await DataModel.RegenerateSnapshots();

        var analysis = await DataModel.GetLatest<SegmentAnalysis>(_analysisId);
        await Assert.That(analysis!.SourceUser).IsNull();
        await Assert.That(analysis.FreeTranslation).IsEquivalentTo(new Dictionary<string, string> { ["en"] = "At first" });
        await Assert.That(analysis.SurfaceText).IsEqualTo(created.SurfaceText);
        await Assert.That(analysis.Producer).IsEqualTo(created.Producer);
        await Assert.That(analysis.LiteralTranslation).IsEquivalentTo(created.LiteralTranslation!);
    }
}
