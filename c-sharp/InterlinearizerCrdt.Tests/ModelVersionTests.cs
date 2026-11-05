using SIL.Harmony.Config;

namespace Interlinearizer.Crdt.Tests;

/// <summary>
/// Released model versions must never change, only grow at the end. This pins the description
/// so that a change to it is a reviewable diff; it rewrites the pin, so a committed rewrite passes
/// and review must catch an edited released version. Harmony refuses one at runtime, against the
/// versions a database has applied.
/// </summary>
public class ModelVersionTests
{
    [Test]
    [NotInParallel]
    public async Task ModelVersionsMatchThePinnedDescription()
    {
        var config = new HarmonyConfig();
        InterlinearizerCrdtKernel.ConfigureHarmony(config);
        var expected = config.DescribeModelVersions().ReplaceLineEndings("\n").TrimEnd('\n') + "\n";

        var path = Path.Combine(ChangeSerializationTests.SerializedChangesDirectory(), ChangeSerializationTests.ModelVersionsFile);
        var stored = ChangeSerializationTests.ReadStored(path);
        var written = ChangeSerializationTests.WriteIfChanged(path, stored, expected);

        await Assert.That(stored).IsEqualTo(expected).Because(ChangeSerializationTests.OutOfDateMessage(path, written));
    }
}
