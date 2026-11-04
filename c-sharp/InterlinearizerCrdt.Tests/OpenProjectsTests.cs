using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Interlinearizer.Crdt.Tests;

/// <summary>The model's container over databases in a temporary folder.</summary>
public class OpenProjectsTests : IAsyncDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "i13r-open-projects", Guid.NewGuid().ToString("N"));
    private readonly ServiceProvider _services;
    private readonly OpenProjects _projects;

    public OpenProjectsTests()
    {
        Directory.CreateDirectory(_directory);
        _services = new ServiceCollection()
            .AddSingleton(new ClientIdentity(Guid.NewGuid()))
            .AddInterlinearizerCrdt()
            .BuildServiceProvider();
        _projects = _services.GetRequiredService<OpenProjects>();
    }

    private string DbPath(string name) => Path.Combine(_directory, name + ".sqlite");

    private static readonly string P1 = Guid.NewGuid().ToString();
    private static readonly string P2 = Guid.NewGuid().ToString();

    private static TokenAnalysis Token(string surfaceText) => new() { Id = Guid.NewGuid(), SurfaceText = surfaceText };

    [Test]
    public async Task OpeningAProjectCreatesItsDatabase()
    {
        await _projects.Open(P1, DbPath(P1));

        await Assert.That(File.Exists(DbPath(P1))).IsTrue();
        await Assert.That(_projects.IsOpen(P1)).IsTrue();
    }

    [Test]
    public async Task OpeningAProjectUnderASemicolonFolderCreatesItsDatabase()
    {
        var dbPath = Path.Combine(_directory, "a;b", "p1.sqlite");
        Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);

        await _projects.Open(P1, dbPath);

        await Assert.That(File.Exists(dbPath)).IsTrue();
    }

    [Test]
    public async Task EachProjectHasItsOwnRepository()
    {
        await _projects.Open(P1, DbPath(P1));
        await _projects.Open(P2, DbPath(P2));
        var put = Token("and");

        await (await _projects.Repository(P1)).Apply(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) });

        await Assert.That(await (await _projects.Repository(P1)).GetTokenAnalyses([put.Id])).HasSingleItem();
        await Assert.That(await (await _projects.Repository(P2)).GetTokenAnalyses([put.Id])).IsEmpty();
    }

    [Test]
    public async Task OpeningAProjectCreatesItInItsDatabaseOnce()
    {
        var services = await _projects.Open(P1, DbPath(P1));
        await _projects.Close(P1);
        await _projects.Open(P1, DbPath(P1));

        var db = (await _projects.Get(P1)).GetRequiredService<InterlinearizerCrdtDbContext>();
        await Assert.That(await db.InterlinearProjects.CountAsync()).IsEqualTo(1);
        await Assert.That((await db.InterlinearProjects.SingleAsync()).Id).IsEqualTo(Guid.Parse(P1));
        await Assert.That(services).IsNotNull();
    }

    [Test]
    public async Task OpeningAProjectWhoseIdIsNotAGuidThrows()
    {
        await Assert.That(async () => await _projects.Open("p1", DbPath("p1"))).Throws<ArgumentException>();
        await Assert.That(_projects.IsOpen("p1")).IsFalse();
    }

    [Test]
    public async Task OpeningAnOpenProjectReturnsItsScope()
    {
        var first = await _projects.Open(P1, DbPath(P1));
        var second = await _projects.Open(P1, DbPath(P1));

        await Assert.That(second).IsSameReferenceAs(first);
    }

    [Test]
    public async Task OpeningAnOpenProjectOverAnotherDatabaseThrows()
    {
        await _projects.Open(P1, DbPath(P1));

        await Assert.That(async () => await _projects.Open(P1, DbPath("other"))).Throws<InvalidOperationException>();
        await Assert.That(_projects.IsOpen(P1)).IsTrue();
    }

    [Test]
    public async Task AClosedProjectIsNoLongerOpen()
    {
        await _projects.Open(P1, DbPath(P1));

        await _projects.Close(P1);

        await Assert.That(_projects.IsOpen(P1)).IsFalse();
        await Assert.That(async () => await _projects.Repository(P1)).Throws<InvalidOperationException>();
    }

    [Test]
    public async Task AReopenedProjectStillHoldsItsAnalysis()
    {
        await _projects.Open(P1, DbPath(P1));
        var put = Token("and");
        await (await _projects.Repository(P1)).Apply(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) });
        await _projects.Close(P1);

        await _projects.Open(P1, DbPath(P1));

        await Assert.That(await (await _projects.Repository(P1)).GetTokenAnalyses([put.Id])).HasSingleItem();
    }

    [Test]
    public async Task ClosingAProjectNotOpenDoesNothing()
    {
        await _projects.Close("never");

        await Assert.That(_projects.IsOpen("never")).IsFalse();
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
        await _projects.DisposeAsync();
        await _services.DisposeAsync();
        // SQLite keeps pooled connections open until the pool is cleared.
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_directory, recursive: true);
    }
}
