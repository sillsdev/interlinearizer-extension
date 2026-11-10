using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SIL.Harmony;

namespace Interlinearizer.Crdt;

/// <summary>The folder the source projects' databases are kept in, one file per source.</summary>
public record SourcesDirectory(string Path);

/// <summary>
/// The source projects the host has open, one DI scope each. A scope holds the Harmony services
/// over the source's own database, which keeps every interlinear project made over it, and lives
/// from <see cref="Open"/> to <see cref="Close"/>, rather than one scope per request. Work on a
/// source must run through <see cref="Exclusive"/>, because the scope's EF context allows no
/// overlapping operations.
/// </summary>
public sealed class OpenSources(IServiceProvider rootServices, SourcesDirectory directory) : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, Lazy<Task<AsyncServiceScope>>> _scopes = new();
    // Never removed: a command still waiting on a removed lock would run beside one holding its replacement.
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();
    private volatile bool _disposed;

    /// <summary>
    /// Runs <paramref name="work"/> once no other work run through this on the same source is
    /// running. Work on one source is not reentrant: it must not call this for that source.
    /// </summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    /// <exception cref="ObjectDisposedException">If this is disposed before the work starts.</exception>
    public async Task<T> Exclusive<T>(string sourceProjectId, Func<Task<T>> work)
    {
        var sourceLock = _locks.GetOrAdd(Key(sourceProjectId), _ => new SemaphoreSlim(1, 1));
        await sourceLock.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            return await work();
        }
        finally
        {
            sourceLock.Release();
        }
    }

    /// <inheritdoc cref="Exclusive{T}"/>
    public Task Exclusive(string sourceProjectId, Func<Task> work) =>
        Exclusive(sourceProjectId, async () =>
        {
            await work();
            return true;
        });

    /// <summary>
    /// The file the database of <paramref name="sourceProjectId"/> is kept in, named after the id
    /// in upper case.
    /// </summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    public string DbPath(string sourceProjectId) => Path.Combine(directory.Path, Key(sourceProjectId) + ".sqlite");

    /// <summary>
    /// Opens <paramref name="sourceProjectId"/> over its database, created with its folder when
    /// missing and brought up to the current schema when behind. Opening a source already open
    /// returns its services. Two concurrent opens of one source share one scope. Call only from
    /// work that <see cref="Exclusive"/> runs for <paramref name="sourceProjectId"/>.
    /// </summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    public async Task<IServiceProvider> Open(string sourceProjectId)
    {
        var key = Key(sourceProjectId);
        var scope = _scopes.GetOrAdd(key, _ => new Lazy<Task<AsyncServiceScope>>(() => OpenScope(key)));
        try
        {
            return (await scope.Value).ServiceProvider;
        }
        catch
        {
            _scopes.TryRemove(new KeyValuePair<string, Lazy<Task<AsyncServiceScope>>>(key, scope));
            throw;
        }
    }

    /// <summary>
    /// The services of an open source. Call only from work that <see cref="Exclusive"/> runs for
    /// <paramref name="sourceProjectId"/>.
    /// </summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    /// <exception cref="InvalidOperationException">If the source is not open.</exception>
    public async Task<IServiceProvider> Get(string sourceProjectId)
    {
        if (!_scopes.TryGetValue(Key(sourceProjectId), out var scope)) throw new InvalidOperationException($"Source {sourceProjectId} is not open");
        return (await scope.Value).ServiceProvider;
    }

    /// <summary>
    /// The repository over the records of <paramref name="projectId"/>, an interlinear project
    /// stored in an open source. A project not stored gets none, since its records would land
    /// deleted. Call only from work that <see cref="Exclusive"/> runs for
    /// <paramref name="sourceProjectId"/>, and use the repository only within that work.
    /// </summary>
    /// <exception cref="InvalidOperationException">If the source is not open.</exception>
    /// <exception cref="ArgumentException">
    /// If the source's id cannot name a file, the project id is not a GUID, or no project is
    /// stored under it.
    /// </exception>
    public async Task<AnalysisRepository> Repository(string sourceProjectId, string projectId)
    {
        var id = Guid.TryParse(projectId, out var parsed) ? parsed : throw new ArgumentException($"Project ids are GUIDs, not {projectId}", nameof(projectId));
        var services = await Get(sourceProjectId);
        if (await Projects(services).Get(id) is null) throw new ArgumentException($"Project {projectId} is not stored in source {sourceProjectId}", nameof(projectId));
        return new AnalysisRepository(
            services.GetRequiredService<DataModel>(),
            services.GetRequiredService<InterlinearizerCrdtDbContext>(),
            services.GetRequiredService<ClientIdentity>(),
            id);
    }

    /// <summary>
    /// The interlinear projects of an open source. Call only from work that
    /// <see cref="Exclusive"/> runs for <paramref name="sourceProjectId"/>, and use what it returns
    /// only within that work.
    /// </summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    /// <exception cref="InvalidOperationException">If the source is not open.</exception>
    public async Task<InterlinearProjects> Projects(string sourceProjectId) => Projects(await Get(sourceProjectId));

    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    public bool IsOpen(string sourceProjectId) => _scopes.ContainsKey(Key(sourceProjectId));

    /// <summary>
    /// Closes a source, disposing its scope. Closing one not open does nothing. Call only from work
    /// that <see cref="Exclusive"/> runs for <paramref name="sourceProjectId"/>.
    /// </summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    public async Task Close(string sourceProjectId)
    {
        if (!_scopes.TryRemove(Key(sourceProjectId), out var scope)) return;
        await (await scope.Value).DisposeAsync();
    }

    /// <summary>
    /// Closes every source once the work running on it ends. Any work yet to start is refused, so
    /// it cannot reopen a source.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        // Work already running may still open its source, so wait for it before closing.
        foreach (var (sourceProjectId, sourceLock) in _locks)
        {
            await sourceLock.WaitAsync();
            try
            {
                await Close(sourceProjectId);
            }
            finally
            {
                sourceLock.Release();
            }
        }
        // A source opened outside Exclusive has no lock.
        foreach (var sourceProjectId in _scopes.Keys) await Close(sourceProjectId);
    }

    private static InterlinearProjects Projects(IServiceProvider services) => new(
        services.GetRequiredService<DataModel>(),
        services.GetRequiredService<InterlinearizerCrdtDbContext>(),
        services.GetRequiredService<ClientIdentity>());

    /// <summary>
    /// The one spelling of a source's id that its lock, its scope, and its database file go by.
    /// Platform.Bible compares project ids ignoring case, so the id is upper-cased, as its
    /// <c>normalizeProjectId</c> does. It does not limit an id's characters, so this allows only
    /// those that name the same file on every platform: ASCII letters, digits, <c>_</c>, and
    /// <c>-</c>. Over ASCII alone, upper-casing here gives what upper-casing in JavaScript does.
    /// </summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    private static string Key(string sourceProjectId)
    {
        if (sourceProjectId.Length == 0 || !sourceProjectId.All(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-'))
        {
            throw new ArgumentException($"A source project id names its database file, which '{sourceProjectId}' cannot: it may hold only ASCII letters, digits, '_', and '-'", nameof(sourceProjectId));
        }
        return sourceProjectId.ToUpperInvariant();
    }

    private async Task<AsyncServiceScope> OpenScope(string key)
    {
        var scope = rootServices.CreateAsyncScope();
        try
        {
            scope.ServiceProvider.GetRequiredService<CurrentSource>().Set(key, DbPath(key));
            Directory.CreateDirectory(directory.Path);
            await scope.ServiceProvider.GetRequiredService<InterlinearizerCrdtDbContext>().Database.MigrateAsync();
            return scope;
        }
        catch
        {
            await scope.DisposeAsync();
            throw;
        }
    }
}
