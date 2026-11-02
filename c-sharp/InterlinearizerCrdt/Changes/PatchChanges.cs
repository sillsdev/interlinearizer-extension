using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;
using ZibStack.NET.Dto;

namespace Interlinearizer.Crdt.Changes;

/*
 * A patch change sets only the fields it carries: a PatchField left unset leaves the stored
 * field as it is, and one set to null clears it. PatchFieldJson keeps unset fields out of the
 * stored JSON. A MultiStringPatch needs no PatchField: it merges per key, see MultiString.Patch,
 * so a null patch is one that names no key and changes nothing. Every patch is a write aimed at
 * the record, so it stamps UpdatedAt.
 */

/// <summary>Sets the fields it carries on a <see cref="SegmentAnalysis"/>.</summary>
[method: JsonConstructor]
public class PatchSegmentAnalysisChange(Guid entityId)
    : EditChange<SegmentAnalysis>(entityId), ISelfNamedType<PatchSegmentAnalysisChange>
{
    /// <summary>Sets every field of <paramref name="analysis"/> but its timestamps; a multistring it lacks is left alone.</summary>
    [SetsRequiredMembers]
    public PatchSegmentAnalysisChange(SegmentAnalysis analysis) : this(analysis.Id)
    {
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        FreeTranslation = MultiStringPatch.Of(analysis.FreeTranslation);
        LiteralTranslation = MultiStringPatch.Of(analysis.LiteralTranslation);
    }

    public PatchField<string> SurfaceText { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }
    public PatchField<string?> Producer { get; init; }
    public PatchField<string?> SourceUser { get; init; }
    public MultiStringPatch? FreeTranslation { get; init; }
    public MultiStringPatch? LiteralTranslation { get; init; }

    public override ValueTask ApplyChange(SegmentAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (SurfaceText.HasValue) entity.SurfaceText = SurfaceText.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (Producer.HasValue) entity.Producer = Producer.Value;
        if (SourceUser.HasValue) entity.SourceUser = SourceUser.Value;
        if (FreeTranslation is not null) entity.FreeTranslation = MultiString.Patch(entity.FreeTranslation, FreeTranslation);
        if (LiteralTranslation is not null) entity.LiteralTranslation = MultiString.Patch(entity.LiteralTranslation, LiteralTranslation);
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Sets the fields it carries on a <see cref="SegmentAnalysisLink"/>. Pointing the link at an
/// analysis already deleted deletes the link.
/// </summary>
[method: JsonConstructor]
public class PatchSegmentAnalysisLinkChange(Guid entityId)
    : EditChange<SegmentAnalysisLink>(entityId), ISelfNamedType<PatchSegmentAnalysisLinkChange>
{
    /// <summary>Sets every field of <paramref name="link"/> but its timestamps; a multistring it lacks is left alone.</summary>
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

/// <summary>Sets the fields it carries on a <see cref="TokenAnalysis"/>.</summary>
[method: JsonConstructor]
public class PatchTokenAnalysisChange(Guid entityId)
    : EditChange<TokenAnalysis>(entityId), ISelfNamedType<PatchTokenAnalysisChange>
{
    /// <summary>Sets every field of <paramref name="analysis"/> but its timestamps; a multistring it lacks is left alone.</summary>
    [SetsRequiredMembers]
    public PatchTokenAnalysisChange(TokenAnalysis analysis) : this(analysis.Id)
    {
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        Morphemes = analysis.Morphemes;
        MorphemesStale = analysis.MorphemesStale;
        Pos = analysis.Pos;
        GlossSenseRef = analysis.GlossSenseRef;
        Features = MultiStringPatch.Of(analysis.Features);
        Gloss = MultiStringPatch.Of(analysis.Gloss);
    }

    public PatchField<string> SurfaceText { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }
    public PatchField<string?> Producer { get; init; }
    public PatchField<string?> SourceUser { get; init; }
    /// <summary>The whole parse; a morpheme list is not merged.</summary>
    public PatchField<List<MorphemeAnalysis>?> Morphemes { get; init; }
    public PatchField<bool?> MorphemesStale { get; init; }
    public PatchField<string?> Pos { get; init; }
    /// <summary>Merged per key, as a multistring is.</summary>
    public MultiStringPatch? Features { get; init; }
    public MultiStringPatch? Gloss { get; init; }
    public PatchField<SenseRef?> GlossSenseRef { get; init; }

    public override ValueTask ApplyChange(TokenAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (SurfaceText.HasValue) entity.SurfaceText = SurfaceText.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (Producer.HasValue) entity.Producer = Producer.Value;
        if (SourceUser.HasValue) entity.SourceUser = SourceUser.Value;
        if (Morphemes.HasValue) entity.Morphemes = Morphemes.Value;
        if (MorphemesStale.HasValue) entity.MorphemesStale = MorphemesStale.Value;
        if (Pos.HasValue) entity.Pos = Pos.Value;
        if (Features is not null) entity.Features = MultiString.Merge(entity.Features, Features);
        if (Gloss is not null) entity.Gloss = MultiString.Patch(entity.Gloss, Gloss);
        if (GlossSenseRef.HasValue) entity.GlossSenseRef = GlossSenseRef.Value;
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Sets the fields it carries on a <see cref="TokenAnalysisLink"/>. Pointing the link at an
/// analysis already deleted deletes the link.
/// </summary>
[method: JsonConstructor]
public class PatchTokenAnalysisLinkChange(Guid entityId)
    : EditChange<TokenAnalysisLink>(entityId), ISelfNamedType<PatchTokenAnalysisLinkChange>
{
    /// <summary>Sets every field of <paramref name="link"/> but its timestamps; a multistring it lacks is left alone.</summary>
    [SetsRequiredMembers]
    public PatchTokenAnalysisLinkChange(TokenAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        Token = link.Token;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public PatchField<Guid> AnalysisId { get; init; }
    public PatchField<TokenSnapshot> Token { get; init; }
    public PatchField<AssignmentStatus> Status { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }

    public override async ValueTask ApplyChange(TokenAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (Token.HasValue) entity.Token = Token.Value;
        if (Status.HasValue) entity.Status = Status.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (AnalysisId.HasValue)
        {
            entity.AnalysisId = AnalysisId.Value;
            if (await context.IsObjectDeleted(AnalysisId.Value)) entity.DeletedAt = context.Commit.DateTime;
        }
    }
}

/// <summary>Sets the fields it carries on a <see cref="PhraseAnalysis"/>.</summary>
[method: JsonConstructor]
public class PatchPhraseAnalysisChange(Guid entityId)
    : EditChange<PhraseAnalysis>(entityId), ISelfNamedType<PatchPhraseAnalysisChange>
{
    /// <summary>Sets every field of <paramref name="analysis"/> but its timestamps; a multistring it lacks is left alone.</summary>
    [SetsRequiredMembers]
    public PatchPhraseAnalysisChange(PhraseAnalysis analysis) : this(analysis.Id)
    {
        SurfaceText = analysis.SurfaceText;
        Confidence = analysis.Confidence;
        Producer = analysis.Producer;
        SourceUser = analysis.SourceUser;
        SenseRef = analysis.SenseRef;
        Gloss = MultiStringPatch.Of(analysis.Gloss);
    }

    public PatchField<string> SurfaceText { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }
    public PatchField<string?> Producer { get; init; }
    public PatchField<string?> SourceUser { get; init; }
    public MultiStringPatch? Gloss { get; init; }
    public PatchField<SenseRef?> SenseRef { get; init; }

    public override ValueTask ApplyChange(PhraseAnalysis entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (SurfaceText.HasValue) entity.SurfaceText = SurfaceText.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (Producer.HasValue) entity.Producer = Producer.Value;
        if (SourceUser.HasValue) entity.SourceUser = SourceUser.Value;
        if (Gloss is not null) entity.Gloss = MultiString.Patch(entity.Gloss, Gloss);
        if (SenseRef.HasValue) entity.SenseRef = SenseRef.Value;
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Sets the fields it carries on a <see cref="PhraseAnalysisLink"/>. Pointing the link at an
/// analysis already deleted deletes the link.
/// </summary>
[method: JsonConstructor]
public class PatchPhraseAnalysisLinkChange(Guid entityId)
    : EditChange<PhraseAnalysisLink>(entityId), ISelfNamedType<PatchPhraseAnalysisLinkChange>
{
    /// <summary>Sets every field of <paramref name="link"/> but its timestamps; a multistring it lacks is left alone.</summary>
    [SetsRequiredMembers]
    public PatchPhraseAnalysisLinkChange(PhraseAnalysisLink link) : this(link.Id)
    {
        AnalysisId = link.AnalysisId;
        Tokens = link.Tokens;
        Status = link.Status;
        Confidence = link.Confidence;
    }

    public PatchField<Guid> AnalysisId { get; init; }
    /// <summary>The whole run; a token list is not merged.</summary>
    public PatchField<List<TokenSnapshot>> Tokens { get; init; }
    public PatchField<AssignmentStatus> Status { get; init; }
    public PatchField<Confidence?> Confidence { get; init; }

    public override async ValueTask ApplyChange(PhraseAnalysisLink entity, IChangeContext context)
    {
        entity.UpdatedAt = context.Commit.DateTime;
        if (Tokens.HasValue) entity.Tokens = Tokens.Value;
        if (Status.HasValue) entity.Status = Status.Value;
        if (Confidence.HasValue) entity.Confidence = Confidence.Value;
        if (AnalysisId.HasValue)
        {
            entity.AnalysisId = AnalysisId.Value;
            if (await context.IsObjectDeleted(AnalysisId.Value)) entity.DeletedAt = context.Commit.DateTime;
        }
    }
}
