namespace Interlinearizer.Crdt;

/// <summary>
/// The id Harmony tells this installation's commits apart by. One per data directory, minted on
/// first use and kept for the installation's lifetime.
/// </summary>
public record ClientIdentity(Guid Id)
{
    private const string FileName = "client-id";

    /// <summary>
    /// The identity stored in <paramref name="dataDirectory"/>, or a new one written there. The
    /// directory is created when missing.
    /// </summary>
    public static ClientIdentity Load(string dataDirectory)
    {
        Directory.CreateDirectory(dataDirectory);
        var path = Path.Combine(dataDirectory, FileName);
        if (File.Exists(path) && Guid.TryParse(File.ReadAllText(path).Trim(), out var stored)) return new(stored);
        var fresh = Guid.NewGuid();
        File.WriteAllText(path, fresh.ToString());
        return new(fresh);
    }
}
