using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="SegmentAnalysis"/>: a field left unset is left as
/// stored, and one set to null is cleared.
/// </summary>
public class PatchSegmentAnalysisChange(Guid entityId)
    : EditChange<SegmentAnalysis>(entityId), ISelfNamedType<PatchSegmentAnalysisChange>
{
    /// <summary>
    /// The patch that takes <paramref name="before"/> to <paramref name="after"/>, timestamps
    /// aside; null when nothing differs.
    /// </summary>
    public static PatchSegmentAnalysisChange? Diff(SegmentAnalysis before, SegmentAnalysis after)
    {
        var patch = new PatchSegmentAnalysisChange(after.Id)
        {
            SurfaceText = Patches.Changed(before.SurfaceText, after.SurfaceText) ? new(after.SurfaceText) : default,
            Confidence = Patches.Changed(before.Confidence, after.Confidence) ? new(after.Confidence) : default,
            Producer = Patches.Changed(before.Producer, after.Producer) ? new(after.Producer) : default,
            SourceUser = Patches.Changed(before.SourceUser, after.SourceUser) ? new(after.SourceUser) : default,
            FreeTranslation = MultiStringPatch.Diff(before.FreeTranslation, after.FreeTranslation),
            LiteralTranslation = MultiStringPatch.Diff(before.LiteralTranslation, after.LiteralTranslation),
        };
        return patch.IsEmpty ? null : patch;
    }

    [JsonIgnore]
    public bool IsEmpty =>
        !SurfaceText.HasValue &&
        !Confidence.HasValue &&
        !Producer.HasValue &&
        !SourceUser.HasValue &&
        FreeTranslation is null &&
        LiteralTranslation is null;

    public PatchField<string> SurfaceText { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }
    public PatchField<string?> Producer { get; init; }
    public PatchField<string?> SourceUser { get; init; }
    public MultiStringPatch? FreeTranslation { get; init; }
    public MultiStringPatch? LiteralTranslation { get; init; }

    public override ValueTask ApplyChange(SegmentAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (SurfaceText.HasValue) entity.SurfaceText = SurfaceText.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (Producer.HasValue) entity.Producer = Producer.Value;
        if (SourceUser.HasValue) entity.SourceUser = SourceUser.Value;
        if (FreeTranslation is not null) entity.FreeTranslation = MultiString.Patch(entity.FreeTranslation, FreeTranslation);
        if (LiteralTranslation is not null) entity.LiteralTranslation = MultiString.Patch(entity.LiteralTranslation, LiteralTranslation);
        return ValueTask.CompletedTask;
    }
}
