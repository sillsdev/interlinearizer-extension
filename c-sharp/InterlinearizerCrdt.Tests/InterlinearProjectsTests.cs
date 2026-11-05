using Microsoft.EntityFrameworkCore;

namespace Interlinearizer.Crdt.Tests;

/// <summary>The projects service over a database holding the test project and the ones each test adds.</summary>
public class InterlinearProjectsTests : CrdtTestBase
{
    private readonly Guid _id = Guid.NewGuid();

    private static InterlinearProject Project(Guid id) => new()
    {
        Id = id,
        Name = "Genesis draft",
        Description = "A draft of Genesis.",
        TargetProjectId = "target-project",
        AnalysisLanguages = ["fr", "en"],
        Segmentation = new SegmentationDelta(["GEN 1:2"], [Fixtures.Token2]),
    };

    private Task<int> Commits() => DbContext.Commits.CountAsync();

    [Test]
    public async Task CreateStoresEveryFieldStampedWithTheCommitTime()
    {
        await Projects.Create(Project(_id));

        var stored = await Projects.Get(_id);
        await Assert.That(stored).IsNotNull();
        await Assert.That(stored!.Name).IsEqualTo("Genesis draft");
        await Assert.That(stored.Description).IsEqualTo("A draft of Genesis.");
        await Assert.That(stored.TargetProjectId).IsEqualTo("target-project");
        await Assert.That(stored.AnalysisLanguages).IsEquivalentTo(["fr", "en"]);
        await Assert.That(stored.Segmentation!.RemovedVerseStarts).IsEquivalentTo(["GEN 1:2"]);
        await Assert.That(stored.CreatedAt).IsEqualTo(stored.UpdatedAt);
        await Assert.That((await DbContext.Commits.ToListAsync()).MaxBy(c => c.DateTime)!.Metadata[AnalysisRepository.IntentMetadataKey])
            .IsEqualTo("createProject");
    }

    [Test]
    public async Task CreateRefusesAnIdEverStoredWritingNothing()
    {
        await Projects.Create(Project(_id));
        await Projects.Delete(_id);
        var token = new TokenAnalysis { Id = Guid.NewGuid(), SurfaceText = "and" };
        await ApplyNext(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(token) });
        var commits = await Commits();

        await Assert.That(() => Projects.Create(Project(_id))).Throws<ArgumentException>();
        await Assert.That(() => Projects.Create(Project(ProjectId))).Throws<ArgumentException>();
        await Assert.That(() => Projects.Create(Project(token.Id))).Throws<ArgumentException>();

        await Assert.That(await Commits()).IsEqualTo(commits);
    }

    [Test]
    public async Task ListsEveryProjectStoredLeavingOutDeletedOnes()
    {
        var deleted = Guid.NewGuid();
        await Projects.Create(Project(_id));
        await Projects.Create(Project(deleted));
        await Projects.Delete(deleted);

        await Assert.That((await Projects.List()).Select(p => p.Id)).IsEquivalentTo([ProjectId, _id]);
    }

    [Test]
    public async Task GetsNothingForAProjectNeverStoredOrDeleted()
    {
        await Projects.Create(Project(_id));
        await Projects.Delete(_id);

        await Assert.That(await Projects.Get(_id)).IsNull();
        await Assert.That(await Projects.Get(Guid.NewGuid())).IsNull();
    }

    [Test]
    public async Task PatchChangesTheFieldsSetLeavingTheRestAlone()
    {
        await Projects.Create(Project(_id));

        await Projects.Patch(_id, new ProjectPatch
        {
            Name = "Genesis and Exodus",
            TargetProjectId = new(null),
            AnalysisLanguages = new List<string> { "en", "de" },
        });

        var stored = (await Projects.Get(_id))!;
        await Assert.That(stored.Name).IsEqualTo("Genesis and Exodus");
        await Assert.That(stored.TargetProjectId).IsNull();
        await Assert.That(stored.Description).IsEqualTo("A draft of Genesis.");
        await Assert.That(stored.Segmentation).IsNotNull();
        await Assert.That(stored.AnalysisLanguages).IsEquivalentTo(["en", "de"]);
        await Assert.That(stored.UpdatedAt).IsGreaterThan(stored.CreatedAt);
    }

    [Test]
    public async Task PatchThatSetsNothingWritesNoCommit()
    {
        await Projects.Create(Project(_id));
        var commits = await Commits();

        await Projects.Patch(_id, new ProjectPatch());

        await Assert.That(await Commits()).IsEqualTo(commits);
    }

    [Test]
    public async Task PatchRefusesAProjectNotStored()
    {
        await Assert.That(() => Projects.Patch(Guid.NewGuid(), new ProjectPatch { Name = "x" })).Throws<ArgumentException>();
    }

    [Test]
    public async Task DeleteRemovesTheProjectAndItsRecords()
    {
        await Projects.Create(Project(_id));
        var repository = RepositoryFor(_id);
        var token = new TokenAnalysis { Id = Guid.NewGuid(), SurfaceText = "and" };
        await repository.Apply(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(token) });
        var mine = new TokenAnalysis { Id = Guid.NewGuid(), SurfaceText = "and" };
        await ApplyNext(new ChangeSet { Intent = "seed", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(mine) });

        await Projects.Delete(_id);

        await Assert.That(await Projects.Get(_id)).IsNull();
        await Assert.That(await repository.GetTokenAnalyses([token.Id])).IsEmpty();
        await Assert.That(await Repository.GetTokenAnalyses([mine.Id])).HasSingleItem();
    }

    [Test]
    public async Task DeleteOfAProjectNotStoredWritesNothing()
    {
        var commits = await Commits();

        await Projects.Delete(Guid.NewGuid());

        await Assert.That(await Commits()).IsEqualTo(commits);
    }
}
