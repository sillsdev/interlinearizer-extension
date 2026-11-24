using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Interlinearizer.Crdt.Tests;

/// <summary>Two clients of one source, Ana and Ben, sharing commits through one folder of files.</summary>
public class CommitFileSyncTests : IAsyncDisposable
{
    private static readonly Guid TokenId = Guid.NewGuid();
    private static readonly Guid LinkId = Guid.NewGuid();

    private const int TinyFile = 100;

    private readonly DirectoryInfo _folder = Directory.CreateTempSubdirectory("commit-file-sync-");
    private readonly string _shared;
    private readonly DirectoryCommitFiles _files;
    private readonly Client _ana = new();
    private readonly Client _ben = new();
    // One clock for both clients, well after the project's creation, so that commits sort in the order the test makes them.
    private DateTimeOffset _clock = new(2010, 1, 1, 0, 0, 0, TimeSpan.Zero);

    public CommitFileSyncTests()
    {
        _shared = Path.Combine(_folder.FullName, "shared");
        _files = new DirectoryCommitFiles(_shared);
    }

    [Before(Test)]
    public async Task AnaCreatesTheProject() => await _ana.CreateTheProject();

    [Test]
    public async Task TwoDatabasesEndUpWithTheSameRecords()
    {
        await Write(_ana, Fixtures.CreateTokenAnalysis(TokenId), Fixtures.CreateTokenAnalysisLink(LinkId, TokenId));
        await _ana.Sync(_files).Export();
        await _ben.Sync(_files).Import();

        await Write(_ben, Fixtures.PatchTokenAnalysis(TokenId), Fixtures.CreatePhraseAnalysis(Guid.NewGuid()));
        await Write(_ana, Fixtures.ReplaceTokenAnalysisLink(LinkId, TokenId));
        await _ana.Sync(_files).Export();
        await _ben.Sync(_files).Export();
        await _ana.Sync(_files).Import();
        await _ben.Sync(_files).Import();

        var token = await _ana.Get<TokenAnalysis>(TokenId);
        await Assert.That(token.Gloss!["de"]).IsEqualTo("Anfang");
        var link = await _ana.Get<TokenAnalysisLink>(LinkId);
        await Assert.That(link.Status).IsEqualTo(AssignmentStatus.Approved);
        await Assert.That(await _ben.Records()).IsEqualTo(await _ana.Records());
    }

    [Test]
    public async Task ExportWritesOnlyThisClientsCommits()
    {
        await _ana.Sync(_files).Export();
        await _ben.Sync(_files).Import();

        await Write(_ben, Fixtures.CreateTokenAnalysis(TokenId));
        var written = await _ben.Sync(_files).Export();

        await Assert.That(written).IsEqualTo(1);
        await Assert.That(await _files.List()).Count().IsEqualTo(2);
        await Assert.That(await _files.List()).Contains(name => name.StartsWith($"commits/{_ben.Id}/", StringComparison.Ordinal));
    }

    [Test]
    public async Task ExportWritesNothingAlreadyExported()
    {
        await _ana.Sync(_files).Export();

        var written = await _ana.Sync(_files).Export();

        await Assert.That(written).IsEqualTo(0);
        await Assert.That(await _files.List()).Count().IsEqualTo(1);
    }

    [Test]
    public async Task ExportReachesACommitInTheSameMillisecondAsTheLastExported()
    {
        var exported = await Write(_ana, Fixtures.CreateTokenAnalysis(TokenId));
        await _ana.Sync(_files).Export();
        await _ana.WriteAt(exported.DateTime.AddTicks(1), Fixtures.CreateTokenAnalysisLink(LinkId, TokenId));

        var written = await _ana.Sync(_files).Export();
        await _ben.Sync(_files).Import();

        await Assert.That(written).IsEqualTo(1);
        await Assert.That(await _ben.Records()).IsEqualTo(await _ana.Records());
    }

