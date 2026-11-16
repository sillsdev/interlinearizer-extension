using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="SegmentAnalysis"/>: a field left unset is left as
/// stored, and one set to null is cleared.
/// An update time the patch does not carry is the commit's time.
/// </summary>
public class PatchSegmentAnalysisChange(Guid entityId)
    : EditChange<SegmentAnalysis>(entityId), ISelfNamedType<PatchSegmentAnalysisChange>
{
    /// <summary>
    /// The patch that takes <paramref name="stored"/> to <paramref name="put"/>, or null when
    /// nothing differs. The patch carries the put's update time even when it matches the stored one.
    /// </summary>
    public static PatchSegmentAnalysisChange? Diff(SegmentAnalysis stored, SegmentAnalysis put)
    {
        var patch = new PatchSegmentAnalysisChange(put.Id)
        {
            CreatedAt = Timestamps.Changed(stored.CreatedAt, put.CreatedAt),
            UpdatedAt = Timestamps.Carried(put.UpdatedAt),
            SurfaceText = Patches.Changed(stored.SurfaceText, put.SurfaceText) ? new(put.SurfaceText) : default,
            Confidence = Patches.Changed(stored.Confidence, put.Confidence) ? new(put.Confidence) : default,
            Producer = Patches.Changed(stored.Producer, put.Producer) ? new(put.Producer) : default,
            SourceUser = Patches.Changed(stored.SourceUser, put.SourceUser) ? new(put.SourceUser) : default,
            FreeTranslation = MultiStringPatch.Diff(stored.FreeTranslation, put.FreeTranslation),
            LiteralTranslation = MultiStringPatch.Diff(stored.LiteralTranslation, put.LiteralTranslation),
        };
        return patch.IsEmpty && Timestamps.Changed(stored.UpdatedAt, put.UpdatedAt) is null ? null : patch;
    }

    /// <summary>Whether the patch sets nothing but the update time.</summary>
    [JsonIgnore]
    public bool IsEmpty =>
        CreatedAt is null &&
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

    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }

    public override ValueTask ApplyChange(SegmentAnalysis entity, IChangeContext context)
    {
        Timestamps.Write(entity, CreatedAt, UpdatedAt, context);
        if (SurfaceText.HasValue) entity.SurfaceText = SurfaceText.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (Producer.HasValue) entity.Producer = Producer.Value;
        if (SourceUser.HasValue) entity.SourceUser = SourceUser.Value;
        if (FreeTranslation is not null) entity.FreeTranslation = MultiString.Patch(entity.FreeTranslation, FreeTranslation);
        if (LiteralTranslation is not null) entity.LiteralTranslation = MultiString.Patch(entity.LiteralTranslation, LiteralTranslation);
        return ValueTask.CompletedTask;
    }
}
