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
    /// <summary>The argument naming where the host keeps its data; absent, a per-user folder.</summary>
    private const string DataDirectoryOption = "--data-dir";

    public static async Task<int> Main(string[] args)
    {
        var dataDirectory = DataDirectory(args);
        await using var services = new ServiceCollection()
            .AddSingleton(ClientIdentity.Load(dataDirectory))
            .AddInterlinearizerCrdt()
            .AddSingleton<PapiClient>()
            .AddSingleton<PingService>()
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

        Console.WriteLine("Interlinearizer host ready");
        await papi.DisconnectTask;
        // Projects still open flush before the process ends.
        await services.GetRequiredService<OpenProjects>().DisposeAsync();
        return 0;
    }

    private static string DataDirectory(string[] args)
    {
        var index = Array.IndexOf(args, DataDirectoryOption);
        if (index >= 0 && index + 1 < args.Length) return args[index + 1];
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "interlinearizer");
    }
}
