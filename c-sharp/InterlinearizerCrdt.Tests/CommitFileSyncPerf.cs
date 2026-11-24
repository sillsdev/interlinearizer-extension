using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using SIL.Harmony.Config;

namespace Interlinearizer.Crdt.Tests;

/// <summary>
/// Times <see cref="CommitFileSync"/> over a perf dataset tier's analysis, in databases on disk.
/// Run it after <c>npm run perf:datasets</c> with
/// <c>dotnet test c-sharp/InterlinearizerCrdt.Tests -c Release --treenode-filter "/*/*/CommitFileSyncPerf/*" --output detailed</c>.
/// <c>PERF_TIERS</c> names the tiers, <c>large-loadable</c> by default. <c>PERF_RUNS</c> sets how
/// often to time an edit, <see cref="DefaultRuns"/> by default.
/// </summary>
[Explicit]
public class CommitFileSyncPerf
{
    private const int DefaultRuns = 5;

    private static readonly JsonSerializerOptions WireJson = new(JsonSerializerDefaults.Web);

    /// <summary>Changes per commit in each history measured, from the few of one edit to the whole analysis.</summary>
    private static readonly int[] HistoryShapes = [2, int.MaxValue];

    [Test]
    public async Task TimeExportAndImport()
    {
        var tiers = Environment.GetEnvironmentVariable("PERF_TIERS")?.Split(',') ?? ["large-loadable"];
        var runs = int.TryParse(Environment.GetEnvironmentVariable("PERF_RUNS"), out var parsed) ? parsed : DefaultRuns;
        foreach (var tier in tiers)
        {
            var analysis = await LoadAnalysis(tier);
            Console.WriteLine($"Tier {tier}: {Count(analysis)} records");
            Console.WriteLine("| Changes per commit | Commits | Build (s) | Export (s) | Files | Bytes (MB) | Largest file (MB) | Import into an empty database (s) | Export of one edit (ms) | Import of one edit (ms) | Import of nothing new (ms) |");
            Console.WriteLine("|---|---|---|---|---|---|---|---|---|---|---|");
            foreach (var changesPerCommit in HistoryShapes) Console.WriteLine(await Measure(analysis, changesPerCommit, runs));
        }
    }

    private static async Task<string> Measure(TextAnalysis analysis, int changesPerCommit, int runs)
    {
        var folder = Directory.CreateTempSubdirectory("commit-file-sync-perf-");
        try
        {
            var files = new DirectoryCommitFiles(Path.Combine(folder.FullName, "files"));
            await using var ana = await PerfClient.Open(Path.Combine(folder.FullName, "ana.sqlite"));
            await using var ben = await PerfClient.Open(Path.Combine(folder.FullName, "ben.sqlite"));
            await using var cal = await PerfClient.Open(Path.Combine(folder.FullName, "cal.sqlite"));

            // A writer whose only commit is older than all of Ana's, like one who stopped writing long ago.
            await cal.WriteOne();
            await cal.Sync(files).Export();

            var build = Stopwatch.StartNew();
            await ana.Seed(analysis, changesPerCommit);
            build.Stop();
            var commits = await ana.Db.Commits.CountAsync();

            var export = Stopwatch.StartNew();
            await ana.Sync(files).Export();
            export.Stop();
            var chunks = Directory.EnumerateFiles(Path.Combine(folder.FullName, "files"), "*", SearchOption.AllDirectories)
                .Select(path => new FileInfo(path).Length)
                .ToList();

            var import = Stopwatch.StartNew();
            await ben.Sync(files).Import();
            import.Stop();

            var editExports = new List<double>();
            var editImports = new List<double>();
            var emptyImports = new List<double>();
            var analysisId = analysis.TokenAnalyses[0].Id;
            for (var run = 0; run < runs; run++)
            {
                await ana.Repository.Apply(new ChangeSet
                {
                    Intent = "perf",
                    TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Put(new TokenAnalysisLink
                    {
                        Id = Guid.NewGuid(),
                        AnalysisId = analysisId,
                        Token = new TokenSnapshot($"GEN 1:1:{run}", "word"),
                        Status = AssignmentStatus.Approved,
                    }),
                });
                editExports.Add(await Time(() => ana.Sync(files).Export()));
                editImports.Add(await Time(() => ben.Sync(files).Import()));
                emptyImports.Add(await Time(() => ben.Sync(files).Import()));
            }

            return $"| {(changesPerCommit == int.MaxValue ? "all" : changesPerCommit)} | {commits} | {Seconds(build)} | {Seconds(export)} | {chunks.Count} | {Megabytes(chunks.Sum())} | {Megabytes(chunks.Max())} | {Seconds(import)} | {Median(editExports)} | {Median(editImports)} | {Median(emptyImports)} |";
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            folder.Delete(recursive: true);
        }
    }

