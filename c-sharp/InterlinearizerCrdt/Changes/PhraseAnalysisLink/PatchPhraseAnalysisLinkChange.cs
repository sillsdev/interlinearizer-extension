using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="PhraseAnalysisLink"/>: a field left unset is left as
/// stored, and one set to null is cleared. Pointing the link at an analysis already deleted deletes
/// the link.
/// A link already deleted stays deleted, even when pointed at a live analysis.
/// </summary>
public class PatchPhraseAnalysisLinkChange(Guid entityId)
    : EditChange<PhraseAnalysisLink>(entityId), ISelfNamedType<PatchPhraseAnalysisLinkChange>
{
    /// <summary>
    /// The patch that takes <paramref name="before"/> to <paramref name="after"/>, timestamps
    /// aside; null when nothing differs.
    /// </summary>
    public static PatchPhraseAnalysisLinkChange? Diff(PhraseAnalysisLink before, PhraseAnalysisLink after)
    {
        var patch = new PatchPhraseAnalysisLinkChange(after.Id)
        {
            AnalysisId = Patches.Changed(before.AnalysisId, after.AnalysisId) ? new(after.AnalysisId) : default,
            Status = Patches.Changed(before.Status, after.Status) ? new(after.Status) : default,
            Confidence = Patches.Changed(before.Confidence, after.Confidence) ? new(after.Confidence) : default,
            Tokens = Patches.ListChanged(before.Tokens, after.Tokens) ? new(after.Tokens) : default,
        };
        return patch.IsEmpty ? null : patch;
    }

    [JsonIgnore]
    public bool IsEmpty =>
        !AnalysisId.HasValue &&
        !Status.HasValue &&
        !Confidence.HasValue &&
        !Tokens.HasValue;

    public PatchField<Guid> AnalysisId { get; init; }
    /// <summary>The whole run; a token list is not merged.</summary>
    public PatchField<List<TokenSnapshot>> Tokens { get; init; }
    public PatchField<AssignmentStatus> Status { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }

    public override async ValueTask ApplyChange(PhraseAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (Tokens.HasValue) entity.Tokens = Tokens.Value;
        if (Status.HasValue) entity.Status = Status.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (AnalysisId.HasValue)
        {
            entity.AnalysisId = AnalysisId.Value;
            if (await context.IsObjectDeleted(AnalysisId.Value)) entity.DeletedAt = context.Commit.DateTime;
        }
    }
}
