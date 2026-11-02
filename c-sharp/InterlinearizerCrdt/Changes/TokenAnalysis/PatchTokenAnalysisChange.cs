using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;
using ZibStack.NET.Dto;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="TokenAnalysis"/>: a field left unset is left as
/// stored, and one set to null is cleared.
/// </summary>
public class PatchTokenAnalysisChange(Guid entityId)
    : EditChange<TokenAnalysis>(entityId), ISelfNamedType<PatchTokenAnalysisChange>
{
    /// <summary>
    /// The patch that takes <paramref name="stored"/> to <paramref name="put"/>, timestamps
    /// aside; null when nothing differs.
    /// </summary>
    public static PatchTokenAnalysisChange? Diff(TokenAnalysis stored, TokenAnalysis put)
    {
        var patch = new PatchTokenAnalysisChange(put.Id)
        {
            SurfaceText = Patches.Changed(stored.SurfaceText, put.SurfaceText) ? new(put.SurfaceText) : default,
            Confidence = Patches.Changed(stored.Confidence, put.Confidence) ? new(put.Confidence) : default,
            Producer = Patches.Changed(stored.Producer, put.Producer) ? new(put.Producer) : default,
            SourceUser = Patches.Changed(stored.SourceUser, put.SourceUser) ? new(put.SourceUser) : default,
            MorphemesStale = Patches.Changed(stored.MorphemesStale, put.MorphemesStale) ? new(put.MorphemesStale) : default,
            Pos = Patches.Changed(stored.Pos, put.Pos) ? new(put.Pos) : default,
            GlossSenseRef = Patches.Changed(stored.GlossSenseRef, put.GlossSenseRef) ? new(put.GlossSenseRef) : default,
            Morphemes = Patches.ListChanged(stored.Morphemes, put.Morphemes) ? new(put.Morphemes) : default,
            Features = MultiStringPatch.Diff(stored.Features, put.Features),
            Gloss = MultiStringPatch.Diff(stored.Gloss, put.Gloss),
        };
        return patch.IsEmpty ? null : patch;
    }

    [JsonIgnore]
    public bool IsEmpty =>
        !SurfaceText.HasValue &&
        !Confidence.HasValue &&
        !Producer.HasValue &&
        !SourceUser.HasValue &&
        !MorphemesStale.HasValue &&
        !Pos.HasValue &&
        !GlossSenseRef.HasValue &&
        !Morphemes.HasValue &&
        Features is null &&
        Gloss is null;

    public PatchField<string> SurfaceText { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }
    public PatchField<string?> Producer { get; init; }
    public PatchField<string?> SourceUser { get; init; }
    /// <summary>The whole parse; a morpheme list is not merged.</summary>
    public PatchField<List<MorphemeAnalysis>?> Morphemes { get; init; }
    public PatchField<bool?> MorphemesStale { get; init; }
    public PatchField<string?> Pos { get; init; }
    /// <summary>Merged per key, as a multistring is.</summary>
    public MultiStringPatch? Features { get; init; }
    public MultiStringPatch? Gloss { get; init; }
    public PatchField<SenseRef?> GlossSenseRef { get; init; }

    public override ValueTask ApplyChange(TokenAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (SurfaceText.HasValue) entity.SurfaceText = SurfaceText.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (Producer.HasValue) entity.Producer = Producer.Value;
        if (SourceUser.HasValue) entity.SourceUser = SourceUser.Value;
        if (Morphemes.HasValue) entity.Morphemes = Morphemes.Value;
        if (MorphemesStale.HasValue) entity.MorphemesStale = MorphemesStale.Value;
        if (Pos.HasValue) entity.Pos = Pos.Value;
        if (Features is not null) entity.Features = MultiString.Merge(entity.Features, Features);
        if (Gloss is not null) entity.Gloss = MultiString.Patch(entity.Gloss, Gloss);
        if (GlossSenseRef.HasValue) entity.GlossSenseRef = GlossSenseRef.Value;
        return ValueTask.CompletedTask;
    }
}
