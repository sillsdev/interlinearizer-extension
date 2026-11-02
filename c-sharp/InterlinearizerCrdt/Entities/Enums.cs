using System.Text.Json.Serialization;

namespace Interlinearizer.Crdt.Entities;

/// <summary>How much to trust an analysis or assignment, independent of who produced it.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<Confidence>))]
public enum Confidence
{
    /// <summary>Human-created or human-confirmed.</summary>
    [JsonStringEnumMemberName("high")] High,
    /// <summary>Tool-assisted, reasonably confident.</summary>
    [JsonStringEnumMemberName("medium")] Medium,
    /// <summary>Tool-assisted, low certainty.</summary>
    [JsonStringEnumMemberName("low")] Low,
    /// <summary>Unreviewed machine suggestion.</summary>
    [JsonStringEnumMemberName("guess")] Guess,
}

/// <summary>Review status of an analysis assignment.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<AssignmentStatus>))]
public enum AssignmentStatus
{
    /// <summary>Human-confirmed.</summary>
    [JsonStringEnumMemberName("approved")] Approved,
    /// <summary>Machine-generated or unreviewed.</summary>
    [JsonStringEnumMemberName("suggested")] Suggested,
    /// <summary>Proposed but not yet reviewed.</summary>
    [JsonStringEnumMemberName("candidate")] Candidate,
    /// <summary>Explicitly rejected by a human.</summary>
    [JsonStringEnumMemberName("rejected")] Rejected,
    /// <summary>
    /// The underlying token text has changed since this record was created, so the record needs
    /// human review.
    /// </summary>
    [JsonStringEnumMemberName("stale")] Stale,
}
