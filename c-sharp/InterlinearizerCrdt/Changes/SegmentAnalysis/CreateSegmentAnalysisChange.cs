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
        ProjectId = analysis.ProjectId;
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        FreeTranslation = analysis.FreeTranslation;
        LiteralTranslation = analysis.LiteralTranslation;
    }

    public Guid ProjectId { get; init; }
    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public MultiString? FreeTranslation { get; init; }
    public MultiString? LiteralTranslation { get; init; }

    public override async ValueTask<SegmentAnalysis> NewEntity(Commit commit, IChangeContext context)
    {
        return new SegmentAnalysis
        {
            Id = EntityId,
            ProjectId = ProjectId,
            DeletedAt = await context.IsProjectDeleted(ProjectId) ? commit.DateTime : null,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            SurfaceText = SurfaceText,
            Confidence = Confidence,
            Producer = Producer,
            SourceUser = SourceUser,
            FreeTranslation = MultiString.NullIfEmpty(FreeTranslation),
            LiteralTranslation = MultiString.NullIfEmpty(LiteralTranslation),
        };
    }
}
