using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Replaces every field of a <see cref="PhraseAnalysis"/> but its identity.
/// A creation time the change does not carry stays as stored. An update time it does not carry
/// is the commit's time.
/// </summary>
[method: JsonConstructor]
public class ReplacePhraseAnalysisChange(Guid entityId)
    : EditChange<PhraseAnalysis>(entityId), ISelfNamedType<ReplacePhraseAnalysisChange>
{
    /// <summary>
    /// Carries every field of <paramref name="analysis"/>. A timestamp left at its default is not
    /// carried.
    /// </summary>
    [SetsRequiredMembers]
    public ReplacePhraseAnalysisChange(PhraseAnalysis analysis) : this(analysis.Id)
    {
        CreatedAt = Timestamps.Carried(analysis.CreatedAt);
        UpdatedAt = Timestamps.Carried(analysis.UpdatedAt);
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        Gloss = analysis.Gloss;
        SenseRef = analysis.SenseRef;
    }

    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public MultiString? Gloss { get; init; }
    public SenseRef? SenseRef { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }

    public override ValueTask ApplyChange(PhraseAnalysis entity, IChangeContext context)
    {
        Timestamps.Write(entity, CreatedAt, UpdatedAt, context);
        entity.SurfaceText = SurfaceText;
        entity.Confidence = Confidence;
        entity.Producer = Producer;
        entity.SourceUser = SourceUser;
        entity.Gloss = MultiString.NullIfEmpty(Gloss);
        entity.SenseRef = SenseRef;
        return ValueTask.CompletedTask;
    }
}
