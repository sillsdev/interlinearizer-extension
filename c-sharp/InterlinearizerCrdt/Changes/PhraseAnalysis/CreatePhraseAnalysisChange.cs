using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>Creates a <see cref="PhraseAnalysis"/>, stamped with the commit's time.</summary>
[method: JsonConstructor]
public class CreatePhraseAnalysisChange(Guid entityId)
    : CreateChange<PhraseAnalysis>(entityId), ISelfNamedType<CreatePhraseAnalysisChange>
{
    /// <summary>Carries every field of <paramref name="analysis"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreatePhraseAnalysisChange(PhraseAnalysis analysis) : this(analysis.Id)
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

    public override ValueTask<PhraseAnalysis> NewEntity(Commit commit, IChangeContext context)
    {
        return ValueTask.FromResult(new PhraseAnalysis
        {
            Id = EntityId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            SurfaceText = SurfaceText,
            Confidence = Confidence,
            Producer = Producer,
            SourceUser = SourceUser,
            Gloss = Gloss,
            SenseRef = SenseRef,
        });
    }
}
