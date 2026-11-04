using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>Creates an <see cref="InterlinearProject"/>, stamped with the commit's time.</summary>
[method: JsonConstructor]
public class CreateInterlinearProjectChange(Guid entityId)
    : CreateChange<InterlinearProject>(entityId), ISelfNamedType<CreateInterlinearProjectChange>
{
    /// <summary>Carries every field of <paramref name="project"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreateInterlinearProjectChange(InterlinearProject project) : this(project.Id)
    {
        Name = project.Name;
        Description = project.Description;
        TargetProjectId = project.TargetProjectId;
        AnalysisLanguages = project.AnalysisLanguages;
        Segmentation = project.Segmentation;
    }

    public string? Name { get; init; }
    public string? Description { get; init; }
    public string? TargetProjectId { get; init; }
    public List<string> AnalysisLanguages { get; init; } = [];
    public SegmentationDelta? Segmentation { get; init; }

    public override ValueTask<InterlinearProject> NewEntity(Commit commit, IChangeContext context)
    {
        return ValueTask.FromResult(new InterlinearProject
        {
            Id = EntityId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            Name = Name,
            Description = Description,
            TargetProjectId = TargetProjectId,
            AnalysisLanguages = AnalysisLanguages.Distinct().ToList(),
            Segmentation = Segmentation,
        });
    }
}
