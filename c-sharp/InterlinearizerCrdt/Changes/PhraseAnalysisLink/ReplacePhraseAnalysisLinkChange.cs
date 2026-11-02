using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Replaces every field of a <see cref="PhraseAnalysisLink"/> but its identity and creation
/// time. Pointing the link at an analysis already deleted deletes the link.
/// </summary>
[method: JsonConstructor]
public class ReplacePhraseAnalysisLinkChange(Guid entityId)
    : EditChange<PhraseAnalysisLink>(entityId), ISelfNamedType<ReplacePhraseAnalysisLinkChange>
{
    /// <summary>Carries every field of <paramref name="link"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public ReplacePhraseAnalysisLinkChange(PhraseAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        Tokens = link.Tokens;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public required Guid AnalysisId { get; init; }
    public required List<TokenSnapshot> Tokens { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask ApplyChange(PhraseAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.AnalysisId = AnalysisId;
        entity.Status = Status;
        entity.Confidence = Confidence;
        entity.Tokens = Tokens;
        if (await context.IsObjectDeleted(AnalysisId)) entity.DeletedAt = context.Commit.DateTime;
    }
}
