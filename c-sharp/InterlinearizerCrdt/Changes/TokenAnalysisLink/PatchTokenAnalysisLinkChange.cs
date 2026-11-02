using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="TokenAnalysisLink"/>: a field left unset is left as
/// stored, and one set to null is cleared. Pointing the link at an analysis already deleted deletes
/// the link.
/// </summary>
public class PatchTokenAnalysisLinkChange(Guid entityId)
    : EditChange<TokenAnalysisLink>(entityId), ISelfNamedType<PatchTokenAnalysisLinkChange>
{
    /// <summary>
    /// The patch that takes <paramref name="stored"/> to <paramref name="put"/>, timestamps
    /// aside; null when nothing differs.
    /// </summary>
    public static PatchTokenAnalysisLinkChange? Diff(TokenAnalysisLink stored, TokenAnalysisLink put)
    {
        var patch = new PatchTokenAnalysisLinkChange(put.Id)
        {
            AnalysisId = Patches.Changed(stored.AnalysisId, put.AnalysisId) ? new(put.AnalysisId) : default,
            Token = Patches.Changed(stored.Token, put.Token) ? new(put.Token) : default,
            Status = Patches.Changed(stored.Status, put.Status) ? new(put.Status) : default,
            Confidence = Patches.Changed(stored.Confidence, put.Confidence) ? new(put.Confidence) : default,
        };
        return patch.IsEmpty ? null : patch;
    }

    [JsonIgnore]
    public bool IsEmpty =>
        !AnalysisId.HasValue &&
        !Token.HasValue &&
        !Status.HasValue &&
        !Confidence.HasValue;

    public PatchField<Guid> AnalysisId { get; init; }
    public PatchField<TokenSnapshot> Token { get; init; }
    public PatchField<AssignmentStatus> Status { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }

    public override async ValueTask ApplyChange(TokenAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (Token.HasValue) entity.Token = Token.Value;
        if (Status.HasValue) entity.Status = Status.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (AnalysisId.HasValue)
        {
            entity.AnalysisId = AnalysisId.Value;
            if (await context.IsObjectDeleted(AnalysisId.Value)) entity.DeletedAt = context.Commit.DateTime;
        }
    }
}
