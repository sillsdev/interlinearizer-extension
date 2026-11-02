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
    /// A patch setting every key of <paramref name="values"/>, removing none; null when there are
    /// no values, so that the patch changes nothing.
    /// </summary>
    public static MultiStringPatch? Of(IReadOnlyDictionary<string, string>? values)
    {
        if (values is null) return null;
        var patch = new MultiStringPatch();
        foreach (var (key, value) in values) patch[key] = value;
        return patch;
    }
}
