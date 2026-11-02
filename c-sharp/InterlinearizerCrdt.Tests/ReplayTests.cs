using Microsoft.EntityFrameworkCore;

namespace Interlinearizer.Crdt.Tests;

/// <summary>
/// Snapshots are a cache of replay: regenerating them from the whole history must land on the
/// same entities the incremental writes produced.
/// </summary>
public class ReplayTests : CrdtTestBase
{
    [Test]
    public async Task RegeneratingSnapshotsReproducesEveryEntity()
    {
        var segmentId = Guid.NewGuid();
        var tokenId = Guid.NewGuid();
        var phraseId = Guid.NewGuid();
        var deletedTokenId = Guid.NewGuid();
        var tokenLinkId = Guid.NewGuid();
        var orphanLinkId = Guid.NewGuid();

        await WriteNextChange([
            Fixtures.CreateSegmentAnalysis(segmentId),
            Fixtures.CreateTokenAnalysis(tokenId),
            Fixtures.CreateTokenAnalysis(deletedTokenId),
            Fixtures.CreatePhraseAnalysis(phraseId),
        ]);
        await WriteNextChange([
            Fixtures.CreateSegmentAnalysisLink(Guid.NewGuid(), segmentId),
            Fixtures.CreateTokenAnalysisLink(tokenLinkId, tokenId),
            Fixtures.CreateTokenAnalysisLink(orphanLinkId, deletedTokenId),
            Fixtures.CreatePhraseAnalysisLink(Guid.NewGuid(), phraseId),
        ]);
        await WriteNextChange([
            Fixtures.ReplaceTokenAnalysis(tokenId),
            Fixtures.ReplaceTokenAnalysisLink(tokenLinkId, tokenId),
            new DeleteChange<TokenAnalysis>(deletedTokenId),
        ]);

        var before = await DataModel.GetProjectSnapshot(includeDeleted: true);
        await DataModel.RegenerateSnapshots();
        var after = await DataModel.GetProjectSnapshot(includeDeleted: true);

        await Assert.That(after.Snapshots.Keys).IsEquivalentTo(before.Snapshots.Keys);
        foreach (var (entityId, snapshot) in before.Snapshots)
        {
            var regenerated = after.Snapshots[entityId];
            await Assert.That(regenerated.EntityIsDeleted).IsEqualTo(snapshot.EntityIsDeleted);
            await Assert.That(regenerated.TypeName).IsEqualTo(snapshot.TypeName);
        }

        var orphan = await DataModel.GetLatest<TokenAnalysisLink>(orphanLinkId);
        await Assert.That(orphan!.DeletedAt).IsNotNull();
        await Assert.That(await DbContext.TokenAnalyses.CountAsync()).IsEqualTo(1);
        await Assert.That(await DbContext.TokenAnalysisLinks.CountAsync()).IsEqualTo(1);
    }
}
