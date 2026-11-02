using Interlinearizer.Crdt.Entities;

namespace Interlinearizer.Crdt;

/// <summary>Whole-record puts and deletes of one record kind.</summary>
/// <param name="Puts">Records to store whole, each replacing any stored under its id.</param>
/// <param name="Deletes">Ids of records to remove; an id with nothing stored under it is skipped.</param>
public record RecordChanges<T>(IReadOnlyList<T> Puts, IReadOnlyList<Guid> Deletes)
{
    public static RecordChanges<T> Put(params T[] records) => new(records, []);
    public static RecordChanges<T> Delete(params Guid[] ids) => new([], ids);
}

/// <summary>
/// One command's changes, applied all-or-nothing. A record kind it leaves alone is absent, and an
/// id appears at most once in a kind's puts and deletes together.
/// </summary>
public record ChangeSet
{
    /// <summary>Names the command that made the changes.</summary>
    public required string Intent { get; init; }

    public RecordChanges<SegmentAnalysis>? SegmentAnalyses { get; init; }
    public RecordChanges<SegmentAnalysisLink>? SegmentAnalysisLinks { get; init; }
    public RecordChanges<TokenAnalysis>? TokenAnalyses { get; init; }
    public RecordChanges<TokenAnalysisLink>? TokenAnalysisLinks { get; init; }
    public RecordChanges<PhraseAnalysis>? PhraseAnalyses { get; init; }
    public RecordChanges<PhraseAnalysisLink>? PhraseAnalysisLinks { get; init; }
}

/// <summary>How an apply writes a put whose record is already stored.</summary>
public enum PutMode
{
    /// <summary>Replace the stored record whole, dropping any field the put lacks.</summary>
    Replace,
    /// <summary>
    /// Set every field the put carries, merging a multistring or feature map per key. A field or
    /// key the put lacks is left as stored.
    /// </summary>
    Patch,
}

/// <summary>Links of every kind, one list per kind, each in no set order.</summary>
public record AnalysisLinks(
    List<TokenAnalysisLink> TokenAnalysisLinks,
    List<PhraseAnalysisLink> PhraseAnalysisLinks,
    List<SegmentAnalysisLink> SegmentAnalysisLinks);

/// <summary>The links that attach to tokens, each list in no set order.</summary>
public record TokenLinks(List<TokenAnalysisLink> TokenAnalysisLinks, List<PhraseAnalysisLink> PhraseAnalysisLinks);
