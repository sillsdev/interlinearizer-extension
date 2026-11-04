using System.Text.Json;
using Interlinearizer.Crdt.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.Extensions.Options;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Config;
using SIL.Harmony.Db;

namespace Interlinearizer.Crdt;

/// <summary>
/// The database Harmony stores an interlinear project's analysis in: its commits, snapshots, and
/// one projected table per entity type.
/// </summary>
public class InterlinearizerCrdtDbContext(
    DbContextOptions<InterlinearizerCrdtDbContext> options,
    IOptions<HarmonyConfig> harmonyConfig) : DbContext(options), ICrdtDbContext
{
    public DbSet<Commit> Commits => Set<Commit>();
    public DbSet<ChangeEntity<IChange>> ChangeEntities => Set<ChangeEntity<IChange>>();
    public DbSet<ObjectSnapshot> Snapshots => Set<ObjectSnapshot>();

    public IQueryable<InterlinearProject> InterlinearProjects => Set<InterlinearProject>().AsNoTracking();
    public IQueryable<SegmentAnalysis> SegmentAnalyses => Set<SegmentAnalysis>().AsNoTracking();
    public IQueryable<SegmentAnalysisLink> SegmentAnalysisLinks => Set<SegmentAnalysisLink>().AsNoTracking();
    public IQueryable<TokenAnalysis> TokenAnalyses => Set<TokenAnalysis>().AsNoTracking();
    public IQueryable<TokenAnalysisLink> TokenAnalysisLinks => Set<TokenAnalysisLink>().AsNoTracking();
    public IQueryable<PhraseAnalysis> PhraseAnalyses => Set<PhraseAnalysis>().AsNoTracking();
    public IQueryable<PhraseAnalysisLink> PhraseAnalysisLinks => Set<PhraseAnalysisLink>().AsNoTracking();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.UseCrdt(harmonyConfig.Value);
    }

    /// <summary>
    /// The projected tables hold each structured value as one JSON column, as the snapshots do,
    /// rather than as tables of their own.
    /// </summary>
    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        builder.Properties<MultiString>().HaveColumnType("jsonb").HaveConversion<JsonConverter<MultiString>>();
        builder.Properties<Dictionary<string, string>>().HaveColumnType("jsonb")
            .HaveConversion<JsonConverter<Dictionary<string, string>>>();
        builder.Properties<List<MorphemeAnalysis>>().HaveColumnType("jsonb")
            .HaveConversion<JsonConverter<List<MorphemeAnalysis>>>();
        builder.Properties<List<TokenSnapshot>>().HaveColumnType("jsonb")
            .HaveConversion<JsonConverter<List<TokenSnapshot>>>();
        builder.Properties<TokenSnapshot>().HaveColumnType("jsonb").HaveConversion<JsonConverter<TokenSnapshot>>();
        builder.Properties<SenseRef>().HaveColumnType("jsonb").HaveConversion<JsonConverter<SenseRef>>();
        builder.Properties<List<string>>().HaveColumnType("jsonb").HaveConversion<JsonConverter<List<string>>>();
        builder.Properties<SegmentationDelta>().HaveColumnType("jsonb")
            .HaveConversion<JsonConverter<SegmentationDelta>>();
    }

    private class JsonConverter<T>() : ValueConverter<T, string>(
        value => JsonSerializer.Serialize(value, (JsonSerializerOptions?)null),
        json => JsonSerializer.Deserialize<T>(json, (JsonSerializerOptions?)null)!)
        where T : class;
}
