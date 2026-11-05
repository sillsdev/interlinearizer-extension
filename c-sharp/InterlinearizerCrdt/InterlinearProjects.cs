using Interlinearizer.Crdt.Changes;
using Interlinearizer.Crdt.Entities;
using Microsoft.EntityFrameworkCore;
using SIL.Harmony;
using SIL.Harmony.Changes;

namespace Interlinearizer.Crdt;

/// <summary>
/// Some of a project's fields to change. A field left unset is left alone and one set to null is
/// cleared; the language list is replaced whole.
/// </summary>
public record ProjectPatch
{
    public PatchField<string?> Name { get; init; }
    public PatchField<string?> Description { get; init; }
    public PatchField<string?> TargetProjectId { get; init; }
    public PatchField<SegmentationDelta?> Segmentation { get; init; }
    public PatchField<List<string>?> AnalysisLanguages { get; init; }
}

/// <summary>
/// The interlinear projects of one database, each a Harmony entity. Lists come back in no
/// promised order, and a deleted project is not stored for the purposes of these calls.
/// </summary>
public class InterlinearProjects(DataModel dataModel, InterlinearizerCrdtDbContext db, ClientIdentity client)
{
    /// <summary>Every project stored, with the fields the WebView's project pickers show.</summary>
    public Task<List<InterlinearProject>> List() =>
        dataModel.QueryLatest<InterlinearProject>(q => q).ToListAsync().AsTask();

    /// <summary>The project stored under <paramref name="id"/>, or null when none is.</summary>
    public async Task<InterlinearProject?> Get(Guid id) =>
        await dataModel.GetLatest<InterlinearProject>(id) is { DeletedAt: null } project ? project : null;

    /// <summary>
    /// Whether a record of any kind, deleted or not, has been stored under <paramref name="id"/>.
    /// </summary>
    public Task<bool> HasBeenStored(Guid id) => db.Snapshots.AnyAsync(s => s.EntityId == id);

    /// <summary>
    /// Stores <paramref name="project"/> in one commit, stamped with the commit's time. Its id must
    /// be one that no record of any kind has ever been stored under.
    /// </summary>
    /// <exception cref="ArgumentException">If the id has been used; nothing is written.</exception>
    public async Task Create(InterlinearProject project)
    {
        // Harmony keeps every entity in one table. A create under a live record's id is dropped
        // without error. A create under a deleted record's id brings that record back as a project.
        if (await HasBeenStored(project.Id)) throw new ArgumentException($"Project {project.Id} has already been stored", nameof(project));
        await Commit("createProject", new CreateInterlinearProjectChange(project));
    }

    /// <summary>Applies <paramref name="patch"/> to the project stored under <paramref name="id"/> in one commit. A patch that sets nothing writes no commit.</summary>
    /// <exception cref="ArgumentException">If no project is stored under the id; nothing is written.</exception>
    public async Task Patch(Guid id, ProjectPatch patch)
    {
        if (await Get(id) is null) throw new ArgumentException($"Project {id} is not stored", nameof(id));
        var change = new PatchInterlinearProjectChange(id)
        {
            Name = patch.Name,
            Description = patch.Description,
            TargetProjectId = patch.TargetProjectId,
            Segmentation = patch.Segmentation,
            AnalysisLanguages = patch.AnalysisLanguages,
        };
        if (change.IsEmpty) return;
        await Commit("updateProject", change);
    }

    /// <summary>
    /// Deletes the project stored under <paramref name="id"/>, and with it every record of its
    /// analysis, in one commit. A project not stored is skipped.
    /// </summary>
    public async Task Delete(Guid id)
    {
        if (await Get(id) is null) return;
        await Commit("deleteProject", new DeleteChange<InterlinearProject>(id));
    }

    private Task Commit(string intent, IChange change) =>
        dataModel.AddChanges(client.Id, [change], new CommitMetadata { [AnalysisRepository.IntentMetadataKey] = intent });
}
