using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>Creates a <see cref="SegmentAnalysis"/>, stamped with the commit's time.</summary>
[method: JsonConstructor]
public class CreateSegmentAnalysisChange(Guid entityId)
    : CreateChange<SegmentAnalysis>(entityId), ISelfNamedType<CreateSegmentAnalysisChange>
{
    /// <summary>Carries every field of <paramref name="analysis"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreateSegmentAnalysisChange(SegmentAnalysis analysis) : this(analysis.Id)
    {
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
[method: JsonConstructor]
public class ReplaceSegmentAnalysisChange(Guid entityId)
    : EditChange<SegmentAnalysis>(entityId), ISelfNamedType<ReplaceSegmentAnalysisChange>
{
    /// <summary>Carries every field of <paramref name="analysis"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public ReplaceSegmentAnalysisChange(SegmentAnalysis analysis) : this(analysis.Id)
    {
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
[method: JsonConstructor]
public class CreateSegmentAnalysisLinkChange(Guid entityId)
    : CreateChange<SegmentAnalysisLink>(entityId), ISelfNamedType<CreateSegmentAnalysisLinkChange>
{
    /// <summary>Carries every field of <paramref name="link"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreateSegmentAnalysisLinkChange(SegmentAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        SegmentId = link.SegmentId;
        Status = link.Status;
        Confidence = link.Confidence;
    }

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
[method: JsonConstructor]
public class ReplaceSegmentAnalysisLinkChange(Guid entityId)
    : EditChange<SegmentAnalysisLink>(entityId), ISelfNamedType<ReplaceSegmentAnalysisLinkChange>
{
    /// <summary>Carries every field of <paramref name="link"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public ReplaceSegmentAnalysisLinkChange(SegmentAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        SegmentId = link.SegmentId;
        Status = link.Status;
        Confidence = link.Confidence;
    }

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
