using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;
using ZibStack.NET.Dto;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="SegmentAnalysis"/>: a field left unset is left as
/// stored, and one set to null is cleared.
/// </summary>
[method: JsonConstructor]
public class PatchSegmentAnalysisChange(Guid entityId)
    : EditChange<SegmentAnalysis>(entityId), ISelfNamedType<PatchSegmentAnalysisChange>
{
    /// <summary>
    /// Sets every field of <paramref name="analysis"/> but its timestamps; a multistring it lacks
    /// is left alone.
    /// </summary>
    [SetsRequiredMembers]
    public PatchSegmentAnalysisChange(SegmentAnalysis analysis) : this(analysis.Id)
    {
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        FreeTranslation = MultiStringPatch.Of(analysis.FreeTranslation);
        LiteralTranslation = MultiStringPatch.Of(analysis.LiteralTranslation);
    }

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
