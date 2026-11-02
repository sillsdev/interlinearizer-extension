namespace Interlinearizer.Crdt.Tests;

/// <summary>A real database is built through the migrations, so they must describe the model.</summary>
public class MigrationTests : CrdtTestBase
{
    [Test]
    public async Task TheMigrationsMatchTheModel()
    {
        await Assert.That(DbContext.Database.HasPendingModelChanges()).IsFalse();
    }

    [Test]
    public async Task EveryMigrationIsApplied()
    {
        await Assert.That(await DbContext.Database.GetPendingMigrationsAsync()).IsEmpty();
    }
}
