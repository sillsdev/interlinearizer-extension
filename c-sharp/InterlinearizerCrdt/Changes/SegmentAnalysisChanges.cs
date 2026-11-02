using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>Creates a <see cref="SegmentAnalysis"/>, stamped with the commit's time.</summary>
public class CreateSegmentAnalysisChange(Guid entityId)
    : CreateChange<SegmentAnalysis>(entityId), ISelfNamedType<CreateSegmentAnalysisChange>
{
    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public MultiString? FreeTranslation { get; init; }
    public MultiString? LiteralTranslation { get; init; }

    public override ValueTask<SegmentAnalysis> NewEntity(Commit commit, IChangeContext context)
    {
        return ValueTask.FromResult(new SegmentAnalysis
        {
            Id = EntityId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            SurfaceText = SurfaceText,
            Confidence = Confidence,
            Producer = Producer,
            SourceUser = SourceUser,
            FreeTranslation = FreeTranslation,
            LiteralTranslation = LiteralTranslation,
        });
    }
}

/// <summary>
/// Replaces every field of a <see cref="SegmentAnalysis"/> but its identity and creation time.
/// </summary>
public class ReplaceSegmentAnalysisChange(Guid entityId)
    : EditChange<SegmentAnalysis>(entityId), ISelfNamedType<ReplaceSegmentAnalysisChange>
{
    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public MultiString? FreeTranslation { get; init; }
    public MultiString? LiteralTranslation { get; init; }

    public override ValueTask ApplyChange(SegmentAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.SurfaceText = SurfaceText;
        entity.Confidence = Confidence;
        entity.Producer = Producer;
        entity.SourceUser = SourceUser;
        entity.FreeTranslation = FreeTranslation;
        entity.LiteralTranslation = LiteralTranslation;
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Creates a <see cref="SegmentAnalysisLink"/>. A link to an analysis already deleted is created
/// deleted.
/// </summary>
public class CreateSegmentAnalysisLinkChange(Guid entityId)
    : CreateChange<SegmentAnalysisLink>(entityId), ISelfNamedType<CreateSegmentAnalysisLinkChange>
{
    public required Guid AnalysisId { get; init; }
    public required string SegmentId { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask<SegmentAnalysisLink> NewEntity(Commit commit, IChangeContext context)
    {
        return new SegmentAnalysisLink
        {
            Id = EntityId,
            AnalysisId = AnalysisId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            Status = Status,
            Confidence = Confidence,
            SegmentId = SegmentId,
            DeletedAt = await context.IsObjectDeleted(AnalysisId) ? commit.DateTime : null,
        };
    }
}

/// <summary>
/// Replaces every field of a <see cref="SegmentAnalysisLink"/> but its identity and creation
/// time. Pointing the link at an analysis already deleted deletes the link.
/// </summary>
public class ReplaceSegmentAnalysisLinkChange(Guid entityId)
    : EditChange<SegmentAnalysisLink>(entityId), ISelfNamedType<ReplaceSegmentAnalysisLinkChange>
{
    public required Guid AnalysisId { get; init; }
    public required string SegmentId { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask ApplyChange(SegmentAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.AnalysisId = AnalysisId;
        entity.Status = Status;
        entity.Confidence = Confidence;
        entity.SegmentId = SegmentId;
        if (await context.IsObjectDeleted(AnalysisId)) entity.DeletedAt = context.Commit.DateTime;
    }
}
