using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SIL.Harmony.Config;

namespace Interlinearizer.Crdt.Tests;

/// <summary>
/// SerializedChanges holds one file per registered change type: its <c>latest</c> JSON as today's
/// code writes it, and <c>legacy</c> shapes that earlier builds wrote. A legacy <c>input</c> is frozen
/// history and only its <c>output</c> is regenerated; a <c>latest</c> entry that stops matching moves
/// to legacy, unless it only reorders or re-escapes. The test rewrites the files and fails once, so
/// the change is reviewed and committed. A file that no longer matches a registered discriminator means
/// its change type needs a migration path.
/// <para>
/// Each file is stamped with the model version its <c>latest</c> was written under, and a moved row keeps
/// that stamp. An app on that version reads the new JSON with its old code and drops what it doesn't know,
/// so the type must be listed in a later model version for the upgrade to replay it; the test demands one.
/// Listing a type is cheap. A version that left one out is repaired only by a later version that lists it
/// with <c>invalidateFrom</c> at the version that left it out.
/// </para>
/// </summary>
public class ChangeSerializationTests
{
    internal const string ModelVersionsFile = "ModelVersions.txt";

    private static readonly Guid Id = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid AnalysisId = new("22222222-2222-2222-2222-222222222222");
    private static readonly UTF8Encoding Utf8NoBom = new(false);

    private static readonly Lazy<HarmonyConfig> Config = new(() =>
    {
        var config = new HarmonyConfig();
        InterlinearizerCrdtKernel.ConfigureHarmony(config);
        return config;
    });

    private static JsonSerializerOptions Options => Config.Value.JsonSerializerOptions;

    private readonly List<string> _problems = [];

    public static IEnumerable<IChange> AllChanges()
    {
        yield return Fixtures.CreateInterlinearProject(Id);
        yield return Fixtures.PatchInterlinearProject(Id);
        yield return Fixtures.PatchInterlinearProjectAllFields(Id);
        yield return new DeleteChange<InterlinearProject>(Id);
        yield return Fixtures.CreateSegmentAnalysis(Id);
        yield return Fixtures.ReplaceSegmentAnalysis(Id);
        yield return new DeleteChange<SegmentAnalysis>(Id);
        yield return Fixtures.CreateSegmentAnalysisLink(Id, AnalysisId);
        yield return Fixtures.ReplaceSegmentAnalysisLink(Id, AnalysisId);
        yield return new DeleteChange<SegmentAnalysisLink>(Id);
        yield return Fixtures.CreateTokenAnalysis(Id);
        yield return Fixtures.ReplaceTokenAnalysis(Id);
        yield return new DeleteChange<TokenAnalysis>(Id);
        yield return Fixtures.CreateTokenAnalysisLink(Id, AnalysisId);
        yield return Fixtures.ReplaceTokenAnalysisLink(Id, AnalysisId);
        yield return new DeleteChange<TokenAnalysisLink>(Id);
        yield return Fixtures.CreatePhraseAnalysis(Id);
        yield return Fixtures.ReplacePhraseAnalysis(Id);
        yield return new DeleteChange<PhraseAnalysis>(Id);
        yield return Fixtures.CreatePhraseAnalysisLink(Id, AnalysisId);
        yield return Fixtures.ReplacePhraseAnalysisLink(Id, AnalysisId);
        yield return new DeleteChange<PhraseAnalysisLink>(Id);
        yield return Fixtures.PatchSegmentAnalysis(Id);
        yield return Fixtures.PatchSegmentAnalysisAllFields(Id);
        yield return Fixtures.PatchSegmentAnalysisLink(Id);
        yield return Fixtures.PatchSegmentAnalysisLinkAllFields(Id, AnalysisId);
        yield return Fixtures.PatchTokenAnalysis(Id);
        yield return Fixtures.PatchTokenAnalysisAllFields(Id);
        yield return Fixtures.PatchTokenAnalysisLink(Id);
        yield return Fixtures.PatchTokenAnalysisLinkAllFields(Id, AnalysisId);
        yield return Fixtures.PatchPhraseAnalysis(Id);
        yield return Fixtures.PatchPhraseAnalysisAllFields(Id);
        yield return Fixtures.PatchPhraseAnalysisLink(Id);
        yield return Fixtures.PatchPhraseAnalysisLinkAllFields(Id, AnalysisId);
    }

