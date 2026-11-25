using Interlinearizer.Crdt.Changes;
using Interlinearizer.Crdt.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Config;

namespace Interlinearizer.Crdt;

/// <summary>Registers Harmony with the interlinearizer's entities and changes.</summary>
public static class InterlinearizerCrdtKernel
{
    /// <summary>
    /// Registers the model over one database per open source project: <see cref="OpenSources"/>
    /// opens a scope per source, over a file in the container's <see cref="SourcesDirectory"/>,
    /// and <see cref="CurrentSource"/> names it. The container must also hold a
    /// <see cref="ClientIdentity"/>.
    /// </summary>
    public static IServiceCollection AddInterlinearizerCrdt(this IServiceCollection services)
    {
        services.AddScoped<CurrentSource>();
        services.AddSingleton<OpenSources>();
        return services.AddInterlinearizerCrdt((provider, builder) =>
            builder.UseSqlite(new SqliteConnectionStringBuilder
            {
                DataSource = provider.GetRequiredService<CurrentSource>().DbPath,
            }.ToString()));
    }

    /// <summary>Registers the model over the one database <paramref name="configureDb"/> names.</summary>
    public static IServiceCollection AddInterlinearizerCrdt(this IServiceCollection services,
        Action<DbContextOptionsBuilder> configureDb) =>
        services.AddInterlinearizerCrdt((_, builder) => configureDb(builder));

    private static IServiceCollection AddInterlinearizerCrdt(this IServiceCollection services,
        Action<IServiceProvider, DbContextOptionsBuilder> configureDb)
    {
        services.AddDbContext<InterlinearizerCrdtDbContext>((provider, builder) =>
        {
            // Each container gets its own EF services: cached ones would carry the JSON options of
            // whichever container built them first.
            builder.EnableServiceProviderCaching(false);
            configureDb(provider, builder);
            // Sends each id list as one JSON parameter, because SQLite caps the parameters of a statement.
            new SqliteDbContextOptionsBuilder(builder).UseParameterizedCollectionMode(ParameterTranslationMode.Parameter);
            builder.EnableDetailedErrors();
        });
        services.AddCrdtData<InterlinearizerCrdtDbContext>(ConfigureHarmony);
        return services;
    }

    /// <summary>The interlinearizer's entity, change, and JSON registrations.</summary>
    public static void ConfigureHarmony(HarmonyConfig config)
    {
        config.ConfigureJsonOptions(PatchFieldJson.Configure);
        config.ChangeTypeListBuilder
            .Add<CreateInterlinearProjectChange>()
            .Add<PatchInterlinearProjectChange>()
            .Add<DeleteChange<InterlinearProject>>()
            .Add<CreateSegmentAnalysisChange>()
            .Add<PatchSegmentAnalysisChange>()
            .Add<DeleteChange<SegmentAnalysis>>()
            .Add<CreateSegmentAnalysisLinkChange>()
            .Add<PatchSegmentAnalysisLinkChange>()
            .Add<DeleteChange<SegmentAnalysisLink>>()
            .Add<CreateTokenAnalysisChange>()
            .Add<PatchTokenAnalysisChange>()
            .Add<DeleteChange<TokenAnalysis>>()
            .Add<CreateTokenAnalysisLinkChange>()
            .Add<PatchTokenAnalysisLinkChange>()
            .Add<DeleteChange<TokenAnalysisLink>>()
            .Add<CreatePhraseAnalysisChange>()
            .Add<PatchPhraseAnalysisChange>()
            .Add<DeleteChange<PhraseAnalysis>>()
            .Add<CreatePhraseAnalysisLinkChange>()
            .Add<PatchPhraseAnalysisLinkChange>()
            .Add<DeleteChange<PhraseAnalysisLink>>()
            .Add<UndeleteChange<SegmentAnalysis>>()
            .Add<UndeleteChange<SegmentAnalysisLink>>()
            .Add<UndeleteChange<TokenAnalysis>>()
            .Add<UndeleteChange<TokenAnalysisLink>>()
            .Add<UndeleteChange<PhraseAnalysis>>()
            .Add<UndeleteChange<PhraseAnalysisLink>>();

        config.ModelVersionBuilder
            .Add(0, "Analysis entities", v => v
                .Change<CreateSegmentAnalysisChange>()
                .Change<PatchSegmentAnalysisChange>()
                .Change<DeleteChange<SegmentAnalysis>>()
                .Change<CreateSegmentAnalysisLinkChange>()
                .Change<PatchSegmentAnalysisLinkChange>()
                .Change<DeleteChange<SegmentAnalysisLink>>()
                .Change<CreateTokenAnalysisChange>()
                .Change<PatchTokenAnalysisChange>()
                .Change<DeleteChange<TokenAnalysis>>()
                .Change<CreateTokenAnalysisLinkChange>()
                .Change<PatchTokenAnalysisLinkChange>()
                .Change<DeleteChange<TokenAnalysisLink>>()
                .Change<CreatePhraseAnalysisChange>()
                .Change<PatchPhraseAnalysisChange>()
                .Change<DeleteChange<PhraseAnalysis>>()
                .Change<CreatePhraseAnalysisLinkChange>()
                .Change<PatchPhraseAnalysisLinkChange>()
                .Change<DeleteChange<PhraseAnalysisLink>>())
            .Add(1, "Interlinear projects", v => v
                .Change<CreateInterlinearProjectChange>()
                .Change<PatchInterlinearProjectChange>()
                .Change<DeleteChange<InterlinearProject>>())
            .Add(2, "Undeletes", v => v
                .Change<UndeleteChange<SegmentAnalysis>>()
                .Change<UndeleteChange<SegmentAnalysisLink>>()
                .Change<UndeleteChange<TokenAnalysis>>()
                .Change<UndeleteChange<TokenAnalysisLink>>()
                .Change<UndeleteChange<PhraseAnalysis>>()
                .Change<UndeleteChange<PhraseAnalysisLink>>());

        // Every lookup starts from the project, so each index leads with it.
        config.ObjectTypeListBuilder.DefaultAdapter()
            .Add<InterlinearProject>()
            .Add<SegmentAnalysis>()
            .Add<SegmentAnalysisLink>(builder =>
            {
                builder.HasIndex(l => new { l.ProjectId, l.AnalysisId });
                builder.HasIndex(l => new { l.ProjectId, l.SegmentId });
                builder.HasIndex(l => new { l.ProjectId, l.BookCode, l.Status });
            })
            .Add<TokenAnalysis>(builder => builder.HasIndex(a => new { a.ProjectId, a.NormalizedForm }))
            .Add<TokenAnalysisLink>(builder =>
            {
                builder.HasIndex(l => new { l.ProjectId, l.AnalysisId });
                builder.HasIndex(l => new { l.ProjectId, l.TokenRef });
                builder.HasIndex(l => new { l.ProjectId, l.BookCode, l.Status });
                builder.HasIndex(l => new { l.ProjectId, l.NormalizedForm, l.Status });
            })
            .Add<PhraseAnalysis>(builder => builder.HasIndex(a => new { a.ProjectId, a.NormalizedForm }))
            .Add<PhraseAnalysisLink>(builder =>
            {
                builder.HasIndex(l => new { l.ProjectId, l.AnalysisId });
                builder.HasIndex(l => new { l.ProjectId, l.BookCode, l.Status });
            });
    }
}
