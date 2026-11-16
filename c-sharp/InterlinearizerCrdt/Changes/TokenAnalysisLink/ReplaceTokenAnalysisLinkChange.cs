using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Replaces every field of a <see cref="TokenAnalysisLink"/> but its identity.
/// Pointing the link at an analysis already deleted deletes the link.
/// A link already deleted stays deleted, even when pointed at a live analysis.
/// A creation time the change does not carry stays as stored. An update time it does not carry
/// is the commit's time.
/// </summary>
[method: JsonConstructor]
public class ReplaceTokenAnalysisLinkChange(Guid entityId)
    : EditChange<TokenAnalysisLink>(entityId), ISelfNamedType<ReplaceTokenAnalysisLinkChange>
{
    /// <summary>
    /// Carries every field of <paramref name="link"/>. A timestamp left at its default is not
    /// carried.
    /// </summary>
    [SetsRequiredMembers]
    public ReplaceTokenAnalysisLinkChange(TokenAnalysisLink link) : this(link.Id)
    {
        CreatedAt = Timestamps.Carried(link.CreatedAt);
        UpdatedAt = Timestamps.Carried(link.UpdatedAt);
        AnalysisId = link.AnalysisId;
        Token = link.Token;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public required Guid AnalysisId { get; init; }
    public required TokenSnapshot Token { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }

    public override async ValueTask ApplyChange(TokenAnalysisLink entity, IChangeContext context)
    {
        Timestamps.Write(entity, CreatedAt, UpdatedAt, context);
        entity.AnalysisId = AnalysisId;
        entity.Status = Status;
        entity.Confidence = Confidence;
        entity.Token = Token;
        if (await context.IsObjectDeleted(AnalysisId)) entity.DeletedAt = context.Commit.DateTime;
    }
}
