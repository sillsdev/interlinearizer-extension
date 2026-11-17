using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Creates a <see cref="TokenAnalysis"/>, stamped with the commit's time. An analysis in a project
/// already deleted is created deleted.
/// </summary>
[method: JsonConstructor]
public class CreateTokenAnalysisChange(Guid entityId)
    : CreateChange<TokenAnalysis>(entityId), ISelfNamedType<CreateTokenAnalysisChange>
{
    /// <summary>
    /// Carries every field of <paramref name="analysis"/> but its timestamps, filed under
    /// <paramref name="projectId"/>.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// If <paramref name="projectId"/> is empty, or the analysis names another project.
    /// </exception>
    [SetsRequiredMembers]
    public CreateTokenAnalysisChange(TokenAnalysis analysis, Guid projectId) : this(analysis.Id)
    {
        ProjectId = ProjectReferences.ProjectOf(analysis, projectId);
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        Morphemes = analysis.Morphemes;
        MorphemesStale = analysis.MorphemesStale;
        Pos = analysis.Pos;
        Features = analysis.Features;
        Gloss = analysis.Gloss;
        GlossSenseRef = analysis.GlossSenseRef;
    }

    public required Guid ProjectId { get; init; }
    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public List<MorphemeAnalysis>? Morphemes { get; init; }
    public bool? MorphemesStale { get; init; }
    public string? Pos { get; init; }
    public Dictionary<string, string>? Features { get; init; }
    public MultiString? Gloss { get; init; }
    public SenseRef? GlossSenseRef { get; init; }

    public override async ValueTask<TokenAnalysis> NewEntity(Commit commit, IChangeContext context)
    {
        return new TokenAnalysis
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
            Morphemes = Morphemes,
            MorphemesStale = MorphemesStale,
            Pos = Pos,
            Features = MultiString.NullIfEmpty(Features),
            Gloss = MultiString.NullIfEmpty(Gloss),
            GlossSenseRef = GlossSenseRef,
        };
    }
}
