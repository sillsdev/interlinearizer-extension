using Interlinearizer.Crdt.Changes;
using Interlinearizer.Crdt.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
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
    /// opens a scope per source and <see cref="CurrentSource"/> names its database. The container
    /// must also hold a <see cref="ClientIdentity"/>.
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
            .Add<ReplaceSegmentAnalysisChange>()
            .Add<PatchSegmentAnalysisChange>()
            .Add<DeleteChange<SegmentAnalysis>>()
            .Add<CreateSegmentAnalysisLinkChange>()
            .Add<ReplaceSegmentAnalysisLinkChange>()
            .Add<PatchSegmentAnalysisLinkChange>()
            .Add<DeleteChange<SegmentAnalysisLink>>()
            .Add<CreateTokenAnalysisChange>()
            .Add<ReplaceTokenAnalysisChange>()
            .Add<PatchTokenAnalysisChange>()
            .Add<DeleteChange<TokenAnalysis>>()
            .Add<CreateTokenAnalysisLinkChange>()
            .Add<ReplaceTokenAnalysisLinkChange>()
            .Add<PatchTokenAnalysisLinkChange>()
            .Add<DeleteChange<TokenAnalysisLink>>()
            .Add<CreatePhraseAnalysisChange>()
            .Add<ReplacePhraseAnalysisChange>()
            .Add<PatchPhraseAnalysisChange>()
            .Add<DeleteChange<PhraseAnalysis>>()
            .Add<CreatePhraseAnalysisLinkChange>()
            .Add<ReplacePhraseAnalysisLinkChange>()
            .Add<PatchPhraseAnalysisLinkChange>()
            .Add<DeleteChange<PhraseAnalysisLink>>();

        config.ModelVersionBuilder
            .Add(0, "Analysis entities", v => v
                .Change<CreateSegmentAnalysisChange>()
                .Change<ReplaceSegmentAnalysisChange>()
                .Change<PatchSegmentAnalysisChange>()
                .Change<DeleteChange<SegmentAnalysis>>()
                .Change<CreateSegmentAnalysisLinkChange>()
                .Change<ReplaceSegmentAnalysisLinkChange>()
                .Change<PatchSegmentAnalysisLinkChange>()
                .Change<DeleteChange<SegmentAnalysisLink>>()
                .Change<CreateTokenAnalysisChange>()
                .Change<ReplaceTokenAnalysisChange>()
                .Change<PatchTokenAnalysisChange>()
                .Change<DeleteChange<TokenAnalysis>>()
                .Change<CreateTokenAnalysisLinkChange>()
                .Change<ReplaceTokenAnalysisLinkChange>()
                .Change<PatchTokenAnalysisLinkChange>()
                .Change<DeleteChange<TokenAnalysisLink>>()
                .Change<CreatePhraseAnalysisChange>()
                .Change<ReplacePhraseAnalysisChange>()
                .Change<PatchPhraseAnalysisChange>()
                .Change<DeleteChange<PhraseAnalysis>>()
                .Change<CreatePhraseAnalysisLinkChange>()
                .Change<ReplacePhraseAnalysisLinkChange>()
                .Change<PatchPhraseAnalysisLinkChange>()
                .Change<DeleteChange<PhraseAnalysisLink>>())
            .Add(1, "Interlinear projects", v => v
                .Change<CreateInterlinearProjectChange>()
                .Change<PatchInterlinearProjectChange>()
                .Change<DeleteChange<InterlinearProject>>());

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
            })
            .Add<PhraseAnalysis>(builder => builder.HasIndex(a => new { a.ProjectId, a.NormalizedForm }))
            .Add<PhraseAnalysisLink>(builder =>
            {
                builder.HasIndex(l => new { l.ProjectId, l.AnalysisId });
                builder.HasIndex(l => new { l.ProjectId, l.BookCode, l.Status });
            });
    }
}
