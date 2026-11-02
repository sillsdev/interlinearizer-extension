using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;
using ZibStack.NET.Dto;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="TokenAnalysisLink"/>: a field left unset is left as
/// stored, and one set to null is cleared. Pointing the link at an analysis already deleted deletes
/// the link.
/// </summary>
[method: JsonConstructor]
public class PatchTokenAnalysisLinkChange(Guid entityId)
    : EditChange<TokenAnalysisLink>(entityId), ISelfNamedType<PatchTokenAnalysisLinkChange>
{
    /// <summary>
    /// Sets every field of <paramref name="link"/> but its timestamps; a multistring it lacks is
    /// is left alone.
    /// </summary>
    [SetsRequiredMembers]
    public PatchTokenAnalysisLinkChange(TokenAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        Token = link.Token;
        Status = link.Status;
        Confidence = link.Confidence;
    }

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
