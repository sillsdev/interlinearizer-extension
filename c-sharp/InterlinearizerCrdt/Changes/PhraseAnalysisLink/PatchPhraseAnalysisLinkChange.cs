using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;
using ZibStack.NET.Dto;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="PhraseAnalysisLink"/>: a field left unset is left as
/// stored, and one set to null is cleared. Pointing the link at an analysis already deleted deletes
/// the link.
/// </summary>
[method: JsonConstructor]
public class PatchPhraseAnalysisLinkChange(Guid entityId)
    : EditChange<PhraseAnalysisLink>(entityId), ISelfNamedType<PatchPhraseAnalysisLinkChange>
{
    /// <summary>
    /// Sets every field of <paramref name="link"/> but its timestamps; a multistring it lacks is
    /// is left alone.
    /// </summary>
    [SetsRequiredMembers]
    public PatchPhraseAnalysisLinkChange(PhraseAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        Tokens = link.Tokens;
        Status = link.Status;
        Confidence = link.Confidence;
    }

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
