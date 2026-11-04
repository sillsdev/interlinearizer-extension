using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Creates a <see cref="PhraseAnalysisLink"/>. A link to an analysis already deleted is created
/// deleted.
/// </summary>
[method: JsonConstructor]
public class CreatePhraseAnalysisLinkChange(Guid entityId)
    : CreateChange<PhraseAnalysisLink>(entityId), ISelfNamedType<CreatePhraseAnalysisLinkChange>
{
    /// <summary>Carries every field of <paramref name="link"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreatePhraseAnalysisLinkChange(PhraseAnalysisLink link) : this(link.Id)
    {
        ProjectId = link.ProjectId;
        AnalysisId = link.AnalysisId;
        Tokens = link.Tokens;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public Guid ProjectId { get; init; }
    public required Guid AnalysisId { get; init; }
    public required List<TokenSnapshot> Tokens { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask<PhraseAnalysisLink> NewEntity(Commit commit, IChangeContext context)
    {
        return new PhraseAnalysisLink
        {
            Id = EntityId,
            ProjectId = ProjectId,
            AnalysisId = AnalysisId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            Status = Status,
            Confidence = Confidence,
            Tokens = Tokens,
            DeletedAt = await context.IsObjectDeleted(AnalysisId) || await context.IsProjectDeleted(ProjectId)
                ? commit.DateTime
                : null,
        };
    }
}
