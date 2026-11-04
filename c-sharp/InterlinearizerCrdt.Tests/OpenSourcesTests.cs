using Microsoft.Extensions.DependencyInjection;

namespace Interlinearizer.Crdt.Tests;

/// <summary>The model's container over databases in a temporary folder.</summary>
public class OpenSourcesTests : IAsyncDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "i13r-open-sources", Guid.NewGuid().ToString("N"));
    private readonly ServiceProvider _services;
    private readonly OpenSources _sources;

    public OpenSourcesTests()
    {
        Directory.CreateDirectory(_directory);
        _services = new ServiceCollection()
            .AddSingleton(new ClientIdentity(Guid.NewGuid()))
            .AddInterlinearizerCrdt()
            .BuildServiceProvider();
        _sources = _services.GetRequiredService<OpenSources>();
    }

    private string DbPath(string name) => Path.Combine(_directory, name + ".sqlite");

    private const string S1 = "source-1";
    private const string S2 = "source-2";

    private static readonly string P1 = Guid.NewGuid().ToString();
    private static readonly string P2 = Guid.NewGuid().ToString();

    private static TokenAnalysis Token(string surfaceText) => new() { Id = Guid.NewGuid(), SurfaceText = surfaceText };

    /// <summary>Opens a source over its own database and stores <paramref name="projectIds"/> in it.</summary>
    private async Task OpenWithProjects(string sourceProjectId, params string[] projectIds)
    {
        await _sources.Open(sourceProjectId, DbPath(sourceProjectId));
        var projects = await _sources.Projects(sourceProjectId);
        foreach (var projectId in projectIds) await projects.Create(new InterlinearProject { Id = Guid.Parse(projectId) });
    }

    [Test]
    public async Task OpeningASourceCreatesItsDatabase()
    {
        await _sources.Open(S1, DbPath(S1));

        await Assert.That(File.Exists(DbPath(S1))).IsTrue();
        await Assert.That(_sources.IsOpen(S1)).IsTrue();
    }

    [Test]
    public async Task OpeningASourceUnderAFolderNotYetMadeCreatesBoth()
    {
        var dbPath = Path.Combine(_directory, "a;b", "s1.sqlite");

        await _sources.Open(S1, dbPath);

        await Assert.That(File.Exists(dbPath)).IsTrue();
    }

    [Test]
    public async Task EachProjectOfASourceHasItsOwnRepository()
    {
        await OpenWithProjects(S1, P1, P2);
        var put = Token("and");

        await (await _sources.Repository(S1, P1)).Apply(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) });

        await Assert.That(await (await _sources.Repository(S1, P1)).GetTokenAnalyses([put.Id])).HasSingleItem();
        await Assert.That(await (await _sources.Repository(S1, P2)).GetTokenAnalyses([put.Id])).IsEmpty();
    }

    [Test]
    public async Task EachSourceHasItsOwnProjects()
    {
        await OpenWithProjects(S1, P1);
        await OpenWithProjects(S2, P2);

        await Assert.That((await (await _sources.Projects(S1)).List()).Select(p => p.Id)).IsEquivalentTo([Guid.Parse(P1)]);
        await Assert.That((await (await _sources.Projects(S2)).List()).Select(p => p.Id)).IsEquivalentTo([Guid.Parse(P2)]);
        await Assert.That(async () => await _sources.Repository(S2, P1)).Throws<ArgumentException>();
    }

    [Test]
    public async Task AProjectNotStoredGetsNoRepository()
    {
        await OpenWithProjects(S1, P1);
        await (await _sources.Projects(S1)).Delete(Guid.Parse(P1));

        await Assert.That(async () => await _sources.Repository(S1, P1)).Throws<ArgumentException>();
        await Assert.That(async () => await _sources.Repository(S1, P2)).Throws<ArgumentException>();
        await Assert.That(async () => await _sources.Repository(S1, "p1")).Throws<ArgumentException>();
    }

    [Test]
    public async Task OpeningAnOpenSourceReturnsItsScope()
    {
        var first = await _sources.Open(S1, DbPath(S1));
        var second = await _sources.Open(S1, DbPath(S1));

        await Assert.That(second).IsSameReferenceAs(first);
    }

    [Test]
    public async Task OpeningAnOpenSourceOverAnotherDatabaseThrows()
    {
        await _sources.Open(S1, DbPath(S1));

        await Assert.That(async () => await _sources.Open(S1, DbPath("other"))).Throws<InvalidOperationException>();
        await Assert.That(_sources.IsOpen(S1)).IsTrue();
    }

    [Test]
    public async Task AClosedSourceIsNoLongerOpen()
    {
        await OpenWithProjects(S1, P1);

        await _sources.Close(S1);

        await Assert.That(_sources.IsOpen(S1)).IsFalse();
        await Assert.That(async () => await _sources.Repository(S1, P1)).Throws<InvalidOperationException>();
        await Assert.That(async () => await _sources.Projects(S1)).Throws<InvalidOperationException>();
    }

    [Test]
    public async Task AReopenedSourceStillHoldsItsProjectsAndTheirAnalysis()
    {
        await OpenWithProjects(S1, P1);
        var put = Token("and");
        await (await _sources.Repository(S1, P1)).Apply(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) });
        await _sources.Close(S1);

        await _sources.Open(S1, DbPath(S1));

        await Assert.That(await (await _sources.Repository(S1, P1)).GetTokenAnalyses([put.Id])).HasSingleItem();
    }

    [Test]
    public async Task ClosingASourceNotOpenDoesNothing()
    {
        await _sources.Close("never");

        await Assert.That(_sources.IsOpen("never")).IsFalse();
    }

    [Test]
    public async Task TheClientIdentityIsKeptAcrossLoads()
    {
        var first = ClientIdentity.Load(_directory);
        var second = ClientIdentity.Load(_directory);

        await Assert.That(second).IsEqualTo(first);
    }

    public async ValueTask DisposeAsync()
    {
        await _sources.DisposeAsync();
        await _services.DisposeAsync();
        // SQLite keeps pooled connections open until the pool is cleared.
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_directory, recursive: true);
    }
}
