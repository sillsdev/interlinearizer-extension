using Interlinearizer.Crdt.Changes;
using Microsoft.EntityFrameworkCore;
using Interlinearizer.Crdt.Entities;
using SIL.Harmony;
using SIL.Harmony.Changes;

namespace Interlinearizer.Crdt;

/// <summary>
/// Reads and writes the analysis of one <see cref="InterlinearProject"/>, held as Harmony entities
/// in a database shared with the Paratext project's other interlinear projects. Lists of records
/// come back in no promised order, and a lookup by several keys returns each record once. Deleted
/// records, and those of other projects, are not stored for the purposes of these calls.
/// </summary>
public class AnalysisRepository(DataModel dataModel, ClientIdentity client, Guid projectId)
{
    /// <summary>The commit metadata key under which an apply records its change set's intent.</summary>
    public const string IntentMetadataKey = "intent";

    /// <summary>
    /// Applies <paramref name="changes"/> as one commit, so whole or not at all. A put of a record
    /// not stored creates it in this project. A put of one stored replaces it whole, or, when
    /// <paramref name="putMode"/> asks for a patch, writes only the fields that differ from the
    /// stored record and nothing when none does. The timestamps a put carries are ignored, because
    /// the commit stamps them. A delete of a record not stored, or stored in another project, is
    /// skipped. A change set that changes nothing writes no commit.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// If an id appears more than once in the changes, in one record kind or across kinds; if a
    /// put's id is stored as a record of another kind or in another project; or if a put names a
    /// project other than this one. Nothing is applied. Harmony keeps every entity in one table,
    /// so two records cannot share an id across kinds or projects.
    /// </exception>
    public async Task Apply(ChangeSet changes, PutMode putMode = PutMode.Replace)
    {
        var kinds = new IKindChanges[]
        {
            new KindChanges<SegmentAnalysis>("segment analysis", changes.SegmentAnalyses,
                a => new CreateSegmentAnalysisChange(a, projectId),
                a => new ReplaceSegmentAnalysisChange(a),
                PatchSegmentAnalysisChange.Diff,
                id => new DeleteChange<SegmentAnalysis>(id)),
            new KindChanges<TokenAnalysis>("token analysis", changes.TokenAnalyses,
                a => new CreateTokenAnalysisChange(a, projectId),
                a => new ReplaceTokenAnalysisChange(a),
                PatchTokenAnalysisChange.Diff,
                id => new DeleteChange<TokenAnalysis>(id)),
            new KindChanges<PhraseAnalysis>("phrase analysis", changes.PhraseAnalyses,
                a => new CreatePhraseAnalysisChange(a, projectId),
                a => new ReplacePhraseAnalysisChange(a),
                PatchPhraseAnalysisChange.Diff,
                id => new DeleteChange<PhraseAnalysis>(id)),
            new KindChanges<SegmentAnalysisLink>("segment analysis link", changes.SegmentAnalysisLinks,
                l => new CreateSegmentAnalysisLinkChange(l, projectId),
                l => new ReplaceSegmentAnalysisLinkChange(l),
                PatchSegmentAnalysisLinkChange.Diff,
                id => new DeleteChange<SegmentAnalysisLink>(id)),
            new KindChanges<TokenAnalysisLink>("token analysis link", changes.TokenAnalysisLinks,
                l => new CreateTokenAnalysisLinkChange(l, projectId),
                l => new ReplaceTokenAnalysisLinkChange(l),
                PatchTokenAnalysisLinkChange.Diff,
                id => new DeleteChange<TokenAnalysisLink>(id)),
            new KindChanges<PhraseAnalysisLink>("phrase analysis link", changes.PhraseAnalysisLinks,
                l => new CreatePhraseAnalysisLinkChange(l, projectId),
                l => new ReplacePhraseAnalysisLinkChange(l),
                PatchPhraseAnalysisLinkChange.Diff,
                id => new DeleteChange<PhraseAnalysisLink>(id)),
        };
        AssertIdsDistinct(kinds);

        var putIds = kinds.SelectMany(k => k.PutIds).ToList();
        var storedKinds = new Dictionary<Guid, string>();
        foreach (var kind in kinds) await kind.LoadStored(this, putIds, storedKinds);
        var harmonyChanges = new List<IChange>();
        foreach (var kind in kinds) kind.AddChanges(harmonyChanges, putMode, projectId, storedKinds);
        if (harmonyChanges.Count == 0) return;

        await dataModel.AddChanges(client.Id, harmonyChanges, new CommitMetadata { [IntentMetadataKey] = changes.Intent });
    }

