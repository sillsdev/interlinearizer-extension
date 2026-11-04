using Interlinearizer.Crdt.Entities;

namespace Interlinearizer.Crdt.Changes;

internal static class ProjectReferences
{
    /// <summary>
    /// The project a create change files <paramref name="record"/> under: <paramref name="projectId"/>,
    /// which the record must either name as well or leave unassigned.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// If <paramref name="projectId"/> is empty, or the record names another project.
    /// </exception>
    public static Guid ProjectOf(AnalysisRecord record, Guid projectId)
    {
        if (projectId == Guid.Empty) throw new ArgumentException("A record needs a project", nameof(projectId));
        if (record.ProjectId != Guid.Empty && record.ProjectId != projectId)
        {
            throw new ArgumentException($"Record {record.Id} names project {record.ProjectId}, not {projectId}", nameof(record));
        }
        return projectId;
    }
}
