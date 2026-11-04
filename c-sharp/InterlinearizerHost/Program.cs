using Interlinearizer.Crdt;
using Interlinearizer.Host.Papi;
using Interlinearizer.Host.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Interlinearizer.Host;

/// <summary>
/// The interlinearizer's .NET process. The extension starts it on activation. It connects to
/// Platform.Bible, registers its services, and exits once the connection closes, since the platform
/// cleans up the processes extensions start only in packaged builds.
/// </summary>
internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        HostOptions options;
        try
        {
            options = HostOptions.Parse(args);
        }
        catch (ArgumentException e)
        {
            Console.Error.WriteLine(e.Message);
            return 3;
        }
        await using var services = new ServiceCollection()
            .AddSingleton(options)
            .AddSingleton(ClientIdentity.Load(options.DataDirectory))
            .AddSingleton(new SourcesDirectory(Path.Combine(options.DataDirectory, "sources")))
            .AddInterlinearizerCrdt()
            .AddSingleton<PapiClient>()
            .AddSingleton<PingService>()
            .AddSingleton<RepositoryService>()
            .BuildServiceProvider();

        var papi = services.GetRequiredService<PapiClient>();
        try
        {
            await papi.ConnectAsync(CancellationToken.None);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"Could not connect to Platform.Bible: {e.Message}");
            return 1;
        }

        if (!await services.GetRequiredService<PingService>().RegisterAsync())
        {
            // Most likely another copy of this process still holds the registration.
            Console.Error.WriteLine($"Could not register {PingService.CommandName}");
            return 2;
        }
        if (!await services.GetRequiredService<RepositoryService>().RegisterAsync())
        {
            Console.Error.WriteLine("Could not register the repository commands");
            return 2;
        }

        Console.WriteLine("Interlinearizer host ready");
        await papi.DisconnectTask;
        // Sources still open flush before the process ends.
        await services.GetRequiredService<OpenSources>().DisposeAsync();
        return 0;
    }
}
