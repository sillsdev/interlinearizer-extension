using Interlinearizer.Crdt;
using Interlinearizer.Crdt.Changes;
using Interlinearizer.Crdt.Entities;
using Interlinearizer.Host.Papi;

namespace Interlinearizer.Host.Services;

/// <summary>What every command on a source names: the open source project it reaches.</summary>
public record SourceArgs(string SourceProjectId);

/// <summary>What every command on an interlinear project names: the project, in its open source.</summary>
public interface IProjectArgs
{
    string SourceProjectId { get; }
    string ProjectId { get; }
}

public record ProjectArgs(string SourceProjectId, string ProjectId) : IProjectArgs;

/// <summary>A project to create, with its fields but the timestamps the commit stamps.</summary>
public record CreateProjectArgs(
    string SourceProjectId,
    Guid ProjectId,
    string? Name,
    string? Description,
    string? TargetProjectId,
    List<string>? AnalysisLanguages,
    SegmentationDelta? Segmentation);

/// <summary>A project to patch, with the fields to set or clear and the languages to add and remove.</summary>
public record UpdateProjectArgs(string SourceProjectId, string ProjectId) : ProjectPatch, IProjectArgs;

public record ApplyArgs(string SourceProjectId, string ProjectId, ChangeSet Changes) : IProjectArgs;

public record IdsArgs(string SourceProjectId, string ProjectId, List<Guid> Ids) : IProjectArgs;

public record KeysArgs(string SourceProjectId, string ProjectId, List<string> Keys) : IProjectArgs;

public record LinksInBooksArgs(string SourceProjectId, string ProjectId, List<string> BookCodes, List<AssignmentStatus>? Statuses) : IProjectArgs;

/// <summary>
/// Serves the C# <see cref="AnalysisRepository"/> and <see cref="InterlinearProjects"/> over the
/// Platform.Bible network, one command per method, each taking one object of named fields as the
/// TypeScript session commands do. A source project is opened by
/// <c>interlinearizer.repository.openSource</c> before any other command reaches it or the
/// interlinear projects in its database.
/// </summary>
internal sealed class RepositoryService(PapiClient papi, OpenSources sources, HostOptions options)
{
    public const string CommandPrefix = "command:interlinearizer.repository.";

    public async Task<bool> RegisterAsync()
    {
        var registrations = new (string Name, Delegate Handler)[]
        {
            ("openSource", (Func<SourceArgs, Task>)OpenSource),
            ("closeSource", (Func<SourceArgs, Task>)CloseSource),
            ("listProjects", (Func<SourceArgs, Task<List<InterlinearProject>>>)ListProjects),
            ("createProject", (Func<CreateProjectArgs, Task>)CreateProject),
            ("updateProject", (Func<UpdateProjectArgs, Task>)UpdateProject),
            ("deleteProject", (Func<ProjectArgs, Task>)DeleteProject),
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

    /// <summary>Opens a source over the database the host keeps for it in its data directory.</summary>
    /// <exception cref="ArgumentException">If the source's id cannot name a file.</exception>
    private Task OpenSource(SourceArgs args)
    {
        var id = args.SourceProjectId;
        if (id.Length == 0 || id != Path.GetFileName(id) || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        {
            throw new ArgumentException($"A source project id names its database file, which '{id}' cannot", nameof(args));
        }
        return sources.Open(id, Path.Combine(options.DataDirectory, "sources", id + ".sqlite"));
    }

    private Task CloseSource(SourceArgs args) => sources.Close(args.SourceProjectId);

    private async Task<List<InterlinearProject>> ListProjects(SourceArgs args) => await (await Projects(args.SourceProjectId)).List();

    private async Task CreateProject(CreateProjectArgs args) => await (await Projects(args.SourceProjectId)).Create(new InterlinearProject
    {
        Id = args.ProjectId,
        Name = args.Name,
        Description = args.Description,
        TargetProjectId = args.TargetProjectId,
        AnalysisLanguages = args.AnalysisLanguages ?? [],
        Segmentation = args.Segmentation,
    });

    private async Task UpdateProject(UpdateProjectArgs args) => await (await Projects(args.SourceProjectId)).Patch(ParseProjectId(args.ProjectId), args);

    private async Task DeleteProject(ProjectArgs args) => await (await Projects(args.SourceProjectId)).Delete(ParseProjectId(args.ProjectId));

    private async Task Apply(ApplyArgs args) => await (await Repository(args)).Apply(args.Changes);

    private async Task<TextAnalysis> ReadAll(ProjectArgs args) => await (await Repository(args)).ReadAll();

    private async Task<List<TokenAnalysis>> GetTokenAnalyses(IdsArgs args) => await (await Repository(args)).GetTokenAnalyses(args.Ids);

    private async Task<List<PhraseAnalysis>> GetPhraseAnalyses(IdsArgs args) => await (await Repository(args)).GetPhraseAnalyses(args.Ids);

    private async Task<List<SegmentAnalysis>> GetSegmentAnalyses(IdsArgs args) => await (await Repository(args)).GetSegmentAnalyses(args.Ids);

    private async Task<List<PhraseAnalysisLink>> GetPhraseAnalysisLinks(IdsArgs args) => await (await Repository(args)).GetPhraseAnalysisLinks(args.Ids);

    private async Task<TokenLinks> FindLinksByToken(KeysArgs args) => await (await Repository(args)).FindLinksByToken(args.Keys);

    private async Task<List<SegmentAnalysisLink>> FindLinksBySegment(KeysArgs args) => await (await Repository(args)).FindLinksBySegment(args.Keys);

    private async Task<AnalysisLinks> FindLinksToAnalyses(IdsArgs args) => await (await Repository(args)).FindLinksToAnalyses(args.Ids);

    private async Task<AnalysisLinks> FindLinksInBooks(LinksInBooksArgs args) => await (await Repository(args)).FindLinksInBooks(args.BookCodes, args.Statuses);

    private async Task<List<string>> FindLinkedBooks(ProjectArgs args) => await (await Repository(args)).FindLinkedBooks();

    private async Task<List<TokenAnalysis>> FindTokenAnalysesByForm(KeysArgs args) => await (await Repository(args)).FindTokenAnalysesByForm(args.Keys);

    private async Task<List<PhraseAnalysis>> FindPhraseAnalysesByForm(KeysArgs args) => await (await Repository(args)).FindPhraseAnalysesByForm(args.Keys);

    private async Task<Dictionary<Guid, int>> CountApprovals(IdsArgs args) => await (await Repository(args)).CountApprovals(args.Ids);

    private static Guid ParseProjectId(string projectId) =>
        Guid.TryParse(projectId, out var id) ? id : throw new ArgumentException($"Project ids are GUIDs, not {projectId}", nameof(projectId));

    private Task<InterlinearProjects> Projects(string sourceProjectId) => sources.Projects(sourceProjectId);

    private Task<AnalysisRepository> Repository(IProjectArgs args) => sources.Repository(args.SourceProjectId, args.ProjectId);
}
