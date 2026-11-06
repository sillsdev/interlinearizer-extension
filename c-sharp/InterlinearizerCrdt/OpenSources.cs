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
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    /// <summary>
    /// Runs <paramref name="work"/> once no other work run through this on the same source is
    /// running. Work on one source is not reentrant: it must not call this for that source.
    /// </summary>
    public async Task<T> Exclusive<T>(string sourceProjectId, Func<Task<T>> work)
    {
        var sourceLock = _locks.GetOrAdd(sourceProjectId, _ => new SemaphoreSlim(1, 1));
        await sourceLock.WaitAsync();
        try
        {
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

    /// <summary>The file the database of <paramref name="sourceProjectId"/> is kept in, named after it.</summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    public string DbPath(string sourceProjectId)
    {
        if (sourceProjectId.Length == 0 || sourceProjectId != Path.GetFileName(sourceProjectId) || sourceProjectId.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        {
            throw new ArgumentException($"A source project id names its database file, which '{sourceProjectId}' cannot", nameof(sourceProjectId));
        }
        return Path.Combine(directory.Path, sourceProjectId + ".sqlite");
    }

    /// <summary>
    /// Opens <paramref name="sourceProjectId"/> over its database, created with its folder when
    /// missing and brought up to the current schema when behind. Opening a source already open
    /// returns its services. Two concurrent opens of one source share one scope.
    /// </summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    public async Task<IServiceProvider> Open(string sourceProjectId)
    {
        var dbPath = DbPath(sourceProjectId);
        var scope = _scopes.GetOrAdd(sourceProjectId, _ => new Lazy<Task<AsyncServiceScope>>(() => OpenScope(sourceProjectId, dbPath)));
        try
        {
            return (await scope.Value).ServiceProvider;
        }
        catch
        {
            _scopes.TryRemove(new KeyValuePair<string, Lazy<Task<AsyncServiceScope>>>(sourceProjectId, scope));
            throw;
        }
    }

    /// <summary>The services of an open source.</summary>
    /// <exception cref="InvalidOperationException">If the source is not open.</exception>
    public async Task<IServiceProvider> Get(string sourceProjectId)
    {
        if (!_scopes.TryGetValue(sourceProjectId, out var scope)) throw new InvalidOperationException($"Source {sourceProjectId} is not open");
        return (await scope.Value).ServiceProvider;
    }

    /// <summary>
    /// The repository over the records of <paramref name="projectId"/>, an interlinear project
    /// stored in an open source. A project not stored gets none, since its records would land
    /// deleted.
    /// </summary>
    /// <exception cref="InvalidOperationException">If the source is not open.</exception>
    /// <exception cref="ArgumentException">
    /// If the project id is not a GUID, or no project is stored under it.
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

    /// <summary>The interlinear projects of an open source.</summary>
    /// <exception cref="InvalidOperationException">If the source is not open.</exception>
    public async Task<InterlinearProjects> Projects(string sourceProjectId) => Projects(await Get(sourceProjectId));

    public bool IsOpen(string sourceProjectId) => _scopes.ContainsKey(sourceProjectId);

    /// <summary>Closes a source, disposing its scope. Closing one not open does nothing.</summary>
    public async Task Close(string sourceProjectId)
    {
        if (!_scopes.TryRemove(sourceProjectId, out var scope)) return;
        await (await scope.Value).DisposeAsync();
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var sourceProjectId in _scopes.Keys) await Exclusive(sourceProjectId, () => Close(sourceProjectId));
    }

    private static InterlinearProjects Projects(IServiceProvider services) => new(
        services.GetRequiredService<DataModel>(),
        services.GetRequiredService<InterlinearizerCrdtDbContext>(),
        services.GetRequiredService<ClientIdentity>());

    private async Task<AsyncServiceScope> OpenScope(string sourceProjectId, string dbPath)
    {
        var scope = rootServices.CreateAsyncScope();
        try
        {
            scope.ServiceProvider.GetRequiredService<CurrentSource>().Set(sourceProjectId, dbPath);
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
