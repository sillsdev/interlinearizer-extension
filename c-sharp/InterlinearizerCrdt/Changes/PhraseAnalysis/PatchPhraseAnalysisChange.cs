using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="PhraseAnalysis"/>: a field left unset is left as
/// stored, and one set to null is cleared.
/// </summary>
public class PatchPhraseAnalysisChange(Guid entityId)
    : EditChange<PhraseAnalysis>(entityId), ISelfNamedType<PatchPhraseAnalysisChange>
{
    /// <summary>
    /// The patch that takes <paramref name="before"/> to <paramref name="after"/>, timestamps
    /// aside; null when nothing differs.
    /// </summary>
    public static PatchPhraseAnalysisChange? Diff(PhraseAnalysis before, PhraseAnalysis after)
    {
        var patch = new PatchPhraseAnalysisChange(after.Id)
        {
            SurfaceText = Patches.Changed(before.SurfaceText, after.SurfaceText) ? new(after.SurfaceText) : default,
            Confidence = Patches.Changed(before.Confidence, after.Confidence) ? new(after.Confidence) : default,
            Producer = Patches.Changed(before.Producer, after.Producer) ? new(after.Producer) : default,
            SourceUser = Patches.Changed(before.SourceUser, after.SourceUser) ? new(after.SourceUser) : default,
            SenseRef = Patches.Changed(before.SenseRef, after.SenseRef) ? new(after.SenseRef) : default,
            Gloss = MultiStringPatch.Diff(before.Gloss, after.Gloss),
        };
        return patch.IsEmpty ? null : patch;
    }

    [JsonIgnore]
    public bool IsEmpty =>
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

    public override ValueTask ApplyChange(PhraseAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (SurfaceText.HasValue) entity.SurfaceText = SurfaceText.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (Producer.HasValue) entity.Producer = Producer.Value;
        if (SourceUser.HasValue) entity.SourceUser = SourceUser.Value;
        if (Gloss is not null) entity.Gloss = MultiString.Patch(entity.Gloss, Gloss);
        if (SenseRef.HasValue) entity.SenseRef = SenseRef.Value;
        return ValueTask.CompletedTask;
    }
}
