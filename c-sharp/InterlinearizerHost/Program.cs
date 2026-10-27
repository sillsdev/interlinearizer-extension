using Interlinearizer.Host.Papi;
using Interlinearizer.Host.Services;

namespace Interlinearizer.Host;

/// <summary>
/// The interlinearizer's .NET process. The extension starts it on activation. It connects to
/// Platform.Bible, registers its services, and exits once the connection closes, since the platform
/// cleans up the processes extensions start only in packaged builds.
/// </summary>
internal static class Program
{
    public static async Task<int> Main()
    {
        using var papi = new PapiClient();
        try
        {
            await papi.ConnectAsync(CancellationToken.None);
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"Could not connect to Platform.Bible: {e.Message}");
            return 1;
        }

        if (!await new PingService(papi).RegisterAsync())
        {
            // Most likely another copy of this process still holds the registration.
            Console.Error.WriteLine($"Could not register {PingService.CommandName}");
            return 2;
        }

        Console.WriteLine("Interlinearizer host ready");
        await papi.DisconnectTask;
        return 0;
    }
}
