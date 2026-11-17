using Microsoft.Extensions.DependencyInjection;

namespace Interlinearizer.Crdt.Tests;

/// <summary>The model's container over databases in a sources folder under a temporary one, not yet made.</summary>
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
            .AddSingleton(new SourcesDirectory(SourcesFolder))
            .AddInterlinearizerCrdt()
            .BuildServiceProvider();
        _sources = _services.GetRequiredService<OpenSources>();
    }

    private string SourcesFolder => Path.Combine(_directory, "sources");

    private string DbPath(string name) => Path.Combine(SourcesFolder, name.ToUpperInvariant() + ".sqlite");

    /// <summary>The names of the database files in the sources folder, as the file system spells them.</summary>
    private string[] DatabaseFiles() => [.. new DirectoryInfo(SourcesFolder).GetFiles("*.sqlite").Select(f => f.Name)];

    private const string S1 = "source-1";
    private const string S2 = "source-2";

    private static readonly string P1 = Guid.NewGuid().ToString();
    private static readonly string P2 = Guid.NewGuid().ToString();

    private static TokenAnalysis Token(string surfaceText) => new() { Id = Guid.NewGuid(), SurfaceText = surfaceText };

    /// <summary>Opens a source over its own database and stores <paramref name="projectIds"/> in it.</summary>
    private async Task OpenWithProjects(string sourceProjectId, params string[] projectIds)
    {
        await _sources.Open(sourceProjectId);
        var projects = await _sources.Projects(sourceProjectId);
        foreach (var projectId in projectIds) await projects.Create(new InterlinearProject { Id = Guid.Parse(projectId) });
    }

    [Test]
    public async Task OpeningASourceCreatesItsDatabaseNamedAfterItInTheSourcesFolder()
    {
        await _sources.Open(S1);

        await Assert.That(File.Exists(DbPath(S1))).IsTrue();
        await Assert.That(_sources.DbPath(S1)).IsEqualTo(DbPath(S1));
        await Assert.That(_sources.IsOpen(S1)).IsTrue();
    }

    [Test]
    [Arguments("0123456789ABCDEF0123456789ABCDEF01234567")]
    [Arguments("0123456789abcdef0123456789abcdef01234567-slingshot-draft")]
    [Arguments("source_1")]
    public async Task OpeningASourceNamesItsDatabaseAfterItsIdInUpperCase(string sourceProjectId)
    {
        await _sources.Open(sourceProjectId);

        await Assert.That(DatabaseFiles()).IsEquivalentTo([sourceProjectId.ToUpperInvariant() + ".sqlite"]);
    }

    [Test]
    [Arguments("")]
    [Arguments("a/b")]
    [Arguments("a\\b")]
    [Arguments("..")]
    [Arguments("a.b")]
    [Arguments("a:b")]
    [Arguments("a b")]
    [Arguments("\u00e9")]
    public async Task ASourceWhoseIdCannotNameAFileOnEveryPlatformIsRefused(string sourceProjectId)
    {
        var workRan = false;

        await Assert.That(async () => await _sources.Open(sourceProjectId)).Throws<ArgumentException>();
        await Assert.That(async () => await _sources.Exclusive(sourceProjectId, () =>
        {
            workRan = true;
            return Task.CompletedTask;
        })).Throws<ArgumentException>();

        await Assert.That(workRan).IsFalse();
        await Assert.That(Directory.Exists(SourcesFolder)).IsFalse();
    }

    [Test]
    public async Task EverySpellingOfASourcesIdReachesTheOneSource()
    {
        await OpenWithProjects("abc-1", P1);

        await Assert.That(_sources.IsOpen("ABC-1")).IsTrue();
        await Assert.That(await _sources.Open("Abc-1")).IsSameReferenceAs(await _sources.Get("abc-1"));
        await Assert.That((await (await _sources.Projects("ABC-1")).List()).Select(p => p.Id)).IsEquivalentTo([Guid.Parse(P1)]);
        await Assert.That(DatabaseFiles()).IsEquivalentTo(["ABC-1.sqlite"]);
    }

    [Test]
    public async Task ExclusiveWorkOnAnotherSpellingOfASourcesIdWaits()
    {
        var release = new TaskCompletionSource();
        var first = _sources.Exclusive("abc-1", () => release.Task);
        var secondStarted = false;
        var second = _sources.Exclusive("ABC-1", () =>
        {
            secondStarted = true;
            return Task.CompletedTask;
        });

        await Assert.That(secondStarted).IsFalse();
        release.SetResult();
        await first;
        await second;

        await Assert.That(secondStarted).IsTrue();
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
        var first = await _sources.Open(S1);
        var second = await _sources.Open(S1);

        await Assert.That(second).IsSameReferenceAs(first);
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

        await _sources.Open(S1);

        await Assert.That(await (await _sources.Repository(S1, P1)).GetTokenAnalyses([put.Id])).HasSingleItem();
    }

    [Test]
    public async Task ExclusiveWorkOnASourceWaitsForTheWorkBeforeIt()
    {
        await OpenWithProjects(S1, P1, P2);
        var release = new TaskCompletionSource();
        var put = Token("and");
        var first = _sources.Exclusive(S1, async () =>
        {
            await release.Task;
            await (await _sources.Repository(S1, P1)).Apply(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) });
        });
        var secondStarted = false;
        var second = _sources.Exclusive(S1, async () =>
        {
            secondStarted = true;
            return await (await _sources.Repository(S1, P2)).GetTokenAnalyses([put.Id]);
        });
        var close = _sources.Exclusive(S1, () => _sources.Close(S1));

        await Assert.That(secondStarted).IsFalse();
        release.SetResult();
        await first;
        await Assert.That(await second).IsEmpty();
        await close;

        await Assert.That(_sources.IsOpen(S1)).IsFalse();
    }

    [Test]
    public async Task ExclusiveWorkOnAnotherSourceDoesNotWait()
    {
        var release = new TaskCompletionSource();
        var blocked = _sources.Exclusive(S1, () => release.Task);
        try
        {
            await _sources.Exclusive(S2, () => _sources.Open(S2)).WaitAsync(TimeSpan.FromSeconds(10));

            await Assert.That(blocked.IsCompleted).IsFalse();
        }
        finally
        {
            release.SetResult();
            await blocked;
        }
    }

    [Test]
    public async Task DisposingRefusesWorkStillWaitingOnASource()
    {
        var release = new TaskCompletionSource();
        var running = _sources.Exclusive(S1, () => release.Task);
        var waiting = _sources.Exclusive(S1, () => _sources.Open(S1));
        var dispose = _sources.DisposeAsync().AsTask();

        release.SetResult();
        await running;
        await dispose;

        await Assert.That(async () => await waiting).Throws<ObjectDisposedException>();
        await Assert.That(_sources.IsOpen(S1)).IsFalse();
    }

    [Test]
    public async Task DisposingClosesASourceThatWorkRunningOnItOpens()
    {
        var release = new TaskCompletionSource();
        var running = _sources.Exclusive(S1, async () =>
        {
            await release.Task;
            await _sources.Open(S1);
        });
        var dispose = _sources.DisposeAsync().AsTask();

        release.SetResult();
        await running;
        await dispose;

        await Assert.That(_sources.IsOpen(S1)).IsFalse();
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
