using Interlinearizer.Crdt.Changes;
using Interlinearizer.Crdt.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SIL.Harmony;
using SIL.Harmony.Changes;
using SIL.Harmony.Config;

namespace Interlinearizer.Crdt;

/// <summary>Registers Harmony with the interlinearizer's entities and changes.</summary>
public static class InterlinearizerCrdtKernel
{
    public static IServiceCollection AddInterlinearizerCrdt(this IServiceCollection services,
        Action<DbContextOptionsBuilder> configureDb)
    {
        services.AddDbContext<InterlinearizerCrdtDbContext>((_, builder) =>
        {
            // Each container gets its own EF services: cached ones would carry the JSON options of
            // whichever container built them first.
            builder.EnableServiceProviderCaching(false);
            configureDb(builder);
            builder.EnableDetailedErrors();
        });
        services.AddCrdtData<InterlinearizerCrdtDbContext>(ConfigureHarmony);
        return services;
    }

    /// <summary>
    /// The interlinearizer's registrations, exposed so that a test can build the same config
    /// without a container.
    /// </summary>
    public static void ConfigureHarmony(HarmonyConfig config)
    {
        config.ConfigureJsonOptions(PatchFieldJson.Configure);
        config.ChangeTypeListBuilder
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
                .Change<DeleteChange<PhraseAnalysisLink>>());

        config.ObjectTypeListBuilder.DefaultAdapter()
            .Add<SegmentAnalysis>()
            .Add<SegmentAnalysisLink>(builder =>
            {
                builder.HasIndex(l => l.AnalysisId);
                builder.HasIndex(l => l.SegmentId);
                builder.HasIndex(l => new { l.BookCode, l.Status });
            })
            .Add<TokenAnalysis>(builder => builder.HasIndex(a => a.NormalizedForm))
            .Add<TokenAnalysisLink>(builder =>
            {
                builder.HasIndex(l => l.AnalysisId);
                builder.HasIndex(l => l.TokenRef);
                builder.HasIndex(l => new { l.BookCode, l.Status });
            })
            .Add<PhraseAnalysis>(builder => builder.HasIndex(a => a.NormalizedForm))
            .Add<PhraseAnalysisLink>(builder =>
            {
                builder.HasIndex(l => l.AnalysisId);
                builder.HasIndex(l => new { l.BookCode, l.Status });
            });
    }
}
