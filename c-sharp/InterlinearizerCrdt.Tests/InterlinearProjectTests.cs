using Microsoft.EntityFrameworkCore;

namespace Interlinearizer.Crdt.Tests;

public class InterlinearProjectTests : CrdtTestBase
{
    private readonly Guid _projectId = Guid.NewGuid();
    private readonly Guid _otherProjectId = Guid.NewGuid();

    private static TokenAnalysis Token(Guid projectId) => new() { Id = Guid.NewGuid(), ProjectId = projectId, SurfaceText = "and" };

    private static TokenAnalysisLink Link(Guid projectId, Guid analysisId) => new()
    {
        Id = Guid.NewGuid(),
        ProjectId = projectId,
        AnalysisId = analysisId,
        Token = Fixtures.Token1,
        Status = AssignmentStatus.Approved,
    };

    private Task<InterlinearProject?> Project() => DataModel.GetLatest<InterlinearProject>(_projectId);

    [Test]
    public async Task CreateProjectsEveryField()
    {
        var change = Fixtures.CreateInterlinearProject(_projectId);
        var commit = await WriteNextChange(change);

        var project = await Project();
        await Assert.That(project).IsNotNull();
        await Assert.That(project!.DeletedAt).IsNull();
        await Assert.That(project.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(project.UpdatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(project.Name).IsEqualTo(change.Name);
        await Assert.That(project.Description).IsEqualTo(change.Description);
        await Assert.That(project.TargetProjectId).IsEqualTo(change.TargetProjectId);
        await Assert.That(project.AnalysisLanguages).IsEquivalentTo(["fr", "en"]);
        await Assert.That(project.Segmentation!.RemovedVerseStarts).IsEquivalentTo(["GEN 1:2"]);
        await Assert.That(project.Segmentation.AddedStarts).IsEquivalentTo([Fixtures.Token2]);
    }

    [Test]
    public async Task CreateFillsTheProjectedTable()
    {
        await WriteNextChange(Fixtures.CreateInterlinearProject(_projectId));

        var rows = await DbContext.InterlinearProjects.ToListAsync();
        await Assert.That(rows).HasSingleItem();
        await Assert.That(rows[0].AnalysisLanguages).IsEquivalentTo(["fr", "en"]);
    }

    [Test]
    public async Task PatchSetsAndClearsFieldsLeavingUnsetOnesAlone()
    {
        var created = await WriteNextChange(Fixtures.CreateInterlinearProject(_projectId));
        var patched = await WriteNextChange(Fixtures.PatchInterlinearProject(_projectId));

        var project = await Project();
        await Assert.That(project!.CreatedAt).IsEqualTo(created.DateTime);
        await Assert.That(project.UpdatedAt).IsEqualTo(patched.DateTime);
        await Assert.That(project.Name).IsEqualTo("Genesis and Exodus");
        await Assert.That(project.TargetProjectId).IsNull();
        await Assert.That(project.Description).IsEqualTo("A draft of Genesis.");
        await Assert.That(project.Segmentation).IsNotNull();
    }

    [Test]
    public async Task PatchAddsAndRemovesLanguagesLeavingOnesAlreadyThereOrAbsentAlone()
    {
        await WriteNextChange(Fixtures.CreateInterlinearProject(_projectId));

        await WriteNextChange(new PatchInterlinearProjectChange(_projectId)
        {
            AddedAnalysisLanguages = ["de", "en"],
            RemovedAnalysisLanguages = ["fr", "es"],
        });

        await Assert.That((await Project())!.AnalysisLanguages).IsEquivalentTo(["en", "de"]);
    }

    [Test]
    public async Task PatchesAddingDifferentLanguagesBothKeepTheirsInEitherCommitOrder()
    {
        await WriteNextChange(Fixtures.CreateInterlinearProject(_projectId));
        var later = await WriteNextChange(new PatchInterlinearProjectChange(_projectId) { AddedAnalysisLanguages = ["de"] });

        await WriteChangeBefore(later, new PatchInterlinearProjectChange(_projectId) { AddedAnalysisLanguages = ["es"] });

        await Assert.That((await Project())!.AnalysisLanguages).IsEquivalentTo(["fr", "en", "es", "de"]);
    }

    [Test]
    public async Task PatchClearsTheSegmentation()
    {
        await WriteNextChange(Fixtures.CreateInterlinearProject(_projectId));

        await WriteNextChange(new PatchInterlinearProjectChange(_projectId) { Segmentation = new(null) });

        await Assert.That((await Project())!.Segmentation).IsNull();
    }

    [Test]
    public async Task DeleteMarksTheProjectDeleted()
    {
        await WriteNextChange(Fixtures.CreateInterlinearProject(_projectId));
        var deleted = await WriteNextChange(new DeleteChange<InterlinearProject>(_projectId));

        await Assert.That((await Project())!.DeletedAt).IsEqualTo(deleted.DateTime);
        await Assert.That(await DbContext.InterlinearProjects.CountAsync()).IsEqualTo(0);
    }

    [Test]
    public async Task DeletingAProjectDeletesItsRecordsAndNotAnotherProjects()
    {
        await WriteNextChange([Fixtures.CreateInterlinearProject(_projectId), Fixtures.CreateInterlinearProject(_otherProjectId)]);
        var mine = Token(_projectId);
        var theirs = Token(_otherProjectId);
        await WriteNextChange([
            new CreateTokenAnalysisChange(mine),
            new CreateTokenAnalysisLinkChange(Link(_projectId, mine.Id)),
            new CreateTokenAnalysisChange(theirs),
            new CreateTokenAnalysisLinkChange(Link(_otherProjectId, theirs.Id)),
        ]);

        await WriteNextChange(new DeleteChange<InterlinearProject>(_projectId));

        await Assert.That((await DbContext.TokenAnalyses.ToListAsync()).Select(a => a.Id)).IsEquivalentTo([theirs.Id]);
        await Assert.That((await DbContext.TokenAnalysisLinks.ToListAsync()).Select(l => l.ProjectId)).IsEquivalentTo([_otherProjectId]);
    }

    [Test]
    public async Task ARecordCreatedInAProjectNeverCreatedLandsDeleted()
    {
        var token = Token(_projectId);

        await WriteNextChange(new CreateTokenAnalysisChange(token));

        await Assert.That(await DbContext.TokenAnalyses.CountAsync()).IsEqualTo(0);
    }

    [Test]
    public async Task ARecordCreatedInADeletedProjectLandsDeleted()
    {
        await WriteNextChange(Fixtures.CreateInterlinearProject(_projectId));
        await WriteNextChange(new DeleteChange<InterlinearProject>(_projectId));
        var token = Token(_projectId);

        await WriteNextChange([new CreateTokenAnalysisChange(token), new CreateTokenAnalysisLinkChange(Link(_projectId, token.Id))]);

        await Assert.That(await DbContext.TokenAnalyses.CountAsync()).IsEqualTo(0);
        await Assert.That(await DbContext.TokenAnalysisLinks.CountAsync()).IsEqualTo(0);
    }

    [Test]
    public async Task ARecordsProjectIsKeptThroughReplaceAndPatch()
    {
        await WriteNextChange(Fixtures.CreateInterlinearProject(_projectId));
        var token = Token(_projectId);
        await WriteNextChange(new CreateTokenAnalysisChange(token));

        await WriteNextChange(new ReplaceTokenAnalysisChange(new TokenAnalysis { Id = token.Id, SurfaceText = "but" }));
        await WriteNextChange(new PatchTokenAnalysisChange(token.Id) { Pos = "conj" });

        var stored = await DataModel.GetLatest<TokenAnalysis>(token.Id);
        await Assert.That(stored!.ProjectId).IsEqualTo(_projectId);
        await Assert.That(stored.SurfaceText).IsEqualTo("but");
    }
}
