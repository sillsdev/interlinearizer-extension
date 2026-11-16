using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Creates a <see cref="SegmentAnalysis"/>. An analysis in a project already deleted is created
/// deleted. A timestamp the change does not carry is the commit's time.
/// </summary>
[method: JsonConstructor]
public class CreateSegmentAnalysisChange(Guid entityId)
    : CreateChange<SegmentAnalysis>(entityId), ISelfNamedType<CreateSegmentAnalysisChange>
{
    /// <summary>
    /// Carries every field of <paramref name="analysis"/>, filed under <paramref name="projectId"/>.
    /// A timestamp left at its default is not carried.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// If <paramref name="projectId"/> is empty, or the analysis names another project.
    /// </exception>
    [SetsRequiredMembers]
    public CreateSegmentAnalysisChange(SegmentAnalysis analysis, Guid projectId) : this(analysis.Id)
    {
        ProjectId = ProjectReferences.ProjectOf(analysis, projectId);
        CreatedAt = Timestamps.Carried(analysis.CreatedAt);
        UpdatedAt = Timestamps.Carried(analysis.UpdatedAt);
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        FreeTranslation = analysis.FreeTranslation;
        LiteralTranslation = analysis.LiteralTranslation;
    }

    public required Guid ProjectId { get; init; }
    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }
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
            DeletedAt = await context.IsObjectDeleted(ProjectId) ? commit.DateTime : null,
            CreatedAt = CreatedAt ?? commit.DateTime,
            UpdatedAt = UpdatedAt ?? commit.DateTime,
            SurfaceText = SurfaceText,
            Confidence = Confidence,
            Producer = Producer,
            SourceUser = SourceUser,
            FreeTranslation = MultiString.NullIfEmpty(FreeTranslation),
            LiteralTranslation = MultiString.NullIfEmpty(LiteralTranslation),
        };
    }
}
