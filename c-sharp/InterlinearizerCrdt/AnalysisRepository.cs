using Interlinearizer.Crdt.Changes;
using Microsoft.EntityFrameworkCore;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;

namespace Interlinearizer.Crdt;

/// <summary>
/// Reads and writes one project's analysis, held as Harmony entities. Lists of records come back
/// in no promised order, and a lookup by several keys returns each record once. Deleted records
/// are not stored for the purposes of these calls.
/// </summary>
public class AnalysisRepository(DataModel dataModel, ClientIdentity client)
{
    /// <summary>The commit metadata key under which an apply records its change set's intent.</summary>
    public const string IntentMetadataKey = "intent";

    /// <summary>
    /// Applies <paramref name="changes"/> as one commit, so whole or not at all. A put of a record
    /// not stored creates it. A put of one stored replaces it whole, or, when
    /// <paramref name="putMode"/> asks for a patch, writes only the fields that differ from the
    /// stored record and nothing when none does. The timestamps a put carries are ignored, since
    /// the commit stamps them. A delete of a record not stored is skipped. A change set that
    /// changes nothing writes no commit.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// If an id appears more than once in one record kind's changes; nothing is applied.
    /// </exception>
    public async Task Apply(ChangeSet changes, PutMode putMode = PutMode.Replace)
    {
        AssertIdsDistinct(changes.SegmentAnalyses, "segment analysis");
        AssertIdsDistinct(changes.SegmentAnalysisLinks, "segment analysis link");
        AssertIdsDistinct(changes.TokenAnalyses, "token analysis");
        AssertIdsDistinct(changes.TokenAnalysisLinks, "token analysis link");
        AssertIdsDistinct(changes.PhraseAnalyses, "phrase analysis");
        AssertIdsDistinct(changes.PhraseAnalysisLinks, "phrase analysis link");

        var harmonyChanges = new List<IChange>();
        await AddChanges(harmonyChanges, changes.SegmentAnalyses, putMode,
            a => new CreateSegmentAnalysisChange(a),
            a => new ReplaceSegmentAnalysisChange(a),
            PatchSegmentAnalysisChange.Diff,
            id => new DeleteChange<SegmentAnalysis>(id));
        await AddChanges(harmonyChanges, changes.TokenAnalyses, putMode,
            a => new CreateTokenAnalysisChange(a),
            a => new ReplaceTokenAnalysisChange(a),
            PatchTokenAnalysisChange.Diff,
            id => new DeleteChange<TokenAnalysis>(id));
        await AddChanges(harmonyChanges, changes.PhraseAnalyses, putMode,
            a => new CreatePhraseAnalysisChange(a),
            a => new ReplacePhraseAnalysisChange(a),
            PatchPhraseAnalysisChange.Diff,
            id => new DeleteChange<PhraseAnalysis>(id));
        await AddChanges(harmonyChanges, changes.SegmentAnalysisLinks, putMode,
            l => new CreateSegmentAnalysisLinkChange(l),
            l => new ReplaceSegmentAnalysisLinkChange(l),
            PatchSegmentAnalysisLinkChange.Diff,
            id => new DeleteChange<SegmentAnalysisLink>(id));
        await AddChanges(harmonyChanges, changes.TokenAnalysisLinks, putMode,
            l => new CreateTokenAnalysisLinkChange(l),
            l => new ReplaceTokenAnalysisLinkChange(l),
            PatchTokenAnalysisLinkChange.Diff,
            id => new DeleteChange<TokenAnalysisLink>(id));
        await AddChanges(harmonyChanges, changes.PhraseAnalysisLinks, putMode,
            l => new CreatePhraseAnalysisLinkChange(l),
            l => new ReplacePhraseAnalysisLinkChange(l),
            PatchPhraseAnalysisLinkChange.Diff,
            id => new DeleteChange<PhraseAnalysisLink>(id));
        if (harmonyChanges.Count == 0) return;

        await dataModel.AddChanges(client.Id, harmonyChanges, new CommitMetadata { [IntentMetadataKey] = changes.Intent });
    }