    private static async Task<double> Time(Func<Task> work)
    {
        var watch = Stopwatch.StartNew();
        await work();
        return watch.Elapsed.TotalMilliseconds;
    }

    private static string Seconds(Stopwatch watch) => watch.Elapsed.TotalSeconds.ToString("F1");

    private static string Megabytes(long bytes) => (bytes / 1_000_000.0).ToString("F1");

    private static string Median(List<double> values)
    {
        var sorted = values.Order().ToList();
        var middle = sorted.Count / 2;
        return (sorted.Count % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).ToString("F0");
    }

    private static int Count(TextAnalysis a) => a.SegmentAnalyses.Count + a.SegmentAnalysisLinks.Count + a.TokenAnalyses.Count
        + a.TokenAnalysisLinks.Count + a.PhraseAnalyses.Count + a.PhraseAnalysisLinks.Count;

    private static async Task<TextAnalysis> LoadAnalysis(string tier)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "package.json"))) directory = directory.Parent;
        var path = Path.Combine(directory?.FullName ?? throw new InvalidOperationException("No repository root above the test assembly"),
            "perf", ".cache", "datasets", tier, "draft.json");
        if (!File.Exists(path)) throw new FileNotFoundException($"No {tier} dataset; run npm run perf:datasets first", path);
        await using var stream = File.OpenRead(path);
        using var draft = await JsonDocument.ParseAsync(stream);
        return draft.RootElement.GetProperty("analysis").Deserialize<TextAnalysis>(WireJson)
            ?? throw new InvalidDataException($"The {tier} draft holds no analysis");
    }

    private sealed class PerfClient : IAsyncDisposable
    {
        private static readonly Guid ProjectId = Guid.NewGuid();

        private readonly ServiceProvider _services;
        private readonly AsyncServiceScope _scope;
        private readonly ClientIdentity _client = new(Guid.NewGuid());

        private PerfClient(string dbPath)
        {
            _services = new ServiceCollection()
                .AddInterlinearizerCrdt(builder => builder.UseSqlite($"Data Source={dbPath}"))
                .BuildServiceProvider();
            _scope = _services.CreateAsyncScope();
            Db = _scope.ServiceProvider.GetRequiredService<InterlinearizerCrdtDbContext>();
        }

        public InterlinearizerCrdtDbContext Db { get; }
        public DataModel DataModel { get; private set; } = null!;
        public AnalysisRepository Repository { get; private set; } = null!;

        public static async Task<PerfClient> Open(string dbPath)
        {
            var client = new PerfClient(dbPath);
            // Building the data model reads the newest commit, so the tables must exist first.
            await client.Db.Database.MigrateAsync();
            client.DataModel = client._scope.ServiceProvider.GetRequiredService<DataModel>();
            client.Repository = new AnalysisRepository(client.DataModel, client.Db, client._client, ProjectId);
            return client;
        }

        public CommitFileSync Sync(ICommitFiles files) => new(DataModel, Db, _client, files,
            _scope.ServiceProvider.GetRequiredService<IOptions<HarmonyConfig>>().Value.JsonSerializerOptions);

        /// <summary>Writes one commit, which creates a project of its own.</summary>
        public Task WriteOne() => DataModel.AddChange(_client.Id, new CreateInterlinearProjectChange(Guid.NewGuid()) { Name = "dormant" });

        /// <summary>
        /// Writes the project, then <paramref name="analysis"/> in commits of
        /// <paramref name="changesPerCommit"/> changes, with analyses before the links to them.
        /// </summary>
        public async Task Seed(TextAnalysis analysis, int changesPerCommit)
        {
            await DataModel.AddChange(_client.Id, new CreateInterlinearProjectChange(ProjectId) { Name = "perf" });
            IEnumerable<IChange> changes =
            [
                .. analysis.SegmentAnalyses.Select(a => new CreateSegmentAnalysisChange(a, ProjectId)),
                .. analysis.TokenAnalyses.Select(a => new CreateTokenAnalysisChange(a, ProjectId)),
                .. analysis.PhraseAnalyses.Select(a => new CreatePhraseAnalysisChange(a, ProjectId)),
                .. analysis.SegmentAnalysisLinks.Select(l => new CreateSegmentAnalysisLinkChange(l, ProjectId)),
                .. analysis.TokenAnalysisLinks.Select(l => new CreateTokenAnalysisLinkChange(l, ProjectId)),
                .. analysis.PhraseAnalysisLinks.Select(l => new CreatePhraseAnalysisLinkChange(l, ProjectId)),
            ];
            await DataModel.AddManyChanges(_client.Id, changes, () => null, changesPerCommit);
        }

        public async ValueTask DisposeAsync()
        {
            await _scope.DisposeAsync();
            await _services.DisposeAsync();
        }
    }
}
