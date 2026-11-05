using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Changes some of an <see cref="InterlinearProject"/>'s fields. The language list is replaced
/// whole, duplicates dropped; a null list leaves none.
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
        !AnalysisLanguages.HasValue;

    public PatchField<string?> Name { get; init; }
    public PatchField<string?> Description { get; init; }
    public PatchField<string?> TargetProjectId { get; init; }
    public PatchField<SegmentationDelta?> Segmentation { get; init; }
    public PatchField<List<string>?> AnalysisLanguages { get; init; }

    public override ValueTask ApplyChange(InterlinearProject entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (Name.HasValue) entity.Name = Name.Value;
        if (Description.HasValue) entity.Description = Description.Value;
        if (TargetProjectId.HasValue) entity.TargetProjectId = TargetProjectId.Value;
        if (Segmentation.HasValue) entity.Segmentation = Segmentation.Value;
        if (AnalysisLanguages.HasValue) entity.AnalysisLanguages = (AnalysisLanguages.Value ?? []).Distinct().ToList();
        return ValueTask.CompletedTask;
    }
}
