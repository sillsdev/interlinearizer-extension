using Interlinearizer.Crdt.Entities;
using SIL.Harmony.Changes;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// Brings back a deleted record as it was when deleted. Unlike a create, it writes none of the
/// record's fields, so an edit dated after the delete stands. It revives only the record it names,
/// not the links that a deleted analysis took with it.
/// </summary>
public class UndeleteChange<T>(Guid entityId) : EditChange<T>(entityId), IPolyType
    where T : AnalysisRecord
{
    public static string TypeName => "undelete:" + typeof(T).Name;

    public override ValueTask ApplyChange(T entity, IChangeContext context)
    {
        entity.DeletedAt = null;
        return ValueTask.CompletedTask;
    }
}
