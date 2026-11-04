using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Creates a <see cref="TokenAnalysisLink"/>. A link to an analysis already deleted is created
/// deleted.
/// </summary>
[method: JsonConstructor]
public class CreateTokenAnalysisLinkChange(Guid entityId)
    : CreateChange<TokenAnalysisLink>(entityId), ISelfNamedType<CreateTokenAnalysisLinkChange>
{
    /// <summary>Carries every field of <paramref name="link"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreateTokenAnalysisLinkChange(TokenAnalysisLink link) : this(link.Id)
    {
        ProjectId = link.ProjectId;
        AnalysisId = link.AnalysisId;
        Token = link.Token;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public Guid ProjectId { get; init; }
    public required Guid AnalysisId { get; init; }
    public required TokenSnapshot Token { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask<TokenAnalysisLink> NewEntity(Commit commit, IChangeContext context)
    {
        return new TokenAnalysisLink
        {
            Id = EntityId,
            ProjectId = ProjectId,
            AnalysisId = AnalysisId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            Status = Status,
            Confidence = Confidence,
            Token = Token,
            DeletedAt = await context.IsObjectDeleted(AnalysisId) || await context.IsProjectDeleted(ProjectId)
                ? commit.DateTime
                : null,
        };
    }
}
