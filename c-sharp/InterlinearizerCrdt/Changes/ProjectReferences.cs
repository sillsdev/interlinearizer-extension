using SIL.Harmony.Changes;

namespace Interlinearizer.Crdt.Changes;

internal static class ProjectReferences
{
    /// <summary>
    /// Whether a record created in <paramref name="projectId"/> lands deleted: the project is
    /// deleted or was never created. An empty id names no project, so it never does.
    /// </summary>
    public static async ValueTask<bool> IsProjectDeleted(this IChangeContext context, Guid projectId) =>
        projectId != Guid.Empty && await context.IsObjectDeleted(projectId);
}
