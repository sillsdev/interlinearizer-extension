using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;
using ZibStack.NET.Dto;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Sets the fields it carries on a <see cref="SegmentAnalysisLink"/>: a field left unset is left as
/// stored, and one set to null is cleared. Pointing the link at an analysis already deleted deletes
/// the link.
/// </summary>
[method: JsonConstructor]
public class PatchSegmentAnalysisLinkChange(Guid entityId)
    : EditChange<SegmentAnalysisLink>(entityId), ISelfNamedType<PatchSegmentAnalysisLinkChange>
{
    /// <summary>
    /// Sets every field of <paramref name="link"/> but its timestamps; a multistring it lacks is
    /// is left alone.
    /// </summary>
    [SetsRequiredMembers]
    public PatchSegmentAnalysisLinkChange(SegmentAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        SegmentId = link.SegmentId;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public PatchField<Guid> AnalysisId { get; init; }
    public PatchField<string> SegmentId { get; init; }
    public PatchField<AssignmentStatus> Status { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }

    public override async ValueTask ApplyChange(SegmentAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
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