    [Test]
    [NotInParallel]
    public async Task StoredChangesStillDeserialize()
    {
        var directory = SerializedChangesDirectory();
        var samples = AllChanges().ToList();
        CheckEverySampleAndRegistrationPairUp(samples);

        var files = new List<(string Path, string Stored, string Expected, bool Written)>();
        foreach (var changeType in Config.Value.ChangeTypes)
        {
            var path = Path.Combine(directory, FileName(changeType));
            var stored = ReadStored(path);
            var expected = ExpectedFile(changeType, samples.Where(c => c.GetType() == changeType.Type), stored);
            files.Add((path, stored, expected, WriteIfChanged(path, stored, expected)));
        }

        CheckEveryFileHasARegisteredType(directory);

        using var _ = Assert.Multiple();
        foreach (var problem in _problems)
            Assert.Fail(problem);
        foreach (var file in files)
            await Assert.That(file.Stored).IsEqualTo(file.Expected).Because(OutOfDateMessage(file.Path, file.Written));
    }

    private void CheckEverySampleAndRegistrationPairUp(List<IChange> samples)
    {
        var sampled = samples.Select(c => c.GetType()).ToHashSet();
        var registered = Config.Value.ChangeTypes.Select(t => t.Type).ToHashSet();
        foreach (var type in registered.Except(sampled))
            _problems.Add($"{type.Name} has no sample in AllChanges().");
        foreach (var type in sampled.Except(registered))
            _problems.Add($"{type.Name} has a sample in AllChanges() but is not registered.");
    }

    private void CheckEveryFileHasARegisteredType(string directory)
    {
        var known = Config.Value.ChangeTypes.Select(FileName).ToHashSet();
        foreach (var name in Directory.EnumerateFiles(directory, "*.json").Select(Path.GetFileName))
        {
            if (known.Contains(name!)) continue;
            _problems.Add($"{name} matches no registered change type. A removed or renamed change type needs a migration path; don't delete its file.");
        }
    }

    /// <summary>
    /// The file as today's code writes it: <c>latest</c> from the samples, the stored legacy rows with their output
    /// regenerated, and a new legacy row for each stored <c>latest</c> entry that today's samples no longer produce.
    /// </summary>
    private string ExpectedFile(RegisteredChangeType changeType, IEnumerable<IChange> samples, string storedText)
    {
        var latest = samples.Select(Serialize).ToList();
        foreach (var node in latest)
            CheckRoundTrips(changeType, node);
        CheckEveryPropertyIsSampled(changeType, latest);
        var stored = storedText == "" ? null : JsonNode.Parse(storedText)!.AsObject();
        var storedVersion = stored?["modelVersion"]?.GetValue<int>() ?? Config.Value.CurrentModelVersion;

        var legacy = new JsonArray();
        foreach (var row in Entries(stored, "legacy"))
            legacy.Add(LegacyRow(changeType, row["modelVersion"]!.GetValue<int>(), row["input"]!, row["output"]));
        foreach (var entry in Entries(stored, "latest"))
        {
            var stillWritten = latest.Any(node => JsonNode.DeepEquals(node, entry));
            if (!stillWritten) legacy.Add(LegacyRow(changeType, storedVersion, entry, storedOutput: null));
        }

        return Format(new JsonObject
        {
            ["modelVersion"] = Config.Value.CurrentModelVersion,
            ["latest"] = new JsonArray(latest.ToArray()),
            ["legacy"] = legacy,
        }) + "\n";
    }

    private void CheckRoundTrips(RegisteredChangeType changeType, JsonNode latest)
    {
        var roundTripped = Reserialize(changeType, Format(latest));
        if (roundTripped is not null && !JsonNode.DeepEquals(latest, roundTripped))
            _problems.Add($"{FileName(changeType)}: a latest entry changes when read back and written again:\n{Format(latest)}\nbecomes\n{Format(roundTripped)}");
    }

    /// <summary>A patch leaves unset fields out, so a field no sample sets could change without changing the file.</summary>
    private void CheckEveryPropertyIsSampled(RegisteredChangeType changeType, List<JsonNode> latest)
    {
        var written = latest.SelectMany(node => node.AsObject().Select(property => property.Key)).ToHashSet();
        foreach (var property in Options.GetTypeInfo(changeType.Type).Properties)
            if (property.Get is not null && !written.Contains(property.Name))
                _problems.Add($"{FileName(changeType)}: no sample sets {property.Name}.");
    }

