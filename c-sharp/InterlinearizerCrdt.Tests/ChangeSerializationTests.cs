using System.Text.Json;
using SIL.Harmony.Config;

namespace Interlinearizer.Crdt.Tests;

/// <summary>
/// Commits written today must still deserialize later, so every change's JSON discriminator and
/// field set is pinned here. A failure means a migration path is needed, not a new expectation.
/// </summary>
public class ChangeSerializationTests
{
    private static readonly Guid Id = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid AnalysisId = new("22222222-2222-2222-2222-222222222222");

    private static readonly Lazy<JsonSerializerOptions> Options = new(() =>
    {
        var config = new HarmonyConfig();
        InterlinearizerCrdtKernel.ConfigureHarmony(config);
        return config.JsonSerializerOptions;
    });

    public static IEnumerable<Func<(string Discriminator, IChange Change)>> AllChanges()
    {
        yield return () => ("CreateSegmentAnalysisChange", Fixtures.CreateSegmentAnalysis(Id));
        yield return () => ("ReplaceSegmentAnalysisChange", Fixtures.ReplaceSegmentAnalysis(Id));
        yield return () => ("delete:SegmentAnalysis", new DeleteChange<SegmentAnalysis>(Id));
        yield return () => ("CreateSegmentAnalysisLinkChange", Fixtures.CreateSegmentAnalysisLink(Id, AnalysisId));
        yield return () => ("ReplaceSegmentAnalysisLinkChange", Fixtures.ReplaceSegmentAnalysisLink(Id, AnalysisId));
        yield return () => ("delete:SegmentAnalysisLink", new DeleteChange<SegmentAnalysisLink>(Id));
        yield return () => ("CreateTokenAnalysisChange", Fixtures.CreateTokenAnalysis(Id));
        yield return () => ("ReplaceTokenAnalysisChange", Fixtures.ReplaceTokenAnalysis(Id));
        yield return () => ("delete:TokenAnalysis", new DeleteChange<TokenAnalysis>(Id));
        yield return () => ("CreateTokenAnalysisLinkChange", Fixtures.CreateTokenAnalysisLink(Id, AnalysisId));
        yield return () => ("ReplaceTokenAnalysisLinkChange", Fixtures.ReplaceTokenAnalysisLink(Id, AnalysisId));
        yield return () => ("delete:TokenAnalysisLink", new DeleteChange<TokenAnalysisLink>(Id));
        yield return () => ("CreatePhraseAnalysisChange", Fixtures.CreatePhraseAnalysis(Id));
        yield return () => ("ReplacePhraseAnalysisChange", Fixtures.ReplacePhraseAnalysis(Id));
        yield return () => ("delete:PhraseAnalysis", new DeleteChange<PhraseAnalysis>(Id));
        yield return () => ("CreatePhraseAnalysisLinkChange", Fixtures.CreatePhraseAnalysisLink(Id, AnalysisId));
        yield return () => ("ReplacePhraseAnalysisLinkChange", Fixtures.ReplacePhraseAnalysisLink(Id, AnalysisId));
        yield return () => ("delete:PhraseAnalysisLink", new DeleteChange<PhraseAnalysisLink>(Id));
        yield return () => ("PatchSegmentAnalysisChange", Fixtures.PatchSegmentAnalysis(Id));
        yield return () => ("PatchSegmentAnalysisLinkChange", Fixtures.PatchSegmentAnalysisLink(Id));
        yield return () => ("PatchTokenAnalysisChange", Fixtures.PatchTokenAnalysis(Id));
        yield return () => ("PatchTokenAnalysisLinkChange", Fixtures.PatchTokenAnalysisLink(Id));
        yield return () => ("PatchPhraseAnalysisChange", Fixtures.PatchPhraseAnalysis(Id));
        yield return () => ("PatchPhraseAnalysisLinkChange", Fixtures.PatchPhraseAnalysisLink(Id));
    }

    [Test]
    public async Task APatchLeavesUnsetFieldsOutAndKeepsFieldsSetToNull()
    {
        var json = JsonSerializer.Serialize(Fixtures.PatchTokenAnalysis(Id), Options.Value);

        using var document = JsonDocument.Parse(json);
        var names = document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
        await Assert.That(names).DoesNotContain("SurfaceText");
        await Assert.That(names).DoesNotContain("Morphemes");
        await Assert.That(document.RootElement.GetProperty("Pos").ValueKind).IsEqualTo(JsonValueKind.Null);
        await Assert.That(document.RootElement.GetProperty("Gloss").GetProperty("fr").ValueKind).IsEqualTo(JsonValueKind.Null);

        var roundTripped = JsonSerializer.Deserialize<IChange>(json, Options.Value);
        var patch = roundTripped as PatchTokenAnalysisChange;
        await Assert.That(patch).IsNotNull();
        await Assert.That(patch!.SurfaceText.HasValue).IsFalse();
        await Assert.That(patch.Morphemes.HasValue).IsFalse();
        await Assert.That(patch.Pos.HasValue).IsTrue();
        await Assert.That(patch.Pos.Value).IsNull();
        await Assert.That(patch.Gloss!["fr"]).IsNull();
        await Assert.That(patch.Gloss["de"]).IsEqualTo("Anfang");
    }

    [Test]
    [MethodDataSource(nameof(AllChanges))]
    public async Task EveryChangeRoundTripsUnderItsDiscriminator((string Discriminator, IChange Change) testCase)
    {
        var json = JsonSerializer.Serialize(testCase.Change, Options.Value);

        using var document = JsonDocument.Parse(json);
        await Assert.That(document.RootElement.GetProperty("$type").GetString()).IsEqualTo(testCase.Discriminator);

        var roundTripped = JsonSerializer.Deserialize<IChange>(json, Options.Value);
        await Assert.That(roundTripped).IsNotNull();
        await Assert.That(roundTripped!.GetType()).IsEqualTo(testCase.Change.GetType());
        await Assert.That(roundTripped.EntityId).IsEqualTo(Id);
        await Assert.That(JsonSerializer.Serialize(roundTripped, Options.Value)).IsEqualTo(json);
    }

    [Test]
    public async Task EnumsSerializeAsTheModelsStrings()
    {
        var json = JsonSerializer.Serialize(Fixtures.CreateTokenAnalysisLink(Id, AnalysisId), Options.Value);

        using var document = JsonDocument.Parse(json);
        await Assert.That(document.RootElement.GetProperty("Status").GetString()).IsEqualTo("suggested");
        await Assert.That(document.RootElement.GetProperty("Confidence").GetString()).IsEqualTo("low");
    }

    [Test]
    public async Task EveryRegisteredChangeIsCovered()
    {
        var config = new HarmonyConfig();
        InterlinearizerCrdtKernel.ConfigureHarmony(config);

        var registered = config.ChangeTypes.Select(t => t.Type).ToHashSet();
        var covered = AllChanges().Select(make => make().Change.GetType()).ToHashSet();
        await Assert.That(covered).IsEquivalentTo(registered);
    }
}
