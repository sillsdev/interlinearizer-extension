using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Replaces every field of a <see cref="SegmentAnalysis"/> but its identity.
/// A creation time the change does not carry stays as stored. An update time it does not carry
/// is the commit's time.
/// </summary>
[method: JsonConstructor]
public class ReplaceSegmentAnalysisChange(Guid entityId)
    : EditChange<SegmentAnalysis>(entityId), ISelfNamedType<ReplaceSegmentAnalysisChange>
{
    /// <summary>
    /// Carries every field of <paramref name="analysis"/>. A timestamp left at its default is not
    /// carried.
    /// </summary>
    [SetsRequiredMembers]
    public ReplaceSegmentAnalysisChange(SegmentAnalysis analysis) : this(analysis.Id)
    {
        CreatedAt = Timestamps.Carried(analysis.CreatedAt);
        UpdatedAt = Timestamps.Carried(analysis.UpdatedAt);
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        FreeTranslation = analysis.FreeTranslation;
        LiteralTranslation = analysis.LiteralTranslation;
    }

    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public MultiString? FreeTranslation { get; init; }
    public MultiString? LiteralTranslation { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }

    public override ValueTask ApplyChange(SegmentAnalysis entity, IChangeContext context)
    {
        Timestamps.Write(entity, CreatedAt, UpdatedAt, context);
        entity.SurfaceText = SurfaceText;
        entity.Confidence = Confidence;
        entity.Producer = Producer;
        entity.SourceUser = SourceUser;
        entity.FreeTranslation = MultiString.NullIfEmpty(FreeTranslation);
        entity.LiteralTranslation = MultiString.NullIfEmpty(LiteralTranslation);
        return ValueTask.CompletedTask;
    }
}
