using Interlinearizer.Host.Papi;

namespace Interlinearizer.Host.Services;

/// <summary>
/// Answers <c>interlinearizer.csharpPing</c>, which proves the extension can reach C# code
/// through the Platform.Bible network.
/// </summary>
internal sealed class PingService(PapiClient papi)
{
    public const string CommandName = "command:interlinearizer.csharpPing";

    public Task<bool> RegisterAsync() =>
        papi.RegisterRequestHandlerAsync(CommandName, (Func<string, PingResult>)Ping);

    private static PingResult Ping(string message) =>
        new(message, Environment.Version.ToString(), Environment.ProcessId);
}
