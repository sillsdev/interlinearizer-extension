using Interlinearizer.Crdt.Entities;

namespace Interlinearizer.Crdt;

/// <summary>Whole-record puts and deletes of one record kind.</summary>
/// <param name="Puts">Records as wanted whole; <see cref="PutMode"/> decides how a stored one is written.</param>
/// <param name="Deletes">Ids of records to remove; an id with nothing stored under it is skipped.</param>
public record RecordChanges<T>(IReadOnlyList<T> Puts, IReadOnlyList<Guid> Deletes)
{
    public static RecordChanges<T> Put(params T[] records) => new(records, []);
    public static RecordChanges<T> Delete(params Guid[] ids) => new([], ids);
}

/// <summary>
/// One command's changes, applied all-or-nothing. A record kind it leaves alone is absent, and an
/// id appears at most once in every kind's puts and deletes together, since Harmony keeps every
/// entity in one table.
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
    /// Write only what differs between the stored record and the put, key by key for a
    /// multistring or feature map, and nothing when the two agree. The put is still the whole
    /// record wanted: a field or key it lacks is cleared.
    /// </summary>
    Patch,
}

/// <summary>Every stored record, one list per kind, each in no set order.</summary>
public record TextAnalysis(
    List<SegmentAnalysis> SegmentAnalyses,
    List<SegmentAnalysisLink> SegmentAnalysisLinks,
    List<TokenAnalysis> TokenAnalyses,
    List<TokenAnalysisLink> TokenAnalysisLinks,
    List<PhraseAnalysis> PhraseAnalyses,
    List<PhraseAnalysisLink> PhraseAnalysisLinks);

/// <summary>Links of every kind, one list per kind, each in no set order.</summary>
public record AnalysisLinks(
    List<TokenAnalysisLink> TokenAnalysisLinks,
    List<PhraseAnalysisLink> PhraseAnalysisLinks,
    List<SegmentAnalysisLink> SegmentAnalysisLinks);

/// <summary>The links that attach to tokens, each list in no set order.</summary>
public record TokenLinks(List<TokenAnalysisLink> TokenAnalysisLinks, List<PhraseAnalysisLink> PhraseAnalysisLinks);