    /// <summary>Every stored record.</summary>
    public async Task<TextAnalysis> ReadAll() => new(
        await Query<SegmentAnalysis>(q => q),
        await Query<SegmentAnalysisLink>(q => q),
        await Query<TokenAnalysis>(q => q),
        await Query<TokenAnalysisLink>(q => q),
        await Query<PhraseAnalysis>(q => q),
        await Query<PhraseAnalysisLink>(q => q));

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

    /// <summary>
    /// How many tokens approve each of <paramref name="analysisIds"/>. A token approves the
    /// analysis that its approved link names. Where a token has several approved links naming
    /// stored payloads, <see cref="PrefersLink"/> picks one. An id that no token approves is left
    /// out.
    /// </summary>
    public async Task<Dictionary<Guid, int>> CountApprovals(IReadOnlyCollection<Guid> analysisIds)
    {
        var wanted = analysisIds.ToHashSet();
        var ids = wanted.ToList();
        var tokenRefs = await Query<TokenAnalysisLink, string>(q => q
            .Where(l => l.Status == AssignmentStatus.Approved && ids.Contains(l.AnalysisId))
            .Select(l => l.TokenRef)
            .Distinct());
        if (tokenRefs.Count == 0) return [];
        // Every approved link on those tokens takes part in the tie-break, whichever payload it names.
        var approved = await Query<TokenAnalysisLink>(q => q
            .Where(l => l.Status == AssignmentStatus.Approved && tokenRefs.Contains(l.TokenRef)));
        var named = approved.Select(l => l.AnalysisId).Distinct().ToList();
        var stored = (await Query<TokenAnalysis, Guid>(q => q.Where(a => named.Contains(a.Id)).Select(a => a.Id))).ToHashSet();

        var counts = new Dictionary<Guid, int>();
        foreach (var token in approved.Where(l => stored.Contains(l.AnalysisId)).GroupBy(l => l.TokenRef))
        {
            var picked = token.Aggregate((best, link) => PrefersLink(link, best) ? link : best);
            if (wanted.Contains(picked.AnalysisId)) counts[picked.AnalysisId] = counts.GetValueOrDefault(picked.AnalysisId) + 1;
        }
        return counts;
    }

    /// <summary>
    /// Whether <paramref name="link"/> beats <paramref name="rival"/> where one link must be
    /// picked from several, as an approval tie picks: the later update, then the smaller id, as
    /// the TypeScript pick rules compare them.
    /// </summary>
    public static bool PrefersLink(AnalysisLink link, AnalysisLink rival)
    {
        if (link.UpdatedAt != rival.UpdatedAt) return link.UpdatedAt > rival.UpdatedAt;
        return string.CompareOrdinal(link.Id.ToString(), rival.Id.ToString()) < 0;
    }

    private static IQueryable<T> InBooks<T>(IQueryable<T> links, List<string> books, List<AssignmentStatus>? statuses)
        where T : AnalysisLink
    {
        var inBooks = links.Where(l => books.Contains(l.BookCode));
        return statuses is null ? inBooks : inBooks.Where(l => statuses.Contains(l.Status));
    }

    private Task<List<T>> ByIds<T>(IReadOnlyCollection<Guid> ids) where T : AnalysisRecord, IObjectBase
    {
        var wanted = ids.ToList();
        return Query<T>(q => q.Where(e => wanted.Contains(e.Id)));
    }

    /// <summary>Runs <paramref name="apply"/> over this project's stored records of one kind.</summary>
    private Task<List<T>> Query<T>(Func<IQueryable<T>, IQueryable<T>> apply) where T : AnalysisRecord, IObjectBase =>
        Query<T, T>(apply);

    private Task<List<TResult>> Query<T, TResult>(Func<IQueryable<T>, IQueryable<TResult>> apply) where T : AnalysisRecord, IObjectBase =>
        dataModel.QueryLatest<T, TResult>(q => apply(q.Where(r => r.ProjectId == projectId))).ToListAsync().AsTask();

