using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Reads and writes the timestamps a change carries. A writer that sets no timestamp leaves the
/// record's field at its default, and the change carries nothing for that field.
/// </summary>
internal static class Timestamps
{
    /// <summary><paramref name="stamp"/>, or null when the writer set none.</summary>
    public static DateTimeOffset? Carried(DateTimeOffset stamp) => stamp == default ? null : stamp;

    /// <summary><paramref name="put"/> when it is set and differs from <paramref name="stored"/>; otherwise null.</summary>
    public static DateTimeOffset? Changed(DateTimeOffset stored, DateTimeOffset put) =>
        put != default && put != stored ? put : null;

    /// <summary>
    /// Writes an edit's timestamps to <paramref name="entity"/>. A creation time that is not carried
    /// stays as stored. An update time that is not carried is the commit's time.
    /// </summary>
    public static void Write(AnalysisRecord entity, DateTimeOffset? createdAt, DateTimeOffset? updatedAt, IChangeContext context)
    {
        if (createdAt is { } created) entity.CreatedAt = created;
        entity.UpdatedAt = updatedAt ?? context.Commit.DateTime;
    }
}
