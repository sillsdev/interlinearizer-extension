using Interlinearizer.Crdt;
using Interlinearizer.Crdt.Entities;
using Interlinearizer.Host.Papi;

namespace Interlinearizer.Host.Services;

/// <summary>What every repository command names: the open project it reaches.</summary>
public record ProjectArgs(string ProjectId);

/// <summary>
/// Opens a project over the database at <paramref name="DbPath"/>, or, when that is absent, the
/// one the host keeps for the project in its data directory.
/// </summary>
public record OpenProjectArgs(string ProjectId, string? DbPath);

public record ApplyArgs(string ProjectId, ChangeSet Changes);

public record IdsArgs(string ProjectId, List<Guid> Ids);

public record KeysArgs(string ProjectId, List<string> Keys);

public record LinksInBooksArgs(string ProjectId, List<string> BookCodes, List<AssignmentStatus>? Statuses);

/// <summary>
/// Serves the C# <see cref="AnalysisRepository"/> over the Platform.Bible network, one command
/// per repository method, each taking one object of named fields as the TypeScript session
/// commands do. A project is opened by <c>interlinearizer.repository.openProject</c> before any
/// other command reaches it.
/// </summary>
internal sealed class RepositoryService(PapiClient papi, OpenProjects projects, HostOptions options)
{
    public const string CommandPrefix = "command:interlinearizer.repository.";

    public async Task<bool> RegisterAsync()
    {
        var registrations = new (string Name, Delegate Handler)[]
        {
            ("openProject", (Func<OpenProjectArgs, Task>)OpenProject),
            ("closeProject", (Func<ProjectArgs, Task>)CloseProject),
            ("apply", (Func<ApplyArgs, Task>)Apply),
            ("readAll", (Func<ProjectArgs, Task<TextAnalysis>>)ReadAll),
            ("getTokenAnalyses", (Func<IdsArgs, Task<List<TokenAnalysis>>>)GetTokenAnalyses),
            ("getPhraseAnalyses", (Func<IdsArgs, Task<List<PhraseAnalysis>>>)GetPhraseAnalyses),
            ("getSegmentAnalyses", (Func<IdsArgs, Task<List<SegmentAnalysis>>>)GetSegmentAnalyses),
            ("getPhraseAnalysisLinks", (Func<IdsArgs, Task<List<PhraseAnalysisLink>>>)GetPhraseAnalysisLinks),
            ("findLinksByToken", (Func<KeysArgs, Task<TokenLinks>>)FindLinksByToken),
            ("findLinksBySegment", (Func<KeysArgs, Task<List<SegmentAnalysisLink>>>)FindLinksBySegment),
            ("findLinksToAnalyses", (Func<IdsArgs, Task<AnalysisLinks>>)FindLinksToAnalyses),
            ("findLinksInBooks", (Func<LinksInBooksArgs, Task<AnalysisLinks>>)FindLinksInBooks),
            ("findLinkedBooks", (Func<ProjectArgs, Task<List<string>>>)FindLinkedBooks),
            ("findTokenAnalysesByForm", (Func<KeysArgs, Task<List<TokenAnalysis>>>)FindTokenAnalysesByForm),
            ("findPhraseAnalysesByForm", (Func<KeysArgs, Task<List<PhraseAnalysis>>>)FindPhraseAnalysesByForm),
            ("countApprovals", (Func<IdsArgs, Task<Dictionary<Guid, int>>>)CountApprovals),
        };
        foreach (var (name, handler) in registrations)
        {
            if (!await papi.RegisterRequestHandlerAsync(CommandPrefix + name, handler)) return false;
        }
        return true;
    }

    private Task OpenProject(OpenProjectArgs args) =>
        projects.Open(args.ProjectId, args.DbPath ?? Path.Combine(options.DataDirectory, "projects", args.ProjectId + ".sqlite"));

    private Task CloseProject(ProjectArgs args) => projects.Close(args.ProjectId);

    private async Task Apply(ApplyArgs args) => await (await Repository(args.ProjectId)).Apply(args.Changes);

    private async Task<TextAnalysis> ReadAll(ProjectArgs args) => await (await Repository(args.ProjectId)).ReadAll();

    private async Task<List<TokenAnalysis>> GetTokenAnalyses(IdsArgs args) => await (await Repository(args.ProjectId)).GetTokenAnalyses(args.Ids);

    private async Task<List<PhraseAnalysis>> GetPhraseAnalyses(IdsArgs args) => await (await Repository(args.ProjectId)).GetPhraseAnalyses(args.Ids);

    private async Task<List<SegmentAnalysis>> GetSegmentAnalyses(IdsArgs args) => await (await Repository(args.ProjectId)).GetSegmentAnalyses(args.Ids);

    private async Task<List<PhraseAnalysisLink>> GetPhraseAnalysisLinks(IdsArgs args) => await (await Repository(args.ProjectId)).GetPhraseAnalysisLinks(args.Ids);

    private async Task<TokenLinks> FindLinksByToken(KeysArgs args) => await (await Repository(args.ProjectId)).FindLinksByToken(args.Keys);

    private async Task<List<SegmentAnalysisLink>> FindLinksBySegment(KeysArgs args) => await (await Repository(args.ProjectId)).FindLinksBySegment(args.Keys);

    private async Task<AnalysisLinks> FindLinksToAnalyses(IdsArgs args) => await (await Repository(args.ProjectId)).FindLinksToAnalyses(args.Ids);

    private async Task<AnalysisLinks> FindLinksInBooks(LinksInBooksArgs args) => await (await Repository(args.ProjectId)).FindLinksInBooks(args.BookCodes, args.Statuses);

    private async Task<List<string>> FindLinkedBooks(ProjectArgs args) => await (await Repository(args.ProjectId)).FindLinkedBooks();

    private async Task<List<TokenAnalysis>> FindTokenAnalysesByForm(KeysArgs args) => await (await Repository(args.ProjectId)).FindTokenAnalysesByForm(args.Keys);

    private async Task<List<PhraseAnalysis>> FindPhraseAnalysesByForm(KeysArgs args) => await (await Repository(args.ProjectId)).FindPhraseAnalysesByForm(args.Keys);

    private async Task<Dictionary<Guid, int>> CountApprovals(IdsArgs args) => await (await Repository(args.ProjectId)).CountApprovals(args.Ids);

    private Task<AnalysisRepository> Repository(string projectId) => projects.Repository(projectId);
}
