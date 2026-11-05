using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Creates a <see cref="PhraseAnalysis"/>, stamped with the commit's time. An analysis in a project
/// already deleted is created deleted.
/// </summary>
[method: JsonConstructor]
public class CreatePhraseAnalysisChange(Guid entityId)
    : CreateChange<PhraseAnalysis>(entityId), ISelfNamedType<CreatePhraseAnalysisChange>
{
    /// <summary>
    /// Carries every field of <paramref name="analysis"/> but its timestamps, filed under
    /// <paramref name="projectId"/>.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// If <paramref name="projectId"/> is empty, or the analysis names another project.
    /// </exception>
    [SetsRequiredMembers]
    public CreatePhraseAnalysisChange(PhraseAnalysis analysis, Guid projectId) : this(analysis.Id)
    {
        ProjectId = ProjectReferences.ProjectOf(analysis, projectId);
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        Gloss = analysis.Gloss;
        SenseRef = analysis.SenseRef;
    }

    public required Guid ProjectId { get; init; }
    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public MultiString? Gloss { get; init; }
    public SenseRef? SenseRef { get; init; }

    public override async ValueTask<PhraseAnalysis> NewEntity(Commit commit, IChangeContext context)
    {
        return new PhraseAnalysis
        {
            Id = EntityId,
            ProjectId = ProjectId,
            DeletedAt = await context.IsObjectDeleted(ProjectId) ? commit.DateTime : null,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            SurfaceText = SurfaceText,
            Confidence = Confidence,
            Producer = Producer,
            SourceUser = SourceUser,
            Gloss = MultiString.NullIfEmpty(Gloss),
            SenseRef = SenseRef,
        };
    }
}
