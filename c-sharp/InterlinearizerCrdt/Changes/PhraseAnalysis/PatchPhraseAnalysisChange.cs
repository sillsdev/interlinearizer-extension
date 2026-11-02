using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;
using ZibStack.NET.Dto;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="PhraseAnalysis"/>: a field left unset is left as
/// stored, and one set to null is cleared.
/// </summary>
[method: JsonConstructor]
public class PatchPhraseAnalysisChange(Guid entityId)
    : EditChange<PhraseAnalysis>(entityId), ISelfNamedType<PatchPhraseAnalysisChange>
{
    /// <summary>
    /// Sets every field of <paramref name="analysis"/> but its timestamps; a multistring it lacks
    /// is left alone.
    /// </summary>
    [SetsRequiredMembers]
    public PatchPhraseAnalysisChange(PhraseAnalysis analysis) : this(analysis.Id)
    {
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        SenseRef = analysis.SenseRef;
        Gloss = MultiStringPatch.Of(analysis.Gloss);
    }

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
