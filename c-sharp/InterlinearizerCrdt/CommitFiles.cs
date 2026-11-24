using System.Text;

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
    /// <exception cref="DecoderFallbackException">If the file is not valid UTF-8.</exception>
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
    // Throws on an unpaired surrogate or on bytes that are not valid UTF-8. Encoding.UTF8 would silently turn either into U+FFFD.
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    // Its preamble makes a reader skip a leading UTF-8 byte-order mark.
    private static readonly UTF8Encoding Utf8WithMark = new(encoderShouldEmitUTF8Identifier: true, throwOnInvalidBytes: true);

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

    public async Task<string> Read(string name)
    {
        // File.ReadAllTextAsync would switch to a lenient decoder on finding a byte-order mark.
        using var reader = new StreamReader(PathOf(name), Utf8WithMark, detectEncodingFromByteOrderMarks: false);
        return await reader.ReadToEndAsync();
    }

    public async Task Write(string name, string content)
    {
        var path = PathOf(name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        // Written aside, flushed to disk and then renamed, so that no partial file ever has the name,
        // even after a power loss.
        var written = $"{path}.tmp";
        await using (var stream = new FileStream(written, FileMode.Create, FileAccess.Write, FileShare.None, 4096, useAsync: true))
        {
            await stream.WriteAsync(Utf8.GetBytes(content));
            stream.Flush(flushToDisk: true);
        }
        File.Move(written, path, overwrite: true);
    }

    private string PathOf(string name) => Path.Combine(root, name.Replace('/', Path.DirectorySeparatorChar));
}
