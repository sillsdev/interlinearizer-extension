using System.Collections.Frozen;
using System.Text;
using System.Text.Json;

namespace Interlinearizer.Crdt.Entities;

/// <summary>Derivations from the text layer's ids that the entities keep as queryable columns.</summary>
public static class Refs
{
    /// <summary>
    /// The book code a segment id or token ref starts with, both formatted
    /// <c>"&lt;book&gt; &lt;chapter&gt;:&lt;verse&gt;[/&lt;heading&gt;][:&lt;charStart&gt;]"</c>.
    /// A ref with no space is its own book code.
    /// </summary>
    public static string BookOf(string reference)
    {
        var spaceIndex = reference.IndexOf(' ');
        return spaceIndex == -1 ? reference : reference[..spaceIndex];
    }

    /// <summary>
    /// The form under which token and phrase analyses of one spelling are found: NFC and Unicode
    /// simple case folded, as the WebView normalizes them, from the same Unicode table.
    /// </summary>
    public static string NormalizeSurfaceForm(string text)
    {
        var composed = text.Normalize(NormalizationForm.FormC);
        StringBuilder? folded = null;
        var copiedTo = 0;
        var index = 0;
        Span<char> encoded = stackalloc char[2];
        foreach (var rune in composed.EnumerateRunes())
        {
            if (SimpleCaseFolds.TryGetValue(rune.Value, out var fold))
            {
                folded ??= new StringBuilder(composed.Length);
                folded.Append(composed, copiedTo, index - copiedTo);
                folded.Append(encoded[..new Rune(fold).EncodeToUtf16(encoded)]);
                copiedTo = index + rune.Utf16SequenceLength;
            }
            index += rune.Utf16SequenceLength;
        }
        if (folded is null) return composed;
        folded.Append(composed, copiedTo, composed.Length - copiedTo);
        return folded.ToString().Normalize(NormalizationForm.FormC);
    }

    private static readonly FrozenDictionary<int, int> SimpleCaseFolds = LoadSimpleCaseFolds();

    private static FrozenDictionary<int, int> LoadSimpleCaseFolds()
    {
        using var stream = typeof(Refs).Assembly.GetManifestResourceStream("case-folding.json")
            ?? throw new InvalidOperationException("The case folding table is not embedded in the assembly.");
        var table = JsonSerializer.Deserialize<CaseFoldingTable>(stream, JsonSerializerOptions.Web)!;
        return table.Folds.ToFrozenDictionary(pair => pair[0], pair => pair[1]);
    }

    private sealed record CaseFoldingTable(int[][] Folds);
}
