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
/// parts named <c>&lt;time&gt;.&lt;part&gt;-of-&lt;parts&gt;.json</c>. What each part holds depends
/// only on the commit and the number of parts.
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

    // Parts aim one character under the limit, so a limit under two leaves them no room.
    private readonly int maxFileChars = maxFileChars >= 2
        ? maxFileChars
        : throw new ArgumentOutOfRangeException(nameof(maxFileChars), maxFileChars, "A file must hold at least two characters");

    /// <summary>
    /// Writes this client's commits that no chunk holds yet, as new chunks. Before that, it writes
    /// any parts that an earlier export left out of a chunk.
    /// </summary>
    /// <returns>How many commits were written.</returns>
    /// <exception cref="InvalidDataException">
    /// If a chunk's missing parts cannot be written to match its stored ones, as when a build that
    /// serializes commits differently wrote the chunk. Nothing more is exported.
    /// </exception>
    public async Task<int> Export()
    {
        var chunks = (await Chunks()).Where(c => c.ClientId == client.Id).ToList();
        var written = 0;
        // A chunk missing a part is made whole first. Otherwise a later chunk could also take the
        // broken chunk's commit. The cutoff would then pass the broken chunk for good.
        foreach (var broken in chunks.Where(c => !c.Complete))
        {
            await WriteMissingParts(broken);
            written++;
        }

        var exported = chunks.Max(c => c.Newest);
        var commits = db.Commits.AsNoTracking().Include(c => c.ChangeEntities).Where(c => c.ClientId == client.Id);
        if (exported is not null)
        {
            var dateTime = exported.DateTime;
            var counter = exported.Counter;
            commits = commits.Where(c => c.HybridDateTime.DateTime > dateTime
                || (c.HybridDateTime.DateTime == dateTime && c.HybridDateTime.Counter > counter));
        }

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
            var chunks = clientChunks.ToList();
            var read = chunks.Count;
            while (read > 0 && !await Stored(clientChunks.Key, chunks[read - 1].Newest)) read--;
            // Reading past a chunk missing a part would lose that chunk: later imports skip every
            // chunk older than the newest one stored.
            var unread = chunks.Skip(read).TakeWhile(c => c.Complete);
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

    /// <summary>Whether the database holds the commit that <paramref name="clientId"/> made at <paramref name="time"/>.</summary>
    private Task<bool> Stored(Guid clientId, HybridDateTime time) =>
        // Looks up one time, which the database indexes, rather than a client's newest commit, which scans every newer commit.
        db.Commits.AnyAsync(c => c.HybridDateTime.DateTime == time.DateTime
            && c.HybridDateTime.Counter == time.Counter
            && c.ClientId == clientId);

    private async Task Write(List<string> commits, HybridDateTime newest)
    {
        var json = $"[{string.Join(',', commits)}]";
        if (json.Length <= maxFileChars)
        {
            await files.Write($"{Name(newest)}.json", json);
            return;
        }
        // Parts aim one character under the limit, because a part may start a character early to keep a surrogate pair whole.
        var parts = Split(json, (json.Length + maxFileChars - 2) / (maxFileChars - 1));
        for (var part = 1; part <= parts.Count; part++) await files.Write(PartName(newest, part, parts.Count), parts[part - 1]);
    }

    /// <summary>
    /// Writes the parts that <paramref name="chunk"/> lacks. A chunk in parts holds one commit, the
    /// one at the chunk's time.
    /// </summary>
    /// <exception cref="InvalidDataException">If a stored part no longer matches the commit.</exception>
    private async Task WriteMissingParts(Chunk chunk)
    {
        var newest = chunk.Newest;
        var commit = await db.Commits.AsNoTracking().Include(c => c.ChangeEntities)
            .SingleAsync(c => c.ClientId == client.Id
                && c.HybridDateTime.DateTime == newest.DateTime
                && c.HybridDateTime.Counter == newest.Counter);
        var parts = Split($"[{JsonSerializer.Serialize(commit, harmonyJson)}]", chunk.Files[0].Parts);
        foreach (var file in chunk.Files)
        {
            if (file.Parts != parts.Count || await files.Read(file.Name) != parts[file.Part - 1])
            {
                throw new InvalidDataException($"Chunk file {file.Name} no longer matches its commit, so the chunk's other parts cannot be written");
            }
        }
        foreach (var part in Enumerable.Range(1, parts.Count).Except(chunk.Files.Select(f => f.Part)))
        {
            await files.Write(PartName(newest, part, parts.Count), parts[part - 1]);
        }
    }

    /// <summary>Splits <paramref name="json"/> into <paramref name="count"/> parts of equal length, give or take one character.</summary>
    private static List<string> Split(string json, int count)
    {
        var cuts = new int[count + 1];
        for (var part = 1; part <= count; part++)
        {
            var cut = (int)((long)json.Length * part / count);
            // A part ending inside a surrogate pair could not be written as UTF-8.
            cuts[part] = cut < json.Length && char.IsHighSurrogate(json[cut - 1]) ? cut - 1 : cut;
        }
        return [.. Enumerable.Range(0, count).Select(part => json[cuts[part]..cuts[part + 1]])];
    }

    private string Name(HybridDateTime newest) => $"{Folder}/{client.Id}/{newest.DateTime.UtcTicks}-{newest.Counter}";

    private string PartName(HybridDateTime newest, int part, int parts) => $"{Name(newest)}.{part}-of-{parts}.json";

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
                && part >= 1 && part <= parts
                    ? new ChunkFile(name, id, newest, part, parts)
                    : null;
        }
    }
}
