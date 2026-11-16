using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Replaces every field of a <see cref="PhraseAnalysisLink"/> but its identity.
/// Pointing the link at an analysis already deleted deletes the link.
/// A link already deleted stays deleted, even when pointed at a live analysis.
/// A creation time the change does not carry stays as stored. An update time it does not carry
/// is the commit's time.
/// </summary>
[method: JsonConstructor]
public class ReplacePhraseAnalysisLinkChange(Guid entityId)
    : EditChange<PhraseAnalysisLink>(entityId), ISelfNamedType<ReplacePhraseAnalysisLinkChange>
{
    /// <summary>
    /// Carries every field of <paramref name="link"/>. A timestamp left at its default is not
    /// carried.
    /// </summary>
    [SetsRequiredMembers]
    public ReplacePhraseAnalysisLinkChange(PhraseAnalysisLink link) : this(link.Id)
    {
        CreatedAt = Timestamps.Carried(link.CreatedAt);
        UpdatedAt = Timestamps.Carried(link.UpdatedAt);
        AnalysisId = link.AnalysisId;
        Tokens = link.Tokens;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public required Guid AnalysisId { get; init; }
    public required List<TokenSnapshot> Tokens { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }

    public override async ValueTask ApplyChange(PhraseAnalysisLink entity, IChangeContext context)
    {
        Timestamps.Write(entity, CreatedAt, UpdatedAt, context);
        entity.AnalysisId = AnalysisId;
        entity.Status = Status;
        entity.Confidence = Confidence;
        entity.Tokens = Tokens;
        if (await context.IsObjectDeleted(AnalysisId)) entity.DeletedAt = context.Commit.DateTime;
    }
}
