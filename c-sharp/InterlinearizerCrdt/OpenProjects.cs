using System.Collections.Concurrent;
using Interlinearizer.Crdt.Changes;
using Interlinearizer.Crdt.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SIL.Harmony;

namespace Interlinearizer.Crdt;

/// <summary>
/// The projects the host has open, one DI scope each. A scope holds the project's Harmony
/// services over its own database and lives from <see cref="Open"/> to <see cref="Close"/>;
/// requests never create scopes. Until a database is addressed by the Paratext project it
/// represents, each holds the one interlinear project it is opened as, created on first open.
/// </summary>
public sealed class OpenProjects(IServiceProvider rootServices) : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, Lazy<Task<AsyncServiceScope>>> _scopes = new();

    /// <summary>
    /// Opens <paramref name="projectId"/> over the database at <paramref name="dbPath"/>, created
    /// when missing and brought up to the current schema when behind. Opening a project already
    /// open returns its services. Two concurrent opens of one project share one scope.
    /// </summary>
    /// <exception cref="ArgumentException">If the project id is not a GUID.</exception>
    /// <exception cref="InvalidOperationException">
    /// If the project is already open over a different database.
    /// </exception>
    public async Task<IServiceProvider> Open(string projectId, string dbPath)
    {
        var id = ParseProjectId(projectId);
        var scope = _scopes.GetOrAdd(projectId, _ => new Lazy<Task<AsyncServiceScope>>(() => OpenScope(id, projectId, dbPath)));
        IServiceProvider services;
        try
        {
            services = (await scope.Value).ServiceProvider;
        }
        catch
        {
            _scopes.TryRemove(new KeyValuePair<string, Lazy<Task<AsyncServiceScope>>>(projectId, scope));
            throw;
        }
        var openPath = services.GetRequiredService<CurrentProject>().DbPath;
        if (Path.GetFullPath(openPath) != Path.GetFullPath(dbPath)) throw new InvalidOperationException($"Project {projectId} is already open over {openPath}");
        return services;
    }

    /// <summary>The services of an open project.</summary>
    /// <exception cref="InvalidOperationException">If the project is not open.</exception>
    public async Task<IServiceProvider> Get(string projectId)
    {
        if (!_scopes.TryGetValue(projectId, out var scope)) throw new InvalidOperationException($"Project {projectId} is not open");
        return (await scope.Value).ServiceProvider;
    }

    /// <summary>The repository of an open project, over that project's records.</summary>
    /// <exception cref="InvalidOperationException">If the project is not open.</exception>
    public async Task<AnalysisRepository> Repository(string projectId)
    {
        var services = await Get(projectId);
        return new AnalysisRepository(
            services.GetRequiredService<DataModel>(),
            services.GetRequiredService<ClientIdentity>(),
            ParseProjectId(projectId));
    }

    /// <summary>The projects of an open project's database.</summary>
    /// <exception cref="InvalidOperationException">If the project is not open.</exception>
    public async Task<InterlinearProjects> Projects(string projectId) => Projects(await Get(projectId));

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

    private static InterlinearProjects Projects(IServiceProvider services) => new(
        services.GetRequiredService<DataModel>(),
        services.GetRequiredService<InterlinearizerCrdtDbContext>(),
        services.GetRequiredService<ClientIdentity>());

    private static Guid ParseProjectId(string projectId) =>
        Guid.TryParse(projectId, out var id) ? id : throw new ArgumentException($"Project ids are GUIDs, not {projectId}", nameof(projectId));

    private async Task<AsyncServiceScope> OpenScope(Guid id, string projectId, string dbPath)
    {
        var scope = rootServices.CreateAsyncScope();
        try
        {
            scope.ServiceProvider.GetRequiredService<CurrentProject>().Set(projectId, dbPath);
            var db = scope.ServiceProvider.GetRequiredService<InterlinearizerCrdtDbContext>();
            await db.Database.MigrateAsync();
            var projects = Projects(scope.ServiceProvider);
            if (!await projects.HasBeenStored(id)) await projects.Create(new InterlinearProject { Id = id });
            return scope;
        }
        catch
        {
            await scope.DisposeAsync();
            throw;
        }
    }
}