    /// <summary>The stored records of one kind under <paramref name="ids"/>, whichever project holds them.</summary>
    private Task<List<T>> StoredInAnyProject<T>(IReadOnlyCollection<Guid> ids) where T : AnalysisRecord, IObjectBase =>
        dataModel.QueryLatest<T>(q => q.Where(e => ids.Contains(e.Id))).ToListAsync().AsTask();

    private static void AssertIdsDistinct(IEnumerable<IKindChanges> kinds)
    {
        var seen = new Dictionary<Guid, string>();
        foreach (var kind in kinds)
        {
            foreach (var id in kind.Ids)
            {
                if (seen.TryGetValue(id, out var first))
                {
                    throw new ArgumentException(first == kind.Name
                        ? $"The {kind.Name} {id} is named more than once in one change set"
                        : $"{id} is named as a {first} and as a {kind.Name} in one change set");
                }
                seen[id] = kind.Name;
            }
        }
    }

    /// <summary>One record kind's part of a change set, turned into Harmony changes.</summary>
    private interface IKindChanges
    {
        string Name { get; }

        /// <summary>Every id the changes name, put or deleted.</summary>
        IEnumerable<Guid> Ids { get; }

        IEnumerable<Guid> PutIds { get; }

        /// <summary>
        /// Loads the records of this kind stored under any of <paramref name="allPutIds"/>, whichever
        /// kind puts them and whichever project holds them, or deleted here, and files their ids
        /// under this kind in <paramref name="storedKinds"/>.
        /// </summary>
        Task LoadStored(AnalysisRepository repository, IReadOnlyCollection<Guid> allPutIds, Dictionary<Guid, string> storedKinds);

        /// <exception cref="ArgumentException">
        /// If a put's id is stored as another kind or in another project.
        /// </exception>
        void AddChanges(List<IChange> into, PutMode putMode, Guid projectId, IReadOnlyDictionary<Guid, string> storedKinds);
    }

    private sealed class KindChanges<T>(
        string name,
        RecordChanges<T>? changes,
        Func<T, IChange> create,
        Func<T, IChange> replace,
        Func<T, T, IChange?> diff,
        Func<Guid, IChange> delete) : IKindChanges where T : AnalysisRecord, IObjectBase
    {
        private Dictionary<Guid, T> _stored = [];

        public string Name => name;

        public IEnumerable<Guid> PutIds => changes?.Puts.Select(r => r.Id) ?? [];

        public IEnumerable<Guid> Ids => PutIds.Concat(changes?.Deletes ?? []);

        public async Task LoadStored(AnalysisRepository repository, IReadOnlyCollection<Guid> allPutIds, Dictionary<Guid, string> storedKinds)
        {
            var ids = allPutIds.Concat(changes?.Deletes ?? []).Distinct().ToList();
            if (ids.Count == 0) return;
            _stored = (await repository.StoredInAnyProject<T>(ids)).ToDictionary(e => e.Id);
            foreach (var id in _stored.Keys) storedKinds[id] = name;
        }

        public void AddChanges(List<IChange> into, PutMode putMode, Guid projectId, IReadOnlyDictionary<Guid, string> storedKinds)
        {
            if (changes is null) return;
            foreach (var put in changes.Puts)
            {
                if (storedKinds.TryGetValue(put.Id, out var storedAs) && storedAs != name)
                {
                    throw new ArgumentException($"The {name} {put.Id} is stored as a {storedAs}", nameof(changes));
                }
                if (!_stored.TryGetValue(put.Id, out var current)) into.Add(create(put));
                else if (current.ProjectId != projectId)
                {
                    throw new ArgumentException($"The {name} {put.Id} is stored in project {current.ProjectId}", nameof(changes));
                }
                else if (putMode == PutMode.Replace) into.Add(replace(put));
                else if (diff(current, put) is { } patch) into.Add(patch);
            }
            into.AddRange(changes.Deletes
                .Where(id => _stored.TryGetValue(id, out var stored) && stored.ProjectId == projectId)
                .Select(delete));
        }
    }
}
