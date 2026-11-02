using System.Text;

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
    /// The form under which token and phrase analyses of one spelling are found: NFC and
    /// lowercase, as the WebView normalizes them.
    /// </summary>
    public static string NormalizeSurfaceForm(string text) =>
        text.Normalize(NormalizationForm.FormC).ToLowerInvariant().Normalize(NormalizationForm.FormC);
}
