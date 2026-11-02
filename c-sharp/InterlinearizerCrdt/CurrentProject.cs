namespace Interlinearizer.Crdt;

/// <summary>
/// The project a DI scope serves. Scoped: <see cref="OpenProjects"/> sets it when it opens the
/// scope, before anything in the scope reaches the database.
/// </summary>
public class CurrentProject
{
    private string? _projectId;
    private string? _dbPath;

    /// <summary>The interlinear project's id.</summary>
    public string ProjectId => _projectId ?? throw new InvalidOperationException("No project is open in this scope");

    /// <summary>The SQLite file Harmony stores the project's analysis in.</summary>
    public string DbPath => _dbPath ?? throw new InvalidOperationException("No project is open in this scope");

    public void Set(string projectId, string dbPath)
    {
        if (_projectId is not null) throw new InvalidOperationException($"This scope already serves project {_projectId}");
        _projectId = projectId;
        _dbPath = dbPath;
    }
}

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
