namespace Interlinearizer.Crdt;

/// <summary>
/// The source project a DI scope serves. Scoped: <see cref="OpenSources"/> sets it when it opens
/// the scope, before anything in the scope reaches the database.
/// </summary>
public class CurrentSource
{
    private string? _sourceProjectId;
    private string? _dbPath;

    /// <summary>The Paratext project the scope's database represents.</summary>
    /// <exception cref="InvalidOperationException">If no source is set for this scope.</exception>
    public string SourceProjectId => _sourceProjectId ?? throw new InvalidOperationException("No source is open in this scope");

    /// <summary>The SQLite file Harmony stores the source's interlinear projects in.</summary>
    /// <exception cref="InvalidOperationException">If no source is set for this scope.</exception>
    public string DbPath => _dbPath ?? throw new InvalidOperationException("No source is open in this scope");

    /// <exception cref="InvalidOperationException">If this scope already serves a source.</exception>
    public void Set(string sourceProjectId, string dbPath)
    {
        if (_sourceProjectId is not null) throw new InvalidOperationException($"This scope already serves source {_sourceProjectId}");
        _sourceProjectId = sourceProjectId;
        _dbPath = dbPath;
    }
}
