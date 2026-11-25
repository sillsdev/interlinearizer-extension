using System.Text.Json.Serialization;
using Interlinearizer.Crdt.Entities;

namespace Interlinearizer.Crdt;

/// <summary>A record as a command read it and as its edit leaves it, under one id.</summary>
public record RecordUpdate<T>(T Before, T After);

/// <summary>
/// Creates, updates and deletes of one record kind. An update writes only the fields that differ
/// between its before and its after, key by key for a multistring or feature map, so a field that
/// another commit changed since the read stands.
/// </summary>
/// <param name="Creates">Records to store under ids that no stored record has.</param>
/// <param name="Updates">Edits to stored records; an edit of a record not stored is skipped.</param>
/// <param name="Deletes">
/// Records to remove, as read, of which only the id arrives. A record not stored is skipped.
/// </param>
public record RecordChanges<T>(IReadOnlyList<T> Creates, IReadOnlyList<RecordUpdate<T>> Updates, IReadOnlyList<DeletedRecord> Deletes)
{
    public static RecordChanges<T> Create(params T[] records) => new(records, [], []);
    public static RecordChanges<T> Update(params RecordUpdate<T>[] updates) => new([], updates, []);
    public static RecordChanges<T> Delete(params Guid[] ids) => new([], [], ids.Select(id => new DeletedRecord(id)).ToList());
}

/// <summary>The id of a record that a change set deletes; the rest of the record is ignored.</summary>
public record DeletedRecord(Guid Id);

/// <summary>
/// One command's changes, applied all-or-nothing. A record kind it leaves alone is absent, and an
/// id appears at most once in every kind's creates, updates and deletes together, since Harmony
/// keeps every entity in one table.
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

/// <summary>What an apply left of one record kind.</summary>
/// <param name="Puts">Each record created or changed, as stored.</param>
/// <param name="Deletes">The id of each record deleted.</param>
public record AppliedRecords<T>(IReadOnlyList<T> Puts, IReadOnlyList<Guid> Deletes)
{
    /// <summary>
    /// The links among <see cref="Deletes"/> that a deleted analysis took with it, as stored before
    /// the apply; null when there are none.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<T>? Taken { get; init; }
}

/// <summary>
/// What an apply changed, by record kind. A kind it left alone is absent, and left off the wire, as
/// the TypeScript seam expects.
/// </summary>
public record AppliedChangeSet
{
    /// <summary>The intent of the changes applied.</summary>
    public required string Intent { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AppliedRecords<SegmentAnalysis>? SegmentAnalyses { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AppliedRecords<SegmentAnalysisLink>? SegmentAnalysisLinks { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AppliedRecords<TokenAnalysis>? TokenAnalyses { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AppliedRecords<TokenAnalysisLink>? TokenAnalysisLinks { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AppliedRecords<PhraseAnalysis>? PhraseAnalyses { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AppliedRecords<PhraseAnalysisLink>? PhraseAnalysisLinks { get; init; }
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
