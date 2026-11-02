namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// A string value keyed by BCP 47 writing-system tag. A missing key means no value in that
/// language.
/// </summary>
public class MultiString : Dictionary<string, string>
{
    public MultiString()
    {
    }

    public MultiString(IDictionary<string, string> values) : base(values)
    {
    }

    public MultiString Copy() => new(this);

    /// <summary>Whether two maps hold the same keys with the same values; two nulls are equal.</summary>
    public static bool ContentEquals(IReadOnlyDictionary<string, string>? a, IReadOnlyDictionary<string, string>? b)
    {
        if (ReferenceEquals(a, b)) return true;
        if (a is null || b is null) return false;
        return a.Count == b.Count && a.All(pair => b.TryGetValue(pair.Key, out var value) && value == pair.Value);
    }

    /// <summary>
    /// <paramref name="map"/>, or null when it has no keys, because absence is how a missing value
    /// is stored.
    /// </summary>
    public static T? NullIfEmpty<T>(T? map) where T : class, IReadOnlyDictionary<string, string> =>
        map is { Count: > 0 } ? map : null;

    /// <summary>
    /// <paramref name="current"/> with <paramref name="patch"/> merged in: each key the patch
    /// names is set to its value, or removed when that value is null. Keys the patch leaves out
    /// stay as they are. A result with no keys is null, since absence is how a missing value is
    /// stored.
    /// </summary>
    public static MultiString? Patch(MultiString? current, IReadOnlyDictionary<string, string?> patch)
    {
        var merged = Merge(current, patch);
        return merged is null ? null : new MultiString(merged);
    }

    /// <summary>The <see cref="Patch(MultiString?, IReadOnlyDictionary{string, string?})"/> rule for a plain map.</summary>
    public static Dictionary<string, string>? Merge(IReadOnlyDictionary<string, string>? current, IReadOnlyDictionary<string, string?> patch)
    {
        var merged = current is null ? new Dictionary<string, string>() : new Dictionary<string, string>(current);
        foreach (var (key, value) in patch)
        {
            if (value is null) merged.Remove(key);
            else merged[key] = value;
        }
        return merged.Count == 0 ? null : merged;
    }
}

/// <summary>
/// Per-key changes to a <see cref="MultiString"/> or feature map: a key's new value, or null to
/// remove the key. Keys left out are left alone.
/// </summary>
public class MultiStringPatch : Dictionary<string, string?>
{
    public MultiStringPatch()
    {
    }

    public MultiStringPatch(IDictionary<string, string?> values) : base(values)
    {
    }

    /// <summary>
    /// The patch that takes <paramref name="from"/> to <paramref name="to"/>: each key added or
    /// changed, and null for each key removed. Null when the two hold the same content.
    /// </summary>
    public static MultiStringPatch? Diff(IReadOnlyDictionary<string, string>? from, IReadOnlyDictionary<string, string>? to)
    {
        var patch = new MultiStringPatch();
        if (to is not null)
        {
            foreach (var (key, value) in to)
            {
                if (from is null || !from.TryGetValue(key, out var old) || old != value) patch[key] = value;
            }
        }
        if (from is not null)
        {
            foreach (var key in from.Keys)
            {
                if (to is null || !to.ContainsKey(key)) patch[key] = null;
            }
        }
        return patch.Count == 0 ? null : patch;
    }
}
