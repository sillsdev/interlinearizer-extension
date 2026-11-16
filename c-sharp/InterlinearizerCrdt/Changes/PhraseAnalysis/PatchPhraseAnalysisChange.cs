using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="PhraseAnalysis"/>: a field left unset is left as
/// stored, and one set to null is cleared.
/// An update time the patch does not carry is the commit's time.
/// </summary>
public class PatchPhraseAnalysisChange(Guid entityId)
    : EditChange<PhraseAnalysis>(entityId), ISelfNamedType<PatchPhraseAnalysisChange>
{
    /// <summary>
    /// The patch that takes <paramref name="stored"/> to <paramref name="put"/>, or null when
    /// nothing differs. The patch carries the put's update time even when it matches the stored one.
    /// </summary>
    public static PatchPhraseAnalysisChange? Diff(PhraseAnalysis stored, PhraseAnalysis put)
    {
        var patch = new PatchPhraseAnalysisChange(put.Id)
        {
            CreatedAt = Timestamps.Changed(stored.CreatedAt, put.CreatedAt),
            UpdatedAt = Timestamps.Carried(put.UpdatedAt),
            SurfaceText = Patches.Changed(stored.SurfaceText, put.SurfaceText) ? new(put.SurfaceText) : default,
            Confidence = Patches.Changed(stored.Confidence, put.Confidence) ? new(put.Confidence) : default,
            Producer = Patches.Changed(stored.Producer, put.Producer) ? new(put.Producer) : default,
            SourceUser = Patches.Changed(stored.SourceUser, put.SourceUser) ? new(put.SourceUser) : default,
            SenseRef = Patches.Changed(stored.SenseRef, put.SenseRef) ? new(put.SenseRef) : default,
            Gloss = MultiStringPatch.Diff(stored.Gloss, put.Gloss),
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
        !SenseRef.HasValue &&
        Gloss is null;

    public PatchField<string> SurfaceText { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }
    public PatchField<string?> Producer { get; init; }
    public PatchField<string?> SourceUser { get; init; }
    public MultiStringPatch? Gloss { get; init; }
    public PatchField<SenseRef?> SenseRef { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }

    public override ValueTask ApplyChange(PhraseAnalysis entity, IChangeContext context)
    {
        Timestamps.Write(entity, CreatedAt, UpdatedAt, context);
        if (SurfaceText.HasValue) entity.SurfaceText = SurfaceText.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (Producer.HasValue) entity.Producer = Producer.Value;
        if (SourceUser.HasValue) entity.SourceUser = SourceUser.Value;
        if (Gloss is not null) entity.Gloss = MultiString.Patch(entity.Gloss, Gloss);
        if (SenseRef.HasValue) entity.SenseRef = SenseRef.Value;
        return ValueTask.CompletedTask;
    }
}
