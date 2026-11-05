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
        var folded = new StringBuilder(composed.Length);
        foreach (var rune in composed.EnumerateRunes())
        {
            folded.Append(SimpleCaseFolds.Value.TryGetValue(rune.Value, out var fold) ? new Rune(fold) : rune);
        }
        return folded.ToString().Normalize(NormalizationForm.FormC);
    }

    private static readonly Lazy<Dictionary<int, int>> SimpleCaseFolds = new(LoadSimpleCaseFolds);

    private static Dictionary<int, int> LoadSimpleCaseFolds()
    {
        using var stream = typeof(Refs).Assembly.GetManifestResourceStream("case-folding.json")
            ?? throw new InvalidOperationException("The case folding table is not embedded in the assembly.");
        using var document = JsonDocument.Parse(stream);
        return document.RootElement.GetProperty("folds").EnumerateArray()
            .ToDictionary(pair => pair[0].GetInt32(), pair => pair[1].GetInt32());
    }
}
