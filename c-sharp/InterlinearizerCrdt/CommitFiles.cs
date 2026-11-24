namespace Interlinearizer.Crdt;

/// <summary>
/// The named text files a source project shares with every clone of it, such as its extension
/// data. A name is a relative path with forward slashes.
/// </summary>
public interface ICommitFiles
{
    /// <summary>The names of every file stored.</summary>
    Task<IReadOnlyList<string>> List();

    /// <exception cref="IOException">If no file is stored under <paramref name="name"/>.</exception>
    Task<string> Read(string name);

    /// <summary>
    /// Stores <paramref name="content"/> under <paramref name="name"/>, replacing any file stored
    /// there. A write that fails or stops partway leaves the file as it was.
    /// </summary>
    Task Write(string name, string content);
}

/// <summary>Commit files kept in a folder on disk, one file per name.</summary>
public class DirectoryCommitFiles(string root) : ICommitFiles
{
    public Task<IReadOnlyList<string>> List()
    {
        if (!Directory.Exists(root)) return Task.FromResult<IReadOnlyList<string>>([]);
        IReadOnlyList<string> names =
        [
            .. Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
                .Select(path => Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/'))
                .Order(StringComparer.Ordinal),
        ];
        return Task.FromResult(names);
    }

    public Task<string> Read(string name) => File.ReadAllTextAsync(PathOf(name));

    public async Task Write(string name, string content)
    {
        var path = PathOf(name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        // Written aside and then renamed, so that no partial file ever has the name.
        var written = $"{path}.tmp";
        await File.WriteAllTextAsync(written, content);
        File.Move(written, path, overwrite: true);
    }

    private string PathOf(string name) => Path.Combine(root, name.Replace('/', Path.DirectorySeparatorChar));
}
