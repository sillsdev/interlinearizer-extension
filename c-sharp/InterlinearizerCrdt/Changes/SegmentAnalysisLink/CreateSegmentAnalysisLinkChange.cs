using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Creates a <see cref="SegmentAnalysisLink"/>. A link to an analysis already deleted is created
/// deleted.
/// </summary>
[method: JsonConstructor]
public class CreateSegmentAnalysisLinkChange(Guid entityId)
    : CreateChange<SegmentAnalysisLink>(entityId), ISelfNamedType<CreateSegmentAnalysisLinkChange>
{
    /// <summary>Carries every field of <paramref name="link"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreateSegmentAnalysisLinkChange(SegmentAnalysisLink link) : this(link.Id)
    {
        ProjectId = link.ProjectId;
        AnalysisId = link.AnalysisId;
        SegmentId = link.SegmentId;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public Guid ProjectId { get; init; }
    public required Guid AnalysisId { get; init; }
    public required string SegmentId { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask<SegmentAnalysisLink> NewEntity(Commit commit, IChangeContext context)
    {
        return new SegmentAnalysisLink
        {
            Id = EntityId,
            ProjectId = ProjectId,
            AnalysisId = AnalysisId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            Status = Status,
            Confidence = Confidence,
            SegmentId = SegmentId,
            DeletedAt = await context.IsObjectDeleted(AnalysisId) || await context.IsProjectDeleted(ProjectId)
                ? commit.DateTime
                : null,
        };
    }
}