    [Test]
    public async Task ExportStartsANewChunkWhenTheNextCommitWouldPassTheLimit()
    {
        await _ana.Sync(_files).Export();
        await Write(_ana, Fixtures.CreateTokenAnalysis(Guid.NewGuid()));
        await Write(_ana, Fixtures.CreateTokenAnalysis(Guid.NewGuid()));
        var scratch = new DirectoryCommitFiles(Path.Combine(_folder.FullName, "scratch"));
        await _ana.Sync(scratch).Export();
        using var exported = JsonDocument.Parse(await scratch.Read((await scratch.List())[0]));
        // The two commits differ only in their ids, so a chunk with room for one has no room for both.
        var roomForOne = exported.RootElement.EnumerateArray().Last().GetRawText().Length + "[]".Length;

        await _ana.Sync(_files, maxFileChars: roomForOne).Export();
        await _ben.Sync(_files).Import();

        await Assert.That(await _files.List()).Count().IsEqualTo(3);
        await Assert.That(await _ben.Records()).IsEqualTo(await _ana.Records());
    }

    [Test]
    public async Task ExportSplitsAChunkLongerThanTheLimitIntoParts()
    {
        await _ana.Sync(_files, maxFileChars: TinyFile).Export();
        await _ben.Sync(_files).Import();

        var names = await _files.List();
        await Assert.That(names.Where(name => !name.Contains("-of-", StringComparison.Ordinal))).IsEmpty();
        foreach (var name in names) await Assert.That((await _files.Read(name)).Length).IsLessThanOrEqualTo(TinyFile);
        await Assert.That(await _ben.Records()).IsEqualTo(await _ana.Records());
    }

    [Test]
    public async Task ExportCompletesAChunkMissingAPartBeforeNewerCommitsEvenUnderAnotherLimit()
    {
        await _ana.Sync(_files, maxFileChars: TinyFile).Export();
        DeleteSecondPart(await _files.List());
        await Write(_ana, Fixtures.CreateTokenAnalysis(TokenId));

        var written = await _ana.Sync(_files).Export();
        await _ben.Sync(_files).Import();

        await Assert.That(written).IsEqualTo(2);
        await Assert.That(await _ben.Records()).IsEqualTo(await _ana.Records());
    }

    [Test]
    public async Task ExportThrowsWhenAChunkMissingAPartNoLongerMatchesItsCommit()
    {
        await _ana.Sync(_files, maxFileChars: TinyFile).Export();
        var names = await _files.List();
        DeleteSecondPart(names);
        await _files.Write(names.First(name => name.Contains(".1-of-", StringComparison.Ordinal)), "[");

        await Assert.That(() => _ana.Sync(_files, maxFileChars: TinyFile).Export()).Throws<InvalidDataException>();
    }

    [Test]
    public async Task ImportReadsNoChunkTheDatabaseHolds()
    {
        await _ana.Sync(_files).Export();
        await _ben.Sync(_files).Import();

        await Assert.That(await _ben.Sync(_files).Import()).IsEqualTo(0);
        await Assert.That(await _ana.Sync(_files).Import()).IsEqualTo(0);
    }

    [Test]
    public async Task ImportReadsOnlyChunksNewerThanTheDatabaseHolds()
    {
        await _ana.Sync(_files).Export();
        await _ben.Sync(_files).Import();
        await Write(_ana, Fixtures.CreateTokenAnalysis(TokenId));
        await _ana.Sync(_files).Export();

        await Assert.That(await _ben.Sync(_files).Import()).IsEqualTo(1);
    }

    [Test]
    public async Task ImportWaitsForEveryPartOfAChunkBeforeReadingItOrLaterChunks()
    {
        await _ana.Sync(_files, maxFileChars: TinyFile).Export();
        await Write(_ana, Fixtures.CreateTokenAnalysis(TokenId));
        await _ana.Sync(_files).Export();
        DeleteSecondPart(await _files.List());

        await Assert.That(await _ben.Sync(_files).Import()).IsEqualTo(0);
        await Assert.That(await _ben.CommitCount()).IsEqualTo(0);
    }

    [Test]
    public async Task ImportSkipsFilesNotNamedAsChunks()
    {
        await _files.Write("commits/notes.json", "not a chunk");
        await _files.Write($"commits/{Guid.NewGuid()}/notes.json", "not a chunk");
        await _files.Write($"commits/{Guid.NewGuid()}/{long.MaxValue}-0.json", "not a chunk");
        await _ana.Sync(_files).Export();

        await _ben.Sync(_files).Import();

        await Assert.That(await _ben.Records()).IsEqualTo(await _ana.Records());
    }

