using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// One interlinear project over the Paratext project its database represents. Every analysis
/// and link names the project it belongs to, so deleting the project deletes them all.
/// </summary>
public class InterlinearProject : IObjectBase<InterlinearProject>
{
    public Guid Id { get; init; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public string? Name { get; set; }

    public string? Description { get; set; }

    /// <summary>The Paratext project the analysis is aligned to, when there is one.</summary>
    public string? TargetProjectId { get; set; }

    /// <summary>BCP 47 tags of the languages glosses and translations are written in.</summary>
    public List<string> AnalysisLanguages { get; set; } = [];

    /// <summary>Where this project's segment boundaries depart from the verses.</summary>
    public SegmentationDelta? Segmentation { get; set; }

    /// <summary>A project references nothing, so a deletion elsewhere never reaches it.</summary>
    public Guid[] GetReferences() => [];

    public void RemoveReference(Guid id, CommitBase commit)
    {
    }

    public IObjectBase Copy() => new InterlinearProject
    {
        Id = Id,
        DeletedAt = DeletedAt,
        CreatedAt = CreatedAt,
        UpdatedAt = UpdatedAt,
        Name = Name,
        Description = Description,
        TargetProjectId = TargetProjectId,
        AnalysisLanguages = AnalysisLanguages.ToList(),
        Segmentation = Segmentation?.Copy(),
    };
}

/// <summary>
/// Boundary changes against the verse segmentation: verse starts no longer segment boundaries, and
/// tokens that start a segment within a verse.
/// </summary>
public record SegmentationDelta(List<string> RemovedVerseStarts, List<TokenSnapshot> AddedStarts)
{
    public SegmentationDelta Copy() => new(RemovedVerseStarts.ToList(), AddedStarts.ToList());
}
