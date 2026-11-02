using System.Text.Json.Serialization;

namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// Fields shared by every analysis payload record. A payload is shared by every target analyzed
/// identically, so its timestamps date the record, not any one target's adoption of it.
/// </summary>
public abstract class Analysis
{
    private string _surfaceText = "";

    public Guid Id { get; init; }

    public DateTimeOffset? DeletedAt { get; set; }

    /// <summary>When this record was created.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>The most recent write to this record, whether or not it changed the content.</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Surface form of the analyzed text span.</summary>
    public required string SurfaceText
    {
        get => _surfaceText;
        set
        {
            _surfaceText = value;
            NormalizedForm = Refs.NormalizeSurfaceForm(value);
        }
    }

    /// <summary>
    /// <see cref="SurfaceText"/> as <see cref="Refs.NormalizeSurfaceForm"/> maps it, kept as a
    /// column so that the analyses of one spelling can be looked up.
    /// </summary>
    [JsonIgnore]
    public string NormalizedForm { get; private set; } = "";

    public Confidence? Confidence { get; set; }

    /// <summary>Free-form tag for what produced this analysis, such as a tool name or "human".</summary>
    public string? Producer { get; set; }

    /// <summary>User identifier for human-created or human-edited analyses.</summary>
    public string? SourceUser { get; set; }

    /// <summary>Analysis payloads reference nothing, so a deletion elsewhere never reaches them.</summary>
    public Guid[] GetReferences() => [];

    public void RemoveReference(Guid id, CommitBase commit)
    {
    }
}

/// <summary>
/// Fields shared by every link from an analysis payload to a text-layer target. A link's
/// timestamps track this target's annotation, as distinct from the payload's own history.
/// </summary>
public abstract class AnalysisLink
{
    public Guid Id { get; init; }

    public DateTimeOffset? DeletedAt { get; set; }

    /// <summary>The linked analysis payload record.</summary>
    public required Guid AnalysisId { get; set; }

    /// <summary>When this target was first given an analysis, whichever payload that was.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>The most recent write aimed at this target.</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    public AssignmentStatus Status { get; set; }

    public Confidence? Confidence { get; set; }

    /// <summary>
    /// The book this link points into, derived from its target and kept as a column so that a
    /// book's links can be looked up.
    /// </summary>
    [JsonIgnore]
    public string BookCode { get; protected set; } = "";

    public Guid[] GetReferences() => [AnalysisId];

    /// <summary>A link cannot outlive its payload: deleting the analysis deletes the link.</summary>
    public void RemoveReference(Guid id, CommitBase commit)
    {
        if (AnalysisId == id) DeletedAt = commit.DateTime;
    }
}
