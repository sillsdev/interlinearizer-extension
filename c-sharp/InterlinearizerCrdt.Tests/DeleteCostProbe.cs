using System.Data.Common;
using System.Diagnostics;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

namespace Interlinearizer.Crdt.Tests;

public class DeleteCostProbe
{
    private sealed class Timer : DbCommandInterceptor
    {
        public bool On;
        public readonly List<(double Ms, string Sql)> Log = [];

        public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand c, CommandExecutedEventData e, DbDataReader r, CancellationToken t = default)
        { if (On) Log.Add((e.Duration.TotalMilliseconds, c.CommandText)); return ValueTask.FromResult(r); }
        public override ValueTask<int> NonQueryExecutedAsync(DbCommand c, CommandExecutedEventData e, int r, CancellationToken t = default)
        { if (On) Log.Add((e.Duration.TotalMilliseconds, c.CommandText)); return ValueTask.FromResult(r); }
        public override ValueTask<object?> ScalarExecutedAsync(DbCommand c, CommandExecutedEventData e, object? r, CancellationToken t = default)
        { if (On) Log.Add((e.Duration.TotalMilliseconds, c.CommandText)); return ValueTask.FromResult(r); }
    }

    private static void Out(string line) => File.AppendAllText("/tmp/probe.txt", line + "\n");

    [Test]
    [Explicit]
    public async Task Probe()
    {
        var links = int.Parse(Environment.GetEnvironmentVariable("PROBE_LINKS") ?? "40000");
        var path = Path.Combine(Path.GetTempPath(), $"probe-{Guid.NewGuid()}.sqlite");
        var timer = new Timer();
        await using var services = new ServiceCollection()
            .AddInterlinearizerCrdt(b => b.UseSqlite($"Data Source={path}").AddInterceptors(timer))
            .AddSingleton(new ClientIdentity(Guid.NewGuid()))
            .BuildServiceProvider();
        var db = services.GetRequiredService<InterlinearizerCrdtDbContext>();
        await db.Database.MigrateAsync();
        var model = services.GetRequiredService<DataModel>();
        var client = services.GetRequiredService<ClientIdentity>();
        await model.AddChanges(client.Id, [new CreateInterlinearProjectChange(Fixtures.ProjectId) { Name = "p" }]);
        var repo = new AnalysisRepository(model, db, client, Fixtures.ProjectId);

        var analyses = Enumerable.Range(0, links / 4).Select(i => new TokenAnalysis { Id = Guid.NewGuid(), SurfaceText = $"w{i}" }).ToList();
        foreach (var chunk in analyses.Chunk(5000))
            await repo.Apply(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Create(chunk) });
        var all = Enumerable.Range(0, links).Select(i => new TokenAnalysisLink
        {
            Id = Guid.NewGuid(), AnalysisId = analyses[i % analyses.Count].Id,
            Token = new TokenSnapshot($"GEN 1:{i}:0", "w"), Status = AssignmentStatus.Approved,
        }).ToList();
        foreach (var chunk in all.Chunk(5000))
            await repo.Apply(new ChangeSet { Intent = "seed", TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(chunk) });
        db.ChangeTracker.Clear();

        for (var run = 0; run < 3; run++)
        {
            var spare = new TokenAnalysis { Id = Guid.NewGuid(), SurfaceText = "spare" };
            await repo.Apply(new ChangeSet { Intent = "c", TokenAnalyses = RecordChanges<TokenAnalysis>.Create(spare) });
            timer.Log.Clear();
            timer.On = true;
            var sw = Stopwatch.StartNew();
            await repo.Apply(new ChangeSet { Intent = "d", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(spare.Id) });
            timer.On = false;
            Out($"=== run {run}: delete {sw.Elapsed.TotalMilliseconds:F1} ms, sql total {timer.Log.Sum(l => l.Ms):F1} ms");
            foreach (var (ms, sql) in timer.Log.OrderByDescending(l => l.Ms).Take(1))
                Out($"{ms,8:F1} ms  {sql.ReplaceLineEndings(" ")}");
        }
        File.Delete(path);
    }
}
