namespace Interlinearizer.Crdt.Changes;

/// <summary>The comparisons a patch is built from.</summary>
internal static class Patches
{
    public static bool Changed<T>(T stored, T put) => !EqualityComparer<T>.Default.Equals(stored, put);

    /// <summary>Lists differ unless they hold equal items in the same order; two nulls are equal.</summary>
    public static bool ListChanged<T>(IReadOnlyList<T>? stored, IReadOnlyList<T>? put)
    {
        if (ReferenceEquals(stored, put)) return false;
        if (stored is null || put is null) return true;
        return !stored.SequenceEqual(put);
    }
}
