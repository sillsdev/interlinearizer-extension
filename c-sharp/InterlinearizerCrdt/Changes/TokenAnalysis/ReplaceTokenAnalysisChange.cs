using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Replaces every field of a <see cref="TokenAnalysis"/> but its identity.
/// A creation time the change does not carry stays as stored. An update time it does not carry
/// is the commit's time.
/// </summary>
[method: JsonConstructor]
public class ReplaceTokenAnalysisChange(Guid entityId)
    : EditChange<TokenAnalysis>(entityId), ISelfNamedType<ReplaceTokenAnalysisChange>
{
    /// <summary>
    /// Carries every field of <paramref name="analysis"/>. A timestamp left at its default is not
    /// carried.
    /// </summary>
    [SetsRequiredMembers]
    public ReplaceTokenAnalysisChange(TokenAnalysis analysis) : this(analysis.Id)
    {
        CreatedAt = Timestamps.Carried(analysis.CreatedAt);
        UpdatedAt = Timestamps.Carried(analysis.UpdatedAt);
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

    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }

    public override ValueTask ApplyChange(TokenAnalysis entity, IChangeContext context)
    {
        Timestamps.Write(entity, CreatedAt, UpdatedAt, context);
        entity.SurfaceText = SurfaceText;
        entity.Confidence = Confidence;
        entity.Producer = Producer;
        entity.SourceUser = SourceUser;
        entity.Morphemes = Morphemes;
        entity.MorphemesStale = MorphemesStale;
        entity.Pos = Pos;
        entity.Features = MultiString.NullIfEmpty(Features);
        entity.Gloss = MultiString.NullIfEmpty(Gloss);
        entity.GlossSenseRef = GlossSenseRef;
        return ValueTask.CompletedTask;
    }
}
