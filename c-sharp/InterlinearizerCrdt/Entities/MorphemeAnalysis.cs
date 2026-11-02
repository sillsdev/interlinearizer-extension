namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// One morpheme within a token's parse. Owned by its <see cref="TokenAnalysis"/>, so it is stored
/// inside that record rather than as an entity of its own.
/// </summary>
public record MorphemeAnalysis
{
    /// <summary>Unique within the owning token analysis's morphemes.</summary>
    public required Guid Id { get; init; }

    /// <summary>The morpheme form as it appears in this analysis.</summary>
    public required string Form { get; init; }

    /// <summary>Writing system of <see cref="Form"/>.</summary>
    public required string WritingSystem { get; init; }

    /// <summary>Absent until the morpheme is linked to a lexicon entry.</summary>
    public EntryRef? EntryRef { get; init; }

    /// <summary>Meaningful only alongside <see cref="EntryRef"/>.</summary>
    public SenseRef? SenseRef { get; init; }

    public AllomorphRef? AllomorphRef { get; init; }

    public GrammarRef? GrammarRef { get; init; }

    /// <summary>Takes precedence over any gloss resolved through <see cref="SenseRef"/>.</summary>
    public MultiString? Gloss { get; init; }

    /// <summary>Two morphemes are equal by content, the gloss included.</summary>
    public virtual bool Equals(MorphemeAnalysis? other) =>
        other is not null &&
        Id == other.Id &&
        Form == other.Form &&
        WritingSystem == other.WritingSystem &&
        EntryRef == other.EntryRef &&
        SenseRef == other.SenseRef &&
        AllomorphRef == other.AllomorphRef &&
        GrammarRef == other.GrammarRef &&
        MultiString.ContentEquals(Gloss, other.Gloss);

    public override int GetHashCode() => HashCode.Combine(Id, Form, WritingSystem, EntryRef, SenseRef, AllomorphRef, GrammarRef);
}
