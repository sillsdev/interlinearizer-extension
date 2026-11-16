using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Creates a <see cref="PhraseAnalysisLink"/>. A link to an analysis already deleted,
/// or in a project already deleted, is created deleted.
/// A timestamp the change does not carry is the commit's time.
/// </summary>
[method: JsonConstructor]
public class CreatePhraseAnalysisLinkChange(Guid entityId)
    : CreateChange<PhraseAnalysisLink>(entityId), ISelfNamedType<CreatePhraseAnalysisLinkChange>
{
    /// <summary>
    /// Carries every field of <paramref name="link"/>, filed under <paramref name="projectId"/>.
    /// A timestamp left at its default is not carried.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// If <paramref name="projectId"/> is empty, or the link names another project.
    /// </exception>
    [SetsRequiredMembers]
    public CreatePhraseAnalysisLinkChange(PhraseAnalysisLink link, Guid projectId) : this(link.Id)
    {
        ProjectId = ProjectReferences.ProjectOf(link, projectId);
        CreatedAt = Timestamps.Carried(link.CreatedAt);
        UpdatedAt = Timestamps.Carried(link.UpdatedAt);
        AnalysisId = link.AnalysisId;
        Tokens = link.Tokens;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public required Guid ProjectId { get; init; }
    public DateTimeOffset? CreatedAt { get; init; }
    public DateTimeOffset? UpdatedAt { get; init; }
    public required Guid AnalysisId { get; init; }
    public required List<TokenSnapshot> Tokens { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask<PhraseAnalysisLink> NewEntity(Commit commit, IChangeContext context)
    {
        return new PhraseAnalysisLink
        {
            Id = EntityId,
            ProjectId = ProjectId,
            AnalysisId = AnalysisId,
            CreatedAt = CreatedAt ?? commit.DateTime,
            UpdatedAt = UpdatedAt ?? commit.DateTime,
            Status = Status,
            Confidence = Confidence,
            Tokens = Tokens,
            DeletedAt = await context.IsObjectDeleted(AnalysisId) || await context.IsObjectDeleted(ProjectId)
                ? commit.DateTime
                : null,
        };
    }
}
