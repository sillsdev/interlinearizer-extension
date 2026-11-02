using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>Creates a <see cref="PhraseAnalysis"/>, stamped with the commit's time.</summary>
public class CreatePhraseAnalysisChange(Guid entityId)
    : CreateChange<PhraseAnalysis>(entityId), ISelfNamedType<CreatePhraseAnalysisChange>
{
    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public MultiString? Gloss { get; init; }
    public SenseRef? SenseRef { get; init; }

    public override ValueTask<PhraseAnalysis> NewEntity(Commit commit, IChangeContext context)
    {
        return ValueTask.FromResult(new PhraseAnalysis
        {
            Id = EntityId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            SurfaceText = SurfaceText,
            Confidence = Confidence,
            Producer = Producer,
            SourceUser = SourceUser,
            Gloss = Gloss,
            SenseRef = SenseRef,
        });
    }
}

/// <summary>
/// Replaces every field of a <see cref="PhraseAnalysis"/> but its identity and creation time.
/// </summary>
public class ReplacePhraseAnalysisChange(Guid entityId)
    : EditChange<PhraseAnalysis>(entityId), ISelfNamedType<ReplacePhraseAnalysisChange>
{
    public required string SurfaceText { get; init; }
    public Confidence? Confidence { get; init; }
    public string? Producer { get; init; }
    public string? SourceUser { get; init; }
    public MultiString? Gloss { get; init; }
    public SenseRef? SenseRef { get; init; }

    public override ValueTask ApplyChange(PhraseAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.SurfaceText = SurfaceText;
        entity.Confidence = Confidence;
        entity.Producer = Producer;
        entity.SourceUser = SourceUser;
        entity.Gloss = Gloss;
        entity.SenseRef = SenseRef;
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Creates a <see cref="PhraseAnalysisLink"/>. A link to an analysis already deleted is created
/// deleted.
/// </summary>
public class CreatePhraseAnalysisLinkChange(Guid entityId)
    : CreateChange<PhraseAnalysisLink>(entityId), ISelfNamedType<CreatePhraseAnalysisLinkChange>
{
    public required Guid AnalysisId { get; init; }
    public required List<TokenSnapshot> Tokens { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask<PhraseAnalysisLink> NewEntity(Commit commit, IChangeContext context)
    {
        return new PhraseAnalysisLink
        {
            Id = EntityId,
            AnalysisId = AnalysisId,
            CreatedAt = commit.DateTime,
            UpdatedAt = commit.DateTime,
            Status = Status,
            Confidence = Confidence,
            Tokens = Tokens,
            DeletedAt = await context.IsObjectDeleted(AnalysisId) ? commit.DateTime : null,
        };
    }
}

/// <summary>
/// Replaces every field of a <see cref="PhraseAnalysisLink"/> but its identity and creation
/// time. Pointing the link at an analysis already deleted deletes the link.
/// </summary>
public class ReplacePhraseAnalysisLinkChange(Guid entityId)
    : EditChange<PhraseAnalysisLink>(entityId), ISelfNamedType<ReplacePhraseAnalysisLinkChange>
{
    public required Guid AnalysisId { get; init; }
    public required List<TokenSnapshot> Tokens { get; init; }
    public required AssignmentStatus Status { get; init; }
    public Confidence? Confidence { get; init; }

    public override async ValueTask ApplyChange(PhraseAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        entity.AnalysisId = AnalysisId;
        entity.Status = Status;
        entity.Confidence = Confidence;
        entity.Tokens = Tokens;
        if (await context.IsObjectDeleted(AnalysisId)) entity.DeletedAt = context.Commit.DateTime;
    }
}
