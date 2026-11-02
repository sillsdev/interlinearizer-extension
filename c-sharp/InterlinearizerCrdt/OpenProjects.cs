using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Interlinearizer.Crdt;

/// <summary>
/// The projects the host has open, one DI scope each. A scope holds the project's Harmony
/// services over its own database and lives from <see cref="Open"/> to <see cref="Close"/>, so
/// no request creates one. Opening a project already open returns its scope.
/// </summary>
public sealed class OpenProjects(IServiceProvider rootServices) : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, Lazy<Task<AsyncServiceScope>>> _scopes = new();

    /// <summary>
    /// Opens <paramref name="projectId"/> over the database at <paramref name="dbPath"/>, created
    /// when missing and brought up to the current schema when behind. Two concurrent opens of one
    /// project share one scope.
    /// </summary>
    public async Task<IServiceProvider> Open(string projectId, string dbPath)
    {
        var scope = _scopes.GetOrAdd(projectId, _ => new Lazy<Task<AsyncServiceScope>>(() => OpenScope(projectId, dbPath)));
        try
        {
            return (await scope.Value).ServiceProvider;
        }
        catch
        {
            _scopes.TryRemove(new KeyValuePair<string, Lazy<Task<AsyncServiceScope>>>(projectId, scope));
            throw;
        }
    }

    /// <summary>The services of an open project.</summary>
    /// <exception cref="InvalidOperationException">If the project is not open.</exception>
    public async Task<IServiceProvider> Get(string projectId)
    {
        if (!_scopes.TryGetValue(projectId, out var scope)) throw new InvalidOperationException($"Project {projectId} is not open");
        return (await scope.Value).ServiceProvider;
    }

    /// <summary>The repository of an open project.</summary>
    /// <exception cref="InvalidOperationException">If the project is not open.</exception>
    public async Task<AnalysisRepository> Repository(string projectId) =>
        (await Get(projectId)).GetRequiredService<AnalysisRepository>();

    public bool IsOpen(string projectId) => _scopes.ContainsKey(projectId);

    /// <summary>Closes a project, disposing its scope. Closing one not open does nothing.</summary>
    public async Task Close(string projectId)
    {
        if (!_scopes.TryRemove(projectId, out var scope)) return;
        await (await scope.Value).DisposeAsync();
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var projectId in _scopes.Keys) await Close(projectId);
    }

    private async Task<AsyncServiceScope> OpenScope(string projectId, string dbPath)
    {
        var scope = rootServices.CreateAsyncScope();
        try
        {
            scope.ServiceProvider.GetRequiredService<CurrentProject>().Set(projectId, dbPath);
            var db = scope.ServiceProvider.GetRequiredService<InterlinearizerCrdtDbContext>();
            await db.Database.MigrateAsync();
            return scope;
        }
        catch
        {
            await scope.DisposeAsync();
            throw;
        }
    }
}
