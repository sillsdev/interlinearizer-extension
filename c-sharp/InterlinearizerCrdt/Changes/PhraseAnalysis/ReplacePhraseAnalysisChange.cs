using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Replaces every field of a <see cref="PhraseAnalysis"/> but its identity and creation time.
/// </summary>
[method: JsonConstructor]
public class ReplacePhraseAnalysisChange(Guid entityId)
    : EditChange<PhraseAnalysis>(entityId), ISelfNamedType<ReplacePhraseAnalysisChange>
{
    /// <summary>Carries every field of <paramref name="analysis"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public ReplacePhraseAnalysisChange(PhraseAnalysis analysis) : this(analysis.Id)
    {
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

    public override ValueTask ApplyChange(PhraseAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.SurfaceText = SurfaceText;
        entity.Confidence = Confidence;
        entity.Producer = Producer;
        entity.SourceUser = SourceUser;
        entity.Gloss = Gloss;
        entity.SenseRef = SenseRef;
        return ValueTask.CompletedTask;
    }
}