    /// <summary>The token analyses stored under <paramref name="ids"/>.</summary>
    public Task<List<TokenAnalysis>> GetTokenAnalyses(IReadOnlyCollection<Guid> ids) => ByIds<TokenAnalysis>(ids);

    /// <summary>The phrase analyses stored under <paramref name="ids"/>.</summary>
    public Task<List<PhraseAnalysis>> GetPhraseAnalyses(IReadOnlyCollection<Guid> ids) => ByIds<PhraseAnalysis>(ids);

    /// <summary>The segment analyses stored under <paramref name="ids"/>.</summary>
    public Task<List<SegmentAnalysis>> GetSegmentAnalyses(IReadOnlyCollection<Guid> ids) => ByIds<SegmentAnalysis>(ids);

    /// <summary>The phrase links stored under <paramref name="ids"/>.</summary>
    public Task<List<PhraseAnalysisLink>> GetPhraseAnalysisLinks(IReadOnlyCollection<Guid> ids) => ByIds<PhraseAnalysisLink>(ids);

    /// <summary>The token links on any of <paramref name="tokenRefs"/>, and the phrase links touching any of them.</summary>
    public async Task<TokenLinks> FindLinksByToken(IReadOnlyCollection<string> tokenRefs)
    {
        var refs = tokenRefs.ToHashSet();
        var books = refs.Select(Refs.BookOf).ToList();
        var tokenLinks = await Query<TokenAnalysisLink>(q => q.Where(l => refs.Contains(l.TokenRef)));
        // Only a run's first token is a column, so the run's book narrows the phrase links read.
        var phraseLinksInBooks = await Query<PhraseAnalysisLink>(q => q.Where(l => books.Contains(l.BookCode)));
        var phraseLinks = phraseLinksInBooks.Where(l => l.Tokens.Any(t => refs.Contains(t.TokenRef))).ToList();
        return new TokenLinks(tokenLinks, phraseLinks);
    }

    /// <summary>The segment links on any of <paramref name="segmentIds"/>.</summary>
    public Task<List<SegmentAnalysisLink>> FindLinksBySegment(IReadOnlyCollection<string> segmentIds)
    {
        var ids = segmentIds.ToList();
        return Query<SegmentAnalysisLink>(q => q.Where(l => ids.Contains(l.SegmentId)));
    }

    /// <summary>The links of every kind to any of <paramref name="analysisIds"/>.</summary>
    public async Task<AnalysisLinks> FindLinksToAnalyses(IReadOnlyCollection<Guid> analysisIds)
    {
        var ids = analysisIds.ToList();
        return new AnalysisLinks(
            await Query<TokenAnalysisLink>(q => q.Where(l => ids.Contains(l.AnalysisId))),
            await Query<PhraseAnalysisLink>(q => q.Where(l => ids.Contains(l.AnalysisId))),
            await Query<SegmentAnalysisLink>(q => q.Where(l => ids.Contains(l.AnalysisId))));
    }

    /// <summary>
    /// The links of every kind into any of <paramref name="bookCodes"/>, limited to
    /// <paramref name="statuses"/> when given.
    /// </summary>
    public async Task<AnalysisLinks> FindLinksInBooks(IReadOnlyCollection<string> bookCodes, IReadOnlyCollection<AssignmentStatus>? statuses = null)
    {
        var books = bookCodes.ToList();
        var wanted = statuses?.ToList();
        return new AnalysisLinks(
            await Query<TokenAnalysisLink>(q => InBooks(q, books, wanted)),
            await Query<PhraseAnalysisLink>(q => InBooks(q, books, wanted)),
            await Query<SegmentAnalysisLink>(q => InBooks(q, books, wanted)));
    }

