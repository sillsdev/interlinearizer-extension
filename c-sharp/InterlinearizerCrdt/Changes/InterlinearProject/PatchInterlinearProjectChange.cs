using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Changes some of an <see cref="InterlinearProject"/>'s fields. Languages are added and removed
/// rather than replaced, so two devices adding languages at once both keep theirs; a language
/// already present or already absent is left as it is, and one named in both lists ends present.
/// </summary>
public class PatchInterlinearProjectChange(Guid entityId)
    : EditChange<InterlinearProject>(entityId), ISelfNamedType<PatchInterlinearProjectChange>
{
    [JsonIgnore]
    public bool IsEmpty =>
        !Name.HasValue &&
        !Description.HasValue &&
        !TargetProjectId.HasValue &&
        !Segmentation.HasValue &&
        AddedAnalysisLanguages is not { Count: > 0 } &&
        RemovedAnalysisLanguages is not { Count: > 0 };

    public PatchField<string?> Name { get; init; }
    public PatchField<string?> Description { get; init; }
    public PatchField<string?> TargetProjectId { get; init; }
    public PatchField<SegmentationDelta?> Segmentation { get; init; }
    public List<string>? AddedAnalysisLanguages { get; init; }
    public List<string>? RemovedAnalysisLanguages { get; init; }

    public override ValueTask ApplyChange(InterlinearProject entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (Name.HasValue) entity.Name = Name.Value;
        if (Description.HasValue) entity.Description = Description.Value;
        if (TargetProjectId.HasValue) entity.TargetProjectId = TargetProjectId.Value;
        if (Segmentation.HasValue) entity.Segmentation = Segmentation.Value;
        foreach (var language in RemovedAnalysisLanguages ?? []) entity.AnalysisLanguages.Remove(language);
        foreach (var language in AddedAnalysisLanguages ?? [])
        {
            if (!entity.AnalysisLanguages.Contains(language)) entity.AnalysisLanguages.Add(language);
        }
        return ValueTask.CompletedTask;
    }
}