    /// <summary>
    /// A legacy row keeps its <c>input</c> and the model version that wrote it, and gets its <c>output</c> from
    /// today's code, or the stored one when today's code can't read the input.
    /// </summary>
    private JsonObject LegacyRow(RegisteredChangeType changeType, int modelVersion, JsonNode input, JsonNode? storedOutput)
    {
        var inputText = Format(input);
        var output = Reserialize(changeType, inputText) ?? storedOutput?.DeepClone();

        var listedLater = Config.Value.ModelVersions.Any(version =>
            version.Number > modelVersion && version.Changes.Any(change => change.ChangeType == changeType.Discriminator));
        if (!listedLater)
            _problems.Add($"{FileName(changeType)}: {changeType.Discriminator} changed its JSON after model version {modelVersion}. " +
                "An app on that version reads the new JSON with its old code and drops what it doesn't know, so list the type " +
                $"in a model version after {modelVersion} in {nameof(InterlinearizerCrdtKernel)} and the upgrade replays it. " +
                "If you only changed a sample's values, or no release wrote the old JSON, delete the new legacy row instead.");

        return new JsonObject { ["modelVersion"] = modelVersion, ["input"] = JsonNode.Parse(inputText), ["output"] = output };
    }

    /// <summary>Today's JSON for a stored change, which must still read back as the file's type.</summary>
    private JsonNode? Reserialize(RegisteredChangeType changeType, string json)
    {
        IChange? change;
        try
        {
            change = JsonSerializer.Deserialize<IChange>(json, Options);
        }
        catch (JsonException e)
        {
            _problems.Add($"{FileName(changeType)}: an entry no longer deserializes: {e.Message}");
            return null;
        }

        if (change is null || change.GetType() != changeType.Type)
            _problems.Add($"{FileName(changeType)}: an entry reads back as {change?.GetType().Name ?? "null"}, not {changeType.Type.Name}.");
        return change is null ? null : Serialize(change);
    }

    [Test]
    public async Task APatchLeavesUnsetFieldsOutAndKeepsFieldsSetToNull()
    {
        var json = JsonSerializer.Serialize(Fixtures.PatchTokenAnalysis(Id), Options);

        using var document = JsonDocument.Parse(json);
        var names = document.RootElement.EnumerateObject().Select(p => p.Name).ToList();
        await Assert.That(names).DoesNotContain("SurfaceText");
        await Assert.That(names).DoesNotContain("Morphemes");
        await Assert.That(document.RootElement.GetProperty("Pos").ValueKind).IsEqualTo(JsonValueKind.Null);
        await Assert.That(document.RootElement.GetProperty("Gloss").GetProperty("fr").ValueKind).IsEqualTo(JsonValueKind.Null);

        var roundTripped = JsonSerializer.Deserialize<IChange>(json, Options);
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
    public async Task EnumsSerializeAsTheModelsStrings()
    {
        var json = JsonSerializer.Serialize(Fixtures.CreateTokenAnalysisLink(Id, AnalysisId), Options);

        using var document = JsonDocument.Parse(json);
        await Assert.That(document.RootElement.GetProperty("Status").GetString()).IsEqualTo("suggested");
        await Assert.That(document.RootElement.GetProperty("Confidence").GetString()).IsEqualTo("low");
    }

    internal static string SerializedChangesDirectory([CallerFilePath] string sourceFile = "") =>
        Path.Combine(Path.GetDirectoryName(sourceFile)!, "SerializedChanges");

    internal static string ReadStored(string path) => File.Exists(path) ? File.ReadAllText(path, Utf8NoBom) : "";

    /// <summary>Writes atomically, and never under CI, where a read-only checkout should fail with the diff.</summary>
    internal static bool WriteIfChanged(string path, string stored, string expected)
    {
        if (stored == expected || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CI"))) return false;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        File.WriteAllText(temp, expected, Utf8NoBom);
        File.Move(temp, path, overwrite: true);
        return true;
    }

    internal static string OutOfDateMessage(string path, bool written) => written
        ? $"{Path.GetFileName(path)} was out of date and has been rewritten: review the change and commit it"
        : $"{Path.GetFileName(path)} is out of date: run this test locally to rewrite it, then review and commit it";

    private static string FileName(RegisteredChangeType changeType) => changeType.Discriminator.Replace(':', '-') + ".json";

    private static IEnumerable<JsonNode> Entries(JsonObject? file, string key) =>
        file?[key]?.AsArray().Select(entry => entry!) ?? [];

    private static JsonNode Serialize(IChange change) => JsonNode.Parse(JsonSerializer.Serialize(change, Options))!;

    /// <summary>Indented, through Harmony's own encoder so that escaping matches what Harmony writes.</summary>
    private static string Format(JsonNode? node)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions
        {
            Encoder = Options.Encoder,
            Indented = true,
            NewLine = "\n",
        }))
        {
            if (node is null) writer.WriteNullValue();
            else node.WriteTo(writer);
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }
}