    /// <summary>
    /// The codes of the books that links of every kind point into, each once and in no set order.
    /// A code need not be one of the canon's.
    /// </summary>
    public async Task<List<string>> FindLinkedBooks()
    {
        var books = new HashSet<string>();
        books.UnionWith(await Query<TokenAnalysisLink, string>(q => q.Select(l => l.BookCode).Distinct()));
        books.UnionWith(await Query<PhraseAnalysisLink, string>(q => q.Select(l => l.BookCode).Distinct()));
        books.UnionWith(await Query<SegmentAnalysisLink, string>(q => q.Select(l => l.BookCode).Distinct()));
        return books.ToList();
    }

    /// <summary>
    /// The token analyses whose surface text <see cref="Refs.NormalizeSurfaceForm"/> maps to one
    /// of <paramref name="normalizedForms"/>.
    /// </summary>
    public Task<List<TokenAnalysis>> FindTokenAnalysesByForm(IReadOnlyCollection<string> normalizedForms)
    {
        var forms = normalizedForms.ToList();
        return Query<TokenAnalysis>(q => q.Where(a => forms.Contains(a.NormalizedForm)));
    }

    /// <summary>
    /// The phrase analyses whose surface text <see cref="Refs.NormalizeSurfaceForm"/> maps to one
    /// of <paramref name="normalizedForms"/>.
    /// </summary>
    public Task<List<PhraseAnalysis>> FindPhraseAnalysesByForm(IReadOnlyCollection<string> normalizedForms)
    {
        var forms = normalizedForms.ToList();
        return Query<PhraseAnalysis>(q => q.Where(a => forms.Contains(a.NormalizedForm)));
    }

    private static IQueryable<T> InBooks<T>(IQueryable<T> links, List<string> books, List<AssignmentStatus>? statuses)
        where T : AnalysisLink
    {
        var inBooks = links.Where(l => books.Contains(l.BookCode));
        return statuses is null ? inBooks : inBooks.Where(l => statuses.Contains(l.Status));
    }

    private Task<List<T>> ByIds<T>(IReadOnlyCollection<Guid> ids) where T : class, IObjectBase
    {
        var wanted = ids.ToList();
        return Query<T>(q => q.Where(e => wanted.Contains(e.Id)));
    }

    private Task<List<T>> Query<T>(Func<IQueryable<T>, IQueryable<T>> apply) where T : class, IObjectBase =>
        Query<T, T>(apply);

    private Task<List<TResult>> Query<T, TResult>(Func<IQueryable<T>, IQueryable<TResult>> apply) where T : class, IObjectBase =>
        dataModel.QueryLatest(apply).ToListAsync().AsTask();

    private static void AssertIdsDistinct<T>(RecordChanges<T>? changes, string kind) where T : class, IObjectBase
    {
        if (changes is null) return;
        var seen = new HashSet<Guid>();
        foreach (var id in changes.Puts.Select(IdOf).Concat(changes.Deletes))
        {
            if (!seen.Add(id)) throw new ArgumentException($"The {kind} {id} is named more than once in one change set", nameof(changes));
        }
    }

    private async Task AddChanges<T>(
        List<IChange> into,
        RecordChanges<T>? changes,
        PutMode putMode,
        Func<T, IChange> create,
        Func<T, IChange> replace,
        Func<T, T, IChange?> diff,
        Func<Guid, IChange> delete) where T : class, IObjectBase
    {
        if (changes is null) return;
        var ids = changes.Puts.Select(r => r.Id).Concat(changes.Deletes).ToList();
        if (ids.Count == 0) return;
        var stored = (await Query<T>(q => q.Where(e => ids.Contains(e.Id)))).ToDictionary(e => e.Id);
        foreach (var put in changes.Puts)
        {
            if (!stored.TryGetValue(put.Id, out var current)) into.Add(create(put));
            else if (putMode == PutMode.Replace) into.Add(replace(put));
            else if (diff(current, put) is { } patch) into.Add(patch);
        }
        into.AddRange(changes.Deletes.Where(stored.ContainsKey).Select(delete));
    }

    private static Guid IdOf<T>(T record) where T : class => record switch
    {
        Analysis analysis => analysis.Id,
        AnalysisLink link => link.Id,
        _ => throw new ArgumentException($"{typeof(T).Name} is not an analysis record", nameof(record)),
    };
}
