using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SIL.Harmony;

namespace Interlinearizer.Crdt;

/// <summary>
/// Shares a source's Harmony commits through files that every clone of the source receives. Each
/// client writes only files of its own, so a merge that keeps one side of a file whole never meets
/// two clients' edits to it.
/// <para>
/// A client's commits go in chunks under <c>commits/&lt;client id&gt;/</c>, written oldest first
/// and never changed. A chunk is a JSON array of commits, named after the time of its newest
/// commit. The names alone tell which commits a client has exported, and which chunks a database
/// lacks. Only a single commit can make a chunk too long for one file. That chunk is split into
/// parts named <c>&lt;time&gt;.&lt;part&gt;-of-&lt;parts&gt;.json</c>.
/// </para>
/// <para>
/// Call only from work that <see cref="OpenSources.Exclusive"/> runs for the source, because its
/// database allows no overlapping operations.
/// </para>
/// </summary>
public partial class CommitFileSync(
    DataModel dataModel,
    InterlinearizerCrdtDbContext db,
    ClientIdentity client,
    ICommitFiles files,
    JsonSerializerOptions harmonyJson,
    int maxFileChars = CommitFileSync.DefaultMaxFileChars)
{
    /// <summary>
    /// How many characters a file holds at most, by default. It keeps every file under the size at
    /// which Mercurial warns about large files, and well within one Platform.Bible network message.
    /// </summary>
    public const int DefaultMaxFileChars = 8_000_000;

    private const string Folder = "commits";

    /// <summary>
    /// Writes this client's commits that no chunk holds yet, as new chunks. A chunk that an earlier
    /// export left missing a part is written again.
    /// </summary>
    /// <returns>How many commits were written.</returns>
    public async Task<int> Export()
    {
        var exported = (await Chunks()).Where(c => c.ClientId == client.Id && c.Complete).Max(c => c.Newest);
        var commits = db.Commits.AsNoTracking().Include(c => c.ChangeEntities).Where(c => c.ClientId == client.Id);
        if (exported is not null)
        {
            var dateTime = exported.DateTime;
            var counter = exported.Counter;
            commits = commits.Where(c => c.HybridDateTime.DateTime > dateTime
                || (c.HybridDateTime.DateTime == dateTime && c.HybridDateTime.Counter > counter));
        }

        var written = 0;
        var chunk = new List<string>();
        // Counts the array's brackets and commas as well as its commits.
        var chunkChars = 1;
        HybridDateTime? newest = null;
        await foreach (var commit in commits.DefaultOrder().AsAsyncEnumerable())
        {
            var json = JsonSerializer.Serialize(commit, harmonyJson);
            if (chunk.Count > 0 && chunkChars + json.Length + 1 > maxFileChars)
            {
                await Write(chunk, newest!);
                written += chunk.Count;
                chunk.Clear();
                chunkChars = 1;
            }
            chunk.Add(json);
            chunkChars += json.Length + 1;
            newest = commit.HybridDateTime;
        }
        if (chunk.Count > 0)
        {
            await Write(chunk, newest!);
            written += chunk.Count;
        }
        return written;
    }

    /// <summary>
    /// Adds to the database every client's commits from the chunks it lacks, this client's
    /// included, in one transaction. A chunk missing a part waits, with the later chunks of its
    /// client, until every part is stored.
    /// </summary>
    /// <returns>How many commits were in the chunks it read.</returns>
    /// <exception cref="JsonException">
    /// If a chunk cannot be read, as when a newer build wrote a change type this one does not
    /// know. Nothing is added.
    /// </exception>
    public async Task<int> Import()
    {
        var commits = new List<Commit>();
        foreach (var clientChunks in (await Chunks()).GroupBy(c => c.ClientId))
        {
            var stored = await db.Commits.AsNoTracking()
                .Where(c => c.ClientId == clientChunks.Key)
                .DefaultOrderDescending()
                .Select(c => c.HybridDateTime)
                .FirstOrDefaultAsync();
            // Reading past a chunk missing a part would lose that chunk: later imports skip every
            // chunk older than the newest commit stored.
            var unread = clientChunks.Where(c => stored is null || c.Newest.CompareTo(stored) > 0).TakeWhile(c => c.Complete);
            foreach (var chunk in unread)
            {
                var json = new StringBuilder();
                foreach (var file in chunk.Files) json.Append(await files.Read(file.Name));
                commits.AddRange(JsonSerializer.Deserialize<List<Commit>>(json.ToString(), harmonyJson)
                    ?? throw new JsonException($"Chunk {chunk.Files[0].Name} holds no commits"));
            }
        }
        if (commits.Count > 0) await ((ISyncable)dataModel).AddRangeFromSync(commits);
        return commits.Count;
    }

    private async Task Write(List<string> commits, HybridDateTime newest)
    {
        var json = $"[{string.Join(',', commits)}]";
        var name = $"{Folder}/{client.Id}/{newest.DateTime.UtcTicks}-{newest.Counter}";
        if (json.Length <= maxFileChars)
        {
            await files.Write($"{name}.json", json);
            return;
        }
        var parts = new List<string>();
        for (var start = 0; start < json.Length;)
        {
            var length = Math.Min(maxFileChars, json.Length - start);
            // A part ending inside a surrogate pair could not be written as UTF-8.
            if (start + length < json.Length && char.IsHighSurrogate(json[start + length - 1])) length--;
            parts.Add(json.Substring(start, length));
            start += length;
        }
        for (var part = 0; part < parts.Count; part++) await files.Write($"{name}.{part + 1}-of-{parts.Count}.json", parts[part]);
    }

    /// <summary>Every chunk stored, oldest first. Files not named as chunks are skipped.</summary>
    private async Task<List<Chunk>> Chunks() =>
    [
        .. (await files.List())
            .Select(ChunkFile.Parse)
            .OfType<ChunkFile>()
            .GroupBy(f => (f.ClientId, f.Newest))
            .Select(g => new Chunk(g.Key.ClientId, g.Key.Newest, [.. g.OrderBy(f => f.Part)]))
            .OrderBy(c => c.Newest),
    ];

    [GeneratedRegex(@"^(\d+)-(\d+)(?:\.(\d+)-of-(\d+))?\.json$")]
    private static partial Regex ChunkFileName();

    /// <param name="ClientId">The client whose commits the chunk holds.</param>
    /// <param name="Newest">The time of the chunk's newest commit.</param>
    /// <param name="Files">The chunk's stored files, in part order.</param>
    private record Chunk(Guid ClientId, HybridDateTime Newest, List<ChunkFile> Files)
    {
        /// <summary>Whether every part is stored. An export that stops partway leaves some out.</summary>
        public bool Complete => Files.Select((f, i) => f.Part == i + 1 && f.Parts == Files.Count).All(matches => matches);
    }

    /// <param name="Name">The file's name in the store.</param>
    /// <param name="ClientId">The client whose commits the file holds.</param>
    /// <param name="Newest">The time of the newest commit in the file's chunk.</param>
    /// <param name="Part">Which part of its chunk the file holds, counting from 1.</param>
    /// <param name="Parts">How many files hold the chunk.</param>
    private record ChunkFile(string Name, Guid ClientId, HybridDateTime Newest, int Part, int Parts)
    {
        public static ChunkFile? Parse(string name)
        {
            if (name.Split('/') is not [Folder, var clientId, var file] || !Guid.TryParse(clientId, out var id)) return null;
            var match = ChunkFileName().Match(file);
            if (!match.Success
                || !long.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var utcTicks)
                || !long.TryParse(match.Groups[2].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var counter))
            {
                return null;
            }
            var newest = new HybridDateTime(new DateTimeOffset(utcTicks, TimeSpan.Zero), counter);
            if (!match.Groups[3].Success) return new ChunkFile(name, id, newest, 1, 1);
            return int.TryParse(match.Groups[3].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var part)
                && int.TryParse(match.Groups[4].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var parts)
                    ? new ChunkFile(name, id, newest, part, parts)
                    : null;
        }
    }
}
