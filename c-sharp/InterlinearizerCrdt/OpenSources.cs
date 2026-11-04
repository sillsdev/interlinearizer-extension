using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SIL.Harmony;

namespace Interlinearizer.Crdt;

/// <summary>
/// The source projects the host has open, one DI scope each. A scope holds the Harmony services
/// over the source's own database, which keeps every interlinear project made over it, and lives
/// from <see cref="Open"/> to <see cref="Close"/>; requests never create scopes.
/// </summary>
public sealed class OpenSources(IServiceProvider rootServices) : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, Lazy<Task<AsyncServiceScope>>> _scopes = new();

    /// <summary>
    /// Opens <paramref name="sourceProjectId"/> over the database at <paramref name="dbPath"/>,
    /// created with its folder when missing and brought up to the current schema when behind.
    /// Opening a source already open returns its services. Two concurrent opens of one source share
    /// one scope.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// If the source is already open over a different database.
    /// </exception>
    public async Task<IServiceProvider> Open(string sourceProjectId, string dbPath)
    {
        var scope = _scopes.GetOrAdd(sourceProjectId, _ => new Lazy<Task<AsyncServiceScope>>(() => OpenScope(sourceProjectId, dbPath)));
        IServiceProvider services;
        try
        {
            services = (await scope.Value).ServiceProvider;
        }
        catch
        {
            _scopes.TryRemove(new KeyValuePair<string, Lazy<Task<AsyncServiceScope>>>(sourceProjectId, scope));
            throw;
        }
        var openPath = services.GetRequiredService<CurrentSource>().DbPath;
        if (Path.GetFullPath(openPath) != Path.GetFullPath(dbPath)) throw new InvalidOperationException($"Source {sourceProjectId} is already open over {openPath}");
        return services;
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
        foreach (var sourceProjectId in _scopes.Keys) await Close(sourceProjectId);
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
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
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
