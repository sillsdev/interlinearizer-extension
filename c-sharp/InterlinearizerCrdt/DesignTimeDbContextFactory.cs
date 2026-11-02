using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.DependencyInjection;

namespace Interlinearizer.Crdt;

/// <summary>
/// How <c>dotnet ef</c> builds the context to scaffold a migration: the host's container as
/// <c>Program</c> builds it, over a database no one opens.
/// </summary>
public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<InterlinearizerCrdtDbContext>
{
    public InterlinearizerCrdtDbContext CreateDbContext(string[] args)
    {
        var services = new ServiceCollection()
            .AddSingleton(new ClientIdentity(Guid.Empty))
            .AddInterlinearizerCrdt()
            .BuildServiceProvider();
        var scope = services.CreateScope();
        scope.ServiceProvider.GetRequiredService<CurrentProject>().Set("design", "design.sqlite");
        return scope.ServiceProvider.GetRequiredService<InterlinearizerCrdtDbContext>();
    }
}