    [Test]
    public async Task ImportReadsAChunkThatStartsWithAByteOrderMark()
    {
        await _ana.Sync(_files).Export();
        var path = Path.Combine(_shared, (await _files.List()).Single().Replace('/', Path.DirectorySeparatorChar));
        await File.WriteAllBytesAsync(path, [0xEF, 0xBB, 0xBF, .. await File.ReadAllBytesAsync(path)]);

        await Assert.That(await _ben.Sync(_files).Import()).IsEqualTo(1);
        await Assert.That(await _ben.Records()).IsEqualTo(await _ana.Records());
    }

    [Test]
    public async Task ImportThrowsWithoutAddingAnyChunkWhenOneCannotBeRead()
    {
        await _ana.Sync(_files).Export();
        await _files.Write($"commits/{Guid.NewGuid()}/{DateTimeOffset.UtcNow.UtcTicks}-0.json", """[{"unknown": true""");

        await Assert.That(() => _ben.Sync(_files).Import()).Throws<JsonException>();
        await Assert.That(await _ben.CommitCount()).IsEqualTo(0);
    }

    [Test]
    [Arguments(false)]
    [Arguments(true)]
    public async Task ImportThrowsWithoutAddingAChunkThatIsNotUtf8(bool byteOrderMark)
    {
        await _ana.Sync(_files).Export();
        var path = Path.Combine(_shared, (await _files.List()).Single().Replace('/', Path.DirectorySeparatorChar));
        var bytes = await File.ReadAllBytesAsync(path);
        // The project's name, a string in which a lenient read would pass a U+FFFD on to the database.
        bytes[bytes.AsSpan().IndexOf("test project"u8)] = 0xFF;
        await File.WriteAllBytesAsync(path, byteOrderMark ? [0xEF, 0xBB, 0xBF, .. bytes] : bytes);

        await Assert.That(() => _ben.Sync(_files).Import()).Throws<DecoderFallbackException>();
        await Assert.That(await _ben.CommitCount()).IsEqualTo(0);
    }

    /// <summary>
    /// Deletes the second part of the first split chunk in <paramref name="names"/>, as if an
    /// export had stopped partway, or a clone had yet to receive the part.
    /// </summary>
    private void DeleteSecondPart(IEnumerable<string> names) =>
        File.Delete(Path.Combine(_shared, names.First(name => name.Contains(".2-of-", StringComparison.Ordinal))));

    private Task<Commit> Write(Client client, params IChange[] changes) => client.WriteAt(_clock = _clock.AddDays(1), changes);

    public async ValueTask DisposeAsync()
    {
        await _ana.DisposeAsync();
        await _ben.DisposeAsync();
        _folder.Delete(recursive: true);
        GC.SuppressFinalize(this);
    }

    private sealed class Client : CrdtTestBase
    {
        public Guid Id => ClientId;

        public CommitFileSync Sync(ICommitFiles files, int maxFileChars = CommitFileSync.DefaultMaxFileChars) =>
            new(DataModel, DbContext, new ClientIdentity(ClientId), files, HarmonyConfig.JsonSerializerOptions, maxFileChars);

        public Task<Commit> WriteAt(DateTimeOffset dateTime, params IChange[] changes) => WriteChangeAt(dateTime, changes);

        public async Task<T> Get<T>(Guid id) where T : class => (await DataModel.GetLatest<T>(id))!;

        public Task<int> CommitCount() => DbContext.Commits.CountAsync();

        /// <summary>Every record the database projects, as JSON in a stable order.</summary>
        public async Task<string> Records() => JsonSerializer.Serialize(new object[]
        {
            await DbContext.InterlinearProjects.OrderBy(r => r.Id).ToListAsync(),
            await DbContext.SegmentAnalyses.OrderBy(r => r.Id).ToListAsync(),
            await DbContext.SegmentAnalysisLinks.OrderBy(r => r.Id).ToListAsync(),
            await DbContext.TokenAnalyses.OrderBy(r => r.Id).ToListAsync(),
            await DbContext.TokenAnalysisLinks.OrderBy(r => r.Id).ToListAsync(),
            await DbContext.PhraseAnalyses.OrderBy(r => r.Id).ToListAsync(),
            await DbContext.PhraseAnalysisLinks.OrderBy(r => r.Id).ToListAsync(),
        });
    }
}
