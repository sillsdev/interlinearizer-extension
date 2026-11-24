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
public class AnalysisRepository(DataModel dataModel, InterlinearizerCrdtDbContext db, ClientIdentity client, Guid projectId)
{
    /// <summary>The commit metadata key under which an apply records its change set's intent.</summary>
    public const string IntentMetadataKey = "intent";

    /// <summary>
    /// Applies <paramref name="changes"/> as one commit, so whole or not at all. A create stores its
    /// record in this project. An update writes only the fields that differ between its before and
    /// its after, key by key for a multistring or feature map, so a field that another commit
    /// changed since the read stands. An update writes nothing when none differs, and skips a
    /// record not stored. The timestamps a record carries are ignored, because the commit stamps them. A delete
    /// of a record not stored, or stored in another project, is skipped. A change set that changes
    /// nothing writes no commit.
    /// </summary>
    /// <returns>
    /// What the commit changed, under the change set's intent: each record that it left stored, as
    /// stored, and the id of each record that it deleted. The deleted ids include the links that a
    /// deleted analysis took with it. A skipped update or delete, and an update that wrote nothing,
    /// are left out. So is a delete that a later-dated create undid.
    /// </returns>
    /// <exception cref="ArgumentException">
    /// If an id appears more than once in the changes, in one record kind or across kinds; if an
    /// update's before and after name different ids; if a create's id is stored, or is or was stored
    /// as a record of another kind or in another project; if an update's id is stored as another
    /// kind or in another project; if a create or update names a project other than this one; if a
    /// create places a link, or an update moves a stored one, onto an analysis stored in another
    /// project, or onto one that will not be stored once the changes apply; or if an update leaves a
    /// stored link on an analysis that the changes delete.
    /// Nothing is applied. Harmony keeps every entity in one table, so two records cannot share an
    /// id across kinds or projects, and a create under a deleted record's id brings that record back.
    /// </exception>
    public async Task<AppliedChangeSet> Apply(ChangeSet changes)
    {
        var segmentAnalyses = new KindChanges<SegmentAnalysis>("segment analysis", changes.SegmentAnalyses,
            a => new CreateSegmentAnalysisChange(a, projectId),
            PatchSegmentAnalysisChange.Diff,
            id => new DeleteChange<SegmentAnalysis>(id));
        var tokenAnalyses = new KindChanges<TokenAnalysis>("token analysis", changes.TokenAnalyses,
            a => new CreateTokenAnalysisChange(a, projectId),
            PatchTokenAnalysisChange.Diff,
            id => new DeleteChange<TokenAnalysis>(id));
        var phraseAnalyses = new KindChanges<PhraseAnalysis>("phrase analysis", changes.PhraseAnalyses,
            a => new CreatePhraseAnalysisChange(a, projectId),
            PatchPhraseAnalysisChange.Diff,
            id => new DeleteChange<PhraseAnalysis>(id));
        var segmentLinks = new KindChanges<SegmentAnalysisLink>("segment analysis link", changes.SegmentAnalysisLinks,
            l => new CreateSegmentAnalysisLinkChange(l, projectId),
            PatchSegmentAnalysisLinkChange.Diff,
            id => new DeleteChange<SegmentAnalysisLink>(id));
        var tokenLinks = new KindChanges<TokenAnalysisLink>("token analysis link", changes.TokenAnalysisLinks,
            l => new CreateTokenAnalysisLinkChange(l, projectId),
            PatchTokenAnalysisLinkChange.Diff,
            id => new DeleteChange<TokenAnalysisLink>(id));
        var phraseLinks = new KindChanges<PhraseAnalysisLink>("phrase analysis link", changes.PhraseAnalysisLinks,
            l => new CreatePhraseAnalysisLinkChange(l, projectId),
            PatchPhraseAnalysisLinkChange.Diff,
            id => new DeleteChange<PhraseAnalysisLink>(id));
        var kinds = new IKindChanges[] { segmentAnalyses, tokenAnalyses, phraseAnalyses, segmentLinks, tokenLinks, phraseLinks };
        AssertIdsDistinct(kinds);

        var writtenIds = kinds.SelectMany(k => k.CreateIds.Concat(k.UpdateIds)).ToList();
        var storedKinds = new Dictionary<Guid, string>();
        foreach (var kind in kinds) await kind.LoadStored(this, writtenIds, storedKinds);
        await AssertUnstoredIdsReusable(kinds, kinds.SelectMany(k => k.CreateIds).Where(id => !storedKinds.ContainsKey(id)).ToList());
        await AssertLinkedAnalysesStored(kinds);
        var harmonyChanges = new List<IChange>();
        foreach (var kind in kinds) kind.AddChanges(harmonyChanges, projectId, storedKinds);
        if (harmonyChanges.Count == 0) return new AppliedChangeSet { Intent = changes.Intent };

        // A commit dated before others deletes the links that were on an analysis at its date. A
        // later commit may have moved such a link off since. No snapshot need show it on the analysis.
        var deletesAnalyses = new IKindChanges[] { segmentAnalyses, tokenAnalyses, phraseAnalyses }.Any(k => k.AppliedDeleteIds.Any());
        var segmentLinksBefore = deletesAnalyses ? await StoredIds<SegmentAnalysisLink>() : [];
        var tokenLinksBefore = deletesAnalyses ? await StoredIds<TokenAnalysisLink>() : [];
        var phraseLinksBefore = deletesAnalyses ? await StoredIds<PhraseAnalysisLink>() : [];

        await dataModel.AddChanges(client.Id, harmonyChanges, new CommitMetadata { [IntentMetadataKey] = changes.Intent });
        // Read afresh, not from the commit's snapshots. Harmony keeps no snapshot under a commit
        // dated before others, and the stored records hold the changes of later commits.
        return new AppliedChangeSet
        {
            Intent = changes.Intent,
            SegmentAnalyses = await segmentAnalyses.Applied(this, []),
            SegmentAnalysisLinks = await segmentLinks.Applied(this, await Taken<SegmentAnalysisLink>(segmentLinksBefore, segmentLinks.AppliedDeleteIds)),
            TokenAnalyses = await tokenAnalyses.Applied(this, []),
            TokenAnalysisLinks = await tokenLinks.Applied(this, await Taken<TokenAnalysisLink>(tokenLinksBefore, tokenLinks.AppliedDeleteIds)),
            PhraseAnalyses = await phraseAnalyses.Applied(this, []),
            PhraseAnalysisLinks = await phraseLinks.Applied(this, await Taken<PhraseAnalysisLink>(phraseLinksBefore, phraseLinks.AppliedDeleteIds)),
        };
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
        var tokenRefs = await Query<TokenAnalysisLink, string>(q => q
            .Where(l => l.Status == AssignmentStatus.Approved && wanted.Contains(l.AnalysisId))
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
    /// The approvals filed under each of <paramref name="normalizedForms"/>, by approving token
    /// ref, leaving out a form with none. A token approves the analysis that its approved link
    /// names. Where a token has several approved links naming stored payloads,
    /// <see cref="PrefersLink"/> picks one. The approval is filed under that link's
    /// <see cref="TokenAnalysisLink.NormalizedForm"/>.
    /// </summary>
    public async Task<Dictionary<string, Dictionary<string, Guid>>> FindApprovalsByForm(IReadOnlyCollection<string> normalizedForms)
    {
        var wanted = normalizedForms.ToHashSet();
        var tokenRefs = await Query<TokenAnalysisLink, string>(q => q
            .Where(l => l.Status == AssignmentStatus.Approved && wanted.Contains(l.NormalizedForm))
            .Select(l => l.TokenRef)
            .Distinct());
        if (tokenRefs.Count == 0) return [];
        // Every approved link on those tokens takes part in the tie-break, whichever form it reads.
        var approved = await Query<TokenAnalysisLink>(q => q
            .Where(l => l.Status == AssignmentStatus.Approved && tokenRefs.Contains(l.TokenRef)));
        var named = approved.Select(l => l.AnalysisId).Distinct().ToList();
        var stored = (await Query<TokenAnalysis, Guid>(q => q.Where(a => named.Contains(a.Id)).Select(a => a.Id))).ToHashSet();

        var byForm = new Dictionary<string, Dictionary<string, Guid>>();
        foreach (var token in approved.Where(l => stored.Contains(l.AnalysisId)).GroupBy(l => l.TokenRef))
        {
            var picked = token.Aggregate((best, link) => PrefersLink(link, best) ? link : best);
            if (!wanted.Contains(picked.NormalizedForm)) continue;
            if (!byForm.TryGetValue(picked.NormalizedForm, out var byToken)) byForm[picked.NormalizedForm] = byToken = [];
            byToken[token.Key] = picked.AnalysisId;
        }
        return byForm;
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

    private Task<List<Guid>> StoredIds<T>() where T : AnalysisLink, IObjectBase => Query<T, Guid>(q => q.Select(l => l.Id));

    /// <summary>The links of <paramref name="before"/>, other than those in <paramref name="deleted"/>, that are no longer stored.</summary>
    private async Task<List<Guid>> Taken<T>(List<Guid> before, IEnumerable<Guid> deleted) where T : AnalysisLink, IObjectBase
    {
        if (before.Count == 0) return before;
        var still = (await StoredIds<T>()).ToHashSet();
        still.UnionWith(deleted);
        return before.Where(id => !still.Contains(id)).ToList();
    }

    /// <summary>
    /// Refuses a create under an id that an interlinear project holds, or that a deleted record of
    /// another kind or project held. Harmony would bring a deleted record back as the create's kind
    /// and project, history and all.
    /// </summary>
    private async Task AssertUnstoredIdsReusable(IKindChanges[] kinds, List<Guid> unstoredCreateIds)
    {
        if (unstoredCreateIds.Count == 0) return;
        var everStored = await db.Snapshots.Where(s => unstoredCreateIds.Contains(s.EntityId)).Select(s => s.EntityId).Distinct().ToListAsync();
        foreach (var id in everStored)
        {
            var previous = (await dataModel.GetLatestSnapshotByObjectId(id)).Entity;
            var kind = kinds.First(k => k.CreateIds.Contains(id));
            var previousAs = kinds.FirstOrDefault(k => k.IsKindOf(previous))?.Name
                ?? (previous is InterlinearProject ? "interlinear project" : previous.GetType().Name);
            if (previousAs != kind.Name) throw new ArgumentException($"The {kind.Name} {id} has been stored as kind {previousAs}", "changes");
            if (previous is AnalysisRecord record && record.ProjectId != projectId)
            {
                throw new ArgumentException($"The {kind.Name} {id} has been stored in project {record.ProjectId}", "changes");
            }
        }
    }

    /// <summary>
    /// Refuses a link naming another project's analysis, which this project's reads could not
    /// resolve and whose deletion would delete the link. Also refuses a link naming an analysis
    /// that the changes neither create nor leave stored; Harmony would create that link already
    /// deleted. Also refuses an update that keeps a link on an analysis that the changes delete;
    /// Harmony would delete that link with its analysis.
    /// </summary>
    private async Task AssertLinkedAnalysesStored(IKindChanges[] kinds)
    {
        var deletes = kinds.SelectMany(k => k.StoredDeleteIds(projectId)).ToHashSet();
        foreach (var kept in kinds.SelectMany(k => k.KeptLinks))
        {
            if (deletes.Contains(kept.AnalysisId))
            {
                throw new ArgumentException($"An update keeps the link {kept.Id} on analysis {kept.AnalysisId}, which the changes delete", nameof(kinds));
            }
        }
        var links = kinds.SelectMany(k => k.WrittenLinks).ToList();
        if (links.Count == 0) return;
        var createdAnalyses = kinds.SelectMany(k => k.CreatedAnalysisIds).ToHashSet();
        var analysisIds = links.Select(l => l.AnalysisId).Distinct().ToList();
        var projects = new Dictionary<Guid, Guid>();
        foreach (var analysis in (await StoredInAnyProject<TokenAnalysis>(analysisIds)).Cast<Analysis>()
                     .Concat(await StoredInAnyProject<PhraseAnalysis>(analysisIds))
                     .Concat(await StoredInAnyProject<SegmentAnalysis>(analysisIds)))
        {
            projects[analysis.Id] = analysis.ProjectId;
        }
        foreach (var link in links)
        {
            if (projects.TryGetValue(link.AnalysisId, out var analysisProject) && analysisProject != projectId)
            {
                throw new ArgumentException($"The link {link.Id} names analysis {link.AnalysisId}, stored in project {analysisProject}", nameof(kinds));
            }
            if (!createdAnalyses.Contains(link.AnalysisId) && (!projects.ContainsKey(link.AnalysisId) || deletes.Contains(link.AnalysisId)))
            {
                throw new ArgumentException($"The link {link.Id} names analysis {link.AnalysisId}, which will not be stored", nameof(kinds));
            }
        }
    }

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

        /// <summary>Every id the changes name, created, updated or deleted.</summary>
        IEnumerable<Guid> Ids { get; }

        IEnumerable<Guid> CreateIds { get; }

        IEnumerable<Guid> UpdateIds { get; }

        IEnumerable<Guid> DeleteIds { get; }

        /// <summary>
        /// The ids that the changes delete under this kind, of records stored in <paramref name="projectId"/>.
        /// Empty until <see cref="LoadStored"/> has run.
        /// </summary>
        IEnumerable<Guid> StoredDeleteIds(Guid projectId);

        /// <summary>The ids of the stored records that the changes delete. Empty until <see cref="AddChanges"/> has run.</summary>
        IEnumerable<Guid> AppliedDeleteIds { get; }

        /// <summary>
        /// The links of this kind that the changes create, and the stored ones that an update moves
        /// to another analysis, as the update leaves them. An update that keeps its analysis writes
        /// no analysis, so the stored one stands. Holds no update until <see cref="LoadStored"/> has
        /// run.
        /// </summary>
        IEnumerable<AnalysisLink> WrittenLinks { get; }

        /// <summary>
        /// The stored links of this kind that an update leaves on their analysis, as stored. Empty
        /// until <see cref="LoadStored"/> has run.
        /// </summary>
        IEnumerable<AnalysisLink> KeptLinks { get; }

        /// <summary>The ids of the analyses of this kind that the changes create.</summary>
        IEnumerable<Guid> CreatedAnalysisIds { get; }

        bool IsKindOf(IObjectBase entity);

        /// <summary>
        /// Loads the records of this kind stored under any of <paramref name="allWrittenIds"/>,
        /// whichever kind creates or updates them and whichever project holds them, or deleted
        /// here, and files their ids under this kind in <paramref name="storedKinds"/>.
        /// </summary>
        Task LoadStored(AnalysisRepository repository, IReadOnlyCollection<Guid> allWrittenIds, Dictionary<Guid, string> storedKinds);

        /// <exception cref="ArgumentException">
        /// If a create or update names another project, a create's id is stored, or an update's id
        /// is stored as another kind or in another project.
        /// </exception>
        void AddChanges(List<IChange> into, Guid projectId, IReadOnlyDictionary<Guid, string> storedKinds);
    }

    private sealed class KindChanges<T>(
        string name,
        RecordChanges<T>? changes,
        Func<T, IChange> create,
        Func<T, T, IChange?> diff,
        Func<Guid, IChange> delete) : IKindChanges where T : AnalysisRecord, IObjectBase
    {
        private Dictionary<Guid, T> _stored = [];
        private readonly List<Guid> _putIds = [];
        private readonly List<Guid> _deleteIds = [];

        public string Name => name;

        public IEnumerable<Guid> CreateIds => changes?.Creates.Select(r => r.Id) ?? [];

        public IEnumerable<Guid> UpdateIds => changes?.Updates.Select(u => u.After.Id) ?? [];

        public IEnumerable<Guid> DeleteIds => changes?.Deletes.Select(r => r.Id) ?? [];

        public IEnumerable<Guid> Ids => CreateIds.Concat(UpdateIds).Concat(DeleteIds);

        public IEnumerable<Guid> AppliedDeleteIds => _deleteIds;

        public IEnumerable<Guid> StoredDeleteIds(Guid projectId) =>
            DeleteIds.Where(id => _stored.TryGetValue(id, out var stored) && stored.ProjectId == projectId);

        public IEnumerable<AnalysisLink> WrittenLinks =>
            changes?.Creates.OfType<AnalysisLink>().Concat(changes.Updates
                .Where(u => u is { Before: AnalysisLink before, After: AnalysisLink after } && before.AnalysisId != after.AnalysisId
                    && _stored.ContainsKey(u.After.Id))
                .Select(u => u.After).OfType<AnalysisLink>()) ?? [];

        public IEnumerable<AnalysisLink> KeptLinks =>
            changes?.Updates
                .Where(u => u is { Before: AnalysisLink before, After: AnalysisLink after } && before.AnalysisId == after.AnalysisId)
                .Select(u => _stored.GetValueOrDefault(u.After.Id))
                .OfType<AnalysisLink>() ?? [];

        public IEnumerable<Guid> CreatedAnalysisIds => changes?.Creates.OfType<Analysis>().Select(a => a.Id) ?? [];

        public bool IsKindOf(IObjectBase entity) => entity is T;

        public async Task LoadStored(AnalysisRepository repository, IReadOnlyCollection<Guid> allWrittenIds, Dictionary<Guid, string> storedKinds)
        {
            var ids = allWrittenIds.Concat(DeleteIds).Distinct().ToList();
            if (ids.Count == 0) return;
            _stored = (await repository.StoredInAnyProject<T>(ids)).ToDictionary(e => e.Id);
            foreach (var id in _stored.Keys) storedKinds[id] = name;
        }

        public void AddChanges(List<IChange> into, Guid projectId, IReadOnlyDictionary<Guid, string> storedKinds)
        {
            if (changes is null) return;
            foreach (var record in changes.Creates)
            {
                AssertInProject(record, projectId);
                if (storedKinds.TryGetValue(record.Id, out var storedAs))
                {
                    throw new ArgumentException(storedAs == name
                        ? $"The {name} {record.Id} is stored"
                        : $"The {name} {record.Id} is stored as a {storedAs}", nameof(changes));
                }
                into.Add(create(record));
                _putIds.Add(record.Id);
            }
            foreach (var (before, after) in changes.Updates)
            {
                if (before.Id != after.Id)
                {
                    throw new ArgumentException($"An update of the {name} {after.Id} reads as record {before.Id}", nameof(changes));
                }
                AssertInProject(after, projectId);
                if (storedKinds.TryGetValue(after.Id, out var storedAs) && storedAs != name)
                {
                    throw new ArgumentException($"The {name} {after.Id} is stored as a {storedAs}", nameof(changes));
                }
                if (!_stored.TryGetValue(after.Id, out var current)) continue;
                if (current.ProjectId != projectId)
                {
                    throw new ArgumentException($"The {name} {after.Id} is stored in project {current.ProjectId}", nameof(changes));
                }
                if (diff(before, after) is not { } patch) continue;
                into.Add(patch);
                _putIds.Add(after.Id);
            }
            _deleteIds.AddRange(StoredDeleteIds(projectId));
            into.AddRange(_deleteIds.Select(delete));
        }

        /// <summary>
        /// What the commit of <see cref="AddChanges"/>'s changes left of this kind, or null when
        /// it changed none. The ids in <paramref name="taken"/> are reported deleted too. Each put
        /// is read as stored.
        /// </summary>
        public async Task<AppliedRecords<T>?> Applied(AnalysisRepository repository, IEnumerable<Guid> taken)
        {
            // A later-dated create may have brought back a record that this commit deleted.
            var revived = _deleteIds.Count == 0 ? [] : (await repository.StoredInAnyProject<T>(_deleteIds)).Select(r => r.Id).ToHashSet();
            var deletes = _deleteIds.Where(id => !revived.Contains(id)).Concat(taken).ToList();
            if (_putIds.Count == 0 && deletes.Count == 0) return null;
            var puts = _putIds.Count == 0 ? [] : await repository.StoredInAnyProject<T>(_putIds);
            return new AppliedRecords<T>(puts, deletes);
        }

        private void AssertInProject(T record, Guid projectId)
        {
            if (record.ProjectId != Guid.Empty && record.ProjectId != projectId)
            {
                throw new ArgumentException($"The {name} {record.Id} names project {record.ProjectId}, not {projectId}", nameof(changes));
            }
        }
    }
}
