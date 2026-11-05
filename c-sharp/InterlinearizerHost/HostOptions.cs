namespace Interlinearizer.Host;

/// <summary>What the host's command line sets.</summary>
/// <param name="DataDirectory">Where the host keeps its client id and its project databases.</param>
/// <param name="PapiPort">The local port the Platform.Bible network listens on.</param>
public record HostOptions(string DataDirectory, int PapiPort)
{
    /// <summary>The argument naming where the host keeps its data; absent, a per-user folder.</summary>
    public const string DataDirectoryOption = "--data-dir";

    /// <summary>The argument naming the network's port; absent, the port Platform.Bible uses.</summary>
    public const string PapiPortOption = "--papi-port";

    public const int DefaultPapiPort = 8876;

    /// <exception cref="ArgumentException">If a port argument is not a number.</exception>
    public static HostOptions Parse(string[] args)
    {
        var dataDirectory = ValueOf(args, DataDirectoryOption)
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "interlinearizer");
        var port = ValueOf(args, PapiPortOption);
        if (port is null) return new HostOptions(dataDirectory, DefaultPapiPort);
        if (!int.TryParse(port, out var papiPort)) throw new ArgumentException($"{PapiPortOption} needs a port number, not {port}");
        return new HostOptions(dataDirectory, papiPort);
    }

    private static string? ValueOf(string[] args, string option)
    {
        var index = Array.IndexOf(args, option);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
