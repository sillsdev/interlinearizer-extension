using System.Text.Json;

namespace Interlinearizer.Crdt.Tests;

public class RefsTests
{
    public record FoldCase(string Case, string Input, string Expected)
    {
        public override string ToString() => Case;
    }

    // The WebView's tests run the same fixture, so the two folds cannot drift apart
    public static IEnumerable<FoldCase> SurfaceFormFolds()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "surface-form-folds.json");
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        return JsonSerializer.Deserialize<List<FoldCase>>(File.ReadAllText(path), options)!;
    }

    [Test]
    [MethodDataSource(nameof(SurfaceFormFolds))]
    public async Task NormalizeSurfaceFormFoldsAsTheWebViewDoes(FoldCase fold)
    {
        await Assert.That(Refs.NormalizeSurfaceForm(fold.Input)).IsEqualTo(fold.Expected);
    }
}
