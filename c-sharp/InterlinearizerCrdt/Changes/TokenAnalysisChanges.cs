using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>Creates a <see cref="TokenAnalysis"/>, stamped with the commit's time.</summary>
[method: JsonConstructor]
public class CreateTokenAnalysisChange(Guid entityId)
    : CreateChange<TokenAnalysis>(entityId), ISelfNamedType<CreateTokenAnalysisChange>
{
    /// <summary>Carries every field of <paramref name="analysis"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreateTokenAnalysisChange(TokenAnalysis analysis) : this(analysis.Id)
    {
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

    public override ValueTask<TokenAnalysis> NewEntity(Commit commit, IChangeContext context)
    {
        return ValueTask.FromResult(new TokenAnalysis
        {
            Id = EntityId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            SurfaceText = SurfaceText,
            Confidence = Confidence,
            Producer = Producer,
            SourceUser = SourceUser,
            Morphemes = Morphemes,
            MorphemesStale = MorphemesStale,
            Pos = Pos,
            Features = Features,
            Gloss = Gloss,
            GlossSenseRef = GlossSenseRef,
        });
    }
}

/// <summary>
/// Replaces every field of a <see cref="TokenAnalysis"/> but its identity and creation time.
/// </summary>
[method: JsonConstructor]
public class ReplaceTokenAnalysisChange(Guid entityId)
    : EditChange<TokenAnalysis>(entityId), ISelfNamedType<ReplaceTokenAnalysisChange>
{
    /// <summary>Carries every field of <paramref name="analysis"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public ReplaceTokenAnalysisChange(TokenAnalysis analysis) : this(analysis.Id)
    {
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

    public override ValueTask ApplyChange(TokenAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.SurfaceText = SurfaceText;
        entity.Confidence = Confidence;
        entity.Producer = Producer;
        entity.SourceUser = SourceUser;
        entity.Morphemes = Morphemes;
        entity.MorphemesStale = MorphemesStale;
        entity.Pos = Pos;
        entity.Features = Features;
        entity.Gloss = Gloss;
        entity.GlossSenseRef = GlossSenseRef;
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Creates a <see cref="TokenAnalysisLink"/>. A link to an analysis already deleted is created
/// deleted.
/// </summary>
[method: JsonConstructor]
public class CreateTokenAnalysisLinkChange(Guid entityId)
    : CreateChange<TokenAnalysisLink>(entityId), ISelfNamedType<CreateTokenAnalysisLinkChange>
{
    /// <summary>Carries every field of <paramref name="link"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public CreateTokenAnalysisLinkChange(TokenAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        Token = link.Token;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public required Guid AnalysisId { get; init; }
    public required TokenSnapshot Token { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask<TokenAnalysisLink> NewEntity(Commit commit, IChangeContext context)
    {
        return new TokenAnalysisLink
        {
            Id = EntityId,
            AnalysisId = AnalysisId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            Status = Status,
            Confidence = Confidence,
            Token = Token,
            DeletedAt = await context.IsObjectDeleted(AnalysisId) ? commit.DateTime : null,
        };
    }
}

/// <summary>
/// Replaces every field of a <see cref="TokenAnalysisLink"/> but its identity and creation time.
/// Pointing the link at an analysis already deleted deletes the link.
/// </summary>
[method: JsonConstructor]
public class ReplaceTokenAnalysisLinkChange(Guid entityId)
    : EditChange<TokenAnalysisLink>(entityId), ISelfNamedType<ReplaceTokenAnalysisLinkChange>
{
    /// <summary>Carries every field of <paramref name="link"/> but its timestamps.</summary>
    [SetsRequiredMembers]
    public ReplaceTokenAnalysisLinkChange(TokenAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        Token = link.Token;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public required Guid AnalysisId { get; init; }
    public required TokenSnapshot Token { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask ApplyChange(TokenAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.AnalysisId = AnalysisId;
        entity.Status = Status;
        entity.Confidence = Confidence;
        entity.Token = Token;
        if (await context.IsObjectDeleted(AnalysisId)) entity.DeletedAt = context.Commit.DateTime;
    }
}
