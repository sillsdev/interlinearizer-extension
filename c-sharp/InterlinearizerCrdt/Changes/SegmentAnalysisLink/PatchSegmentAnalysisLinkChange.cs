using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="SegmentAnalysisLink"/>: a field left unset is left as
/// stored, and one set to null is cleared. Pointing the link at an analysis already deleted deletes
/// the link.
/// A link already deleted stays deleted, even when pointed at a live analysis.
/// An update time the patch does not carry is the commit's time.
/// </summary>
public class PatchSegmentAnalysisLinkChange(Guid entityId)
    : EditChange<SegmentAnalysisLink>(entityId), ISelfNamedType<PatchSegmentAnalysisLinkChange>
{
    /// <summary>
    /// The patch that takes <paramref name="stored"/> to <paramref name="put"/>, or null when
    /// nothing differs. The patch carries the put's update time even when it matches the stored one.
    /// </summary>
    public static PatchSegmentAnalysisLinkChange? Diff(SegmentAnalysisLink stored, SegmentAnalysisLink put)
    {
        var patch = new PatchSegmentAnalysisLinkChange(put.Id)
        {
            CreatedAt = Timestamps.Changed(stored.CreatedAt, put.CreatedAt),
            UpdatedAt = Timestamps.Carried(put.UpdatedAt),
            AnalysisId = Patches.Changed(stored.AnalysisId, put.AnalysisId) ? new(put.AnalysisId) : default,
            SegmentId = Patches.Changed(stored.SegmentId, put.SegmentId) ? new(put.SegmentId) : default,
            Status = Patches.Changed(stored.Status, put.Status) ? new(put.Status) : default,
            Confidence = Patches.Changed(stored.Confidence, put.Confidence) ? new(put.Confidence) : default,
        };
        return patch.IsEmpty && Timestamps.Changed(stored.UpdatedAt, put.UpdatedAt) is null ? null : patch;
    }

    /// <summary>Whether the patch sets nothing but the update time.</summary>
    [JsonIgnore]
    public bool IsEmpty =>
        CreatedAt is null &&
        !AnalysisId.HasValue &&
        !SegmentId.HasValue &&
        !Status.HasValue &&
        !Confidence.HasValue;

    public PatchField<Guid> AnalysisId { get; init; }
    public PatchField<string> SegmentId { get; init; }
    public PatchField<AssignmentStatus> Status { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }

    public override async ValueTask ApplyChange(SegmentAnalysisLink entity, IChangeContext context)
    {
        Timestamps.Write(entity, CreatedAt, UpdatedAt, context);
        if (SegmentId.HasValue) entity.SegmentId = SegmentId.Value;
        if (Status.HasValue) entity.Status = Status.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (AnalysisId.HasValue)
        {
            entity.AnalysisId = AnalysisId.Value;
            if (await context.IsObjectDeleted(AnalysisId.Value)) entity.DeletedAt = context.Commit.DateTime;
        }
    }
}
