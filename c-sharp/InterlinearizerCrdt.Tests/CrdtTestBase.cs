using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using SIL.Harmony.Config;

namespace Interlinearizer.Crdt.Tests;

/// <summary>
/// An interlinearizer Harmony model over an in-memory database, with commit times the test
/// controls. Each test gets its own instance.
/// </summary>
public abstract class CrdtTestBase : IAsyncDisposable
{
    private static int _instanceCount;

    private readonly ServiceProvider _services;
    private readonly MockTimeProvider _timeProvider = new();
    // Each instance starts at its own hour, so that two models in one test never share a time.
    private DateTimeOffset _currentDate =
        new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero).AddHours(Interlocked.Increment(ref _instanceCount));

    protected readonly Guid ClientId = Guid.NewGuid();
    protected readonly DataModel DataModel;
    protected readonly InterlinearizerCrdtDbContext DbContext;
    protected readonly HarmonyConfig HarmonyConfig;
    protected readonly AnalysisRepository Repository;

    protected CrdtTestBase()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        _services = new ServiceCollection()
            .AddInterlinearizerCrdt(builder => builder.UseSqlite(connection, true))
            .Configure<HarmonyConfig>(config => config.AlwaysValidateCommits = true)
            .Replace(ServiceDescriptor.Singleton<IHybridDateTimeProvider>(_timeProvider))
            .BuildServiceProvider();
        HarmonyConfig = _services.GetRequiredService<Microsoft.Extensions.Options.IOptions<HarmonyConfig>>().Value;
        DbContext = _services.GetRequiredService<InterlinearizerCrdtDbContext>();
        DbContext.Database.OpenConnection();
        DbContext.Database.EnsureCreated();
        DataModel = _services.GetRequiredService<DataModel>();
        Repository = new AnalysisRepository(DataModel, ClientId);
    }

    /// <summary>Applies through the repository at the next commit time.</summary>
    protected async Task ApplyNext(ChangeSet changes)
    {
        _timeProvider.SetNextDateTime(NextDate());
        await Repository.Apply(changes);
    }

    /// <summary>The time the next commit will be made at, one day after the last.</summary>
    protected DateTimeOffset NextDate() => _currentDate = _currentDate.AddDays(1);

    protected async Task<Commit> WriteNextChange(IChange change) => await WriteNextChange([change]);

    protected async Task<Commit> WriteNextChange(IEnumerable<IChange> changes) =>
        await WriteChangeAt(NextDate(), changes);

    protected async Task<Commit> WriteChangeAt(DateTimeOffset dateTime, IEnumerable<IChange> changes)
    {
        _timeProvider.SetNextDateTime(dateTime);
        return await DataModel.AddChanges(ClientId, changes);
    }

    /// <summary>A commit dated before <paramref name="commit"/>, as one synced late would be.</summary>
    protected async Task<Commit> WriteChangeBefore(Commit commit, IChange change) =>
        await WriteChangeAt(commit.DateTime.AddHours(-1), [change]);

    public async ValueTask DisposeAsync()
    {
        await _services.DisposeAsync();
        GC.SuppressFinalize(this);
    }

    private class MockTimeProvider : IHybridDateTimeProvider
    {
        private HybridDateTime? _next;

        public void SetNextDateTime(DateTimeOffset dateTime) => _next = new HybridDateTime(dateTime, 0);

        public HybridDateTime GetDateTime()
        {
            if (_next is null) return new HybridDateTime(DateTimeOffset.UtcNow, 0);
            var result = _next;
            _next = null;
            return result;
        }

        public void TakeLatestTime(IEnumerable<HybridDateTime> times)
        {
        }
    }
}
