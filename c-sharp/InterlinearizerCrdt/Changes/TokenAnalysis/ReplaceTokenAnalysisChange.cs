using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Replaces every field of a <see cref="TokenAnalysis"/> but its identity and creation time.
/// </summary>
[method: JsonConstructor]
public class ReplaceTokenAnalysisChange(Guid entityId)
    : EditChange<TokenAnalysis>(entityId), ISelfNamedType<ReplaceTokenAnalysisChange>
{
    /// <summary>Carries every field of <paramref name="analysis"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public ReplaceTokenAnalysisChange(TokenAnalysis analysis) : this(analysis.Id)
    {
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        Morphemes = analysis.Morphemes;
        MorphemesStale = analysis.MorphemesStale;
        Pos = analysis.Pos;
        Features = analysis.Features;
        Gloss = analysis.Gloss;
        GlossSenseRef = analysis.GlossSenseRef;
    }

    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public List<MorphemeAnalysis>? Morphemes { get; init; }
    public bool? MorphemesStale { get; init; }
    public string? Pos { get; init; }
    public Dictionary<string, string>? Features { get; init; }
    public MultiString? Gloss { get; init; }
    public SenseRef? GlossSenseRef { get; init; }

    public override ValueTask ApplyChange(TokenAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.SurfaceText = SurfaceText;
        entity.Confidence = Confidence;
        entity.Producer = Producer;
        entity.SourceUser = SourceUser;
        entity.Morphemes = Morphemes;
        entity.MorphemesStale = MorphemesStale;
        entity.Pos = Pos;
        entity.Features = Features;
        entity.Gloss = Gloss;
        entity.GlossSenseRef = GlossSenseRef;
        return ValueTask.CompletedTask;
    }
}
