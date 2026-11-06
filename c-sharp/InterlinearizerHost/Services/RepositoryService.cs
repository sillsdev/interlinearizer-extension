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

/// <summary>A project to patch, with the fields to set or clear, the language list among them.</summary>
public record UpdateProjectArgs(string SourceProjectId, string ProjectId) : ProjectPatch, IProjectArgs;

public record ApplyArgs(string SourceProjectId, string ProjectId, ChangeSet Changes) : IProjectArgs;

public record IdsArgs(string SourceProjectId, string ProjectId, List<Guid> Ids) : IProjectArgs;

public record KeysArgs(string SourceProjectId, string ProjectId, List<string> Keys) : IProjectArgs;

public record LinksInBooksArgs(string SourceProjectId, string ProjectId, List<string> BookCodes, List<AssignmentStatus>? Statuses) : IProjectArgs;

/// <summary>
/// Serves the C# <see cref="AnalysisRepository"/> and <see cref="InterlinearProjects"/> over the
/// Platform.Bible network, one command per method, each taking one object of named fields as the
/// TypeScript session commands do. The first command on a source project opens it, and it stays
/// open until <c>interlinearizer.repository.closeSource</c>. Commands on one source run one at a
/// time, in the order they arrive, so callers may overlap them.
/// </summary>
internal sealed class RepositoryService(PapiClient papi, OpenSources sources)
{
    public const string CommandPrefix = "command:interlinearizer.repository.";

    public async Task<bool> RegisterAsync()
    {
        var registrations = new (string Name, Delegate Handler)[]
        {
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

    private Task CloseSource(SourceArgs args) => sources.Exclusive(args.SourceProjectId, () => sources.Close(args.SourceProjectId));

    private Task<List<InterlinearProject>> ListProjects(SourceArgs args) => OnProjects(args.SourceProjectId, p => p.List());

    private Task CreateProject(CreateProjectArgs args) => OnProjects(args.SourceProjectId, p => p.Create(new InterlinearProject
    {
        Id = args.ProjectId,
        Name = args.Name,
        Description = args.Description,
        TargetProjectId = args.TargetProjectId,
        AnalysisLanguages = args.AnalysisLanguages ?? [],
        Segmentation = args.Segmentation,
    }));

    private Task UpdateProject(UpdateProjectArgs args) => OnProjects(args.SourceProjectId, p => p.Patch(ParseProjectId(args.ProjectId), args));

    private Task DeleteProject(ProjectArgs args) => OnProjects(args.SourceProjectId, p => p.Delete(ParseProjectId(args.ProjectId)));

    private Task Apply(ApplyArgs args) => OnRepository(args, r => r.Apply(args.Changes));

    private Task<TextAnalysis> ReadAll(ProjectArgs args) => OnRepository(args, r => r.ReadAll());

    private Task<List<TokenAnalysis>> GetTokenAnalyses(IdsArgs args) => OnRepository(args, r => r.GetTokenAnalyses(args.Ids));

    private Task<List<PhraseAnalysis>> GetPhraseAnalyses(IdsArgs args) => OnRepository(args, r => r.GetPhraseAnalyses(args.Ids));

    private Task<List<SegmentAnalysis>> GetSegmentAnalyses(IdsArgs args) => OnRepository(args, r => r.GetSegmentAnalyses(args.Ids));

    private Task<List<PhraseAnalysisLink>> GetPhraseAnalysisLinks(IdsArgs args) => OnRepository(args, r => r.GetPhraseAnalysisLinks(args.Ids));

    private Task<TokenLinks> FindLinksByToken(KeysArgs args) => OnRepository(args, r => r.FindLinksByToken(args.Keys));

    private Task<List<SegmentAnalysisLink>> FindLinksBySegment(KeysArgs args) => OnRepository(args, r => r.FindLinksBySegment(args.Keys));

    private Task<AnalysisLinks> FindLinksToAnalyses(IdsArgs args) => OnRepository(args, r => r.FindLinksToAnalyses(args.Ids));

    private Task<AnalysisLinks> FindLinksInBooks(LinksInBooksArgs args) => OnRepository(args, r => r.FindLinksInBooks(args.BookCodes, args.Statuses));

    private Task<List<string>> FindLinkedBooks(ProjectArgs args) => OnRepository(args, r => r.FindLinkedBooks());

    private Task<List<TokenAnalysis>> FindTokenAnalysesByForm(KeysArgs args) => OnRepository(args, r => r.FindTokenAnalysesByForm(args.Keys));

    private Task<List<PhraseAnalysis>> FindPhraseAnalysesByForm(KeysArgs args) => OnRepository(args, r => r.FindPhraseAnalysesByForm(args.Keys));

    private Task<Dictionary<Guid, int>> CountApprovals(IdsArgs args) => OnRepository(args, r => r.CountApprovals(args.Ids));

    private static Guid ParseProjectId(string projectId) =>
        Guid.TryParse(projectId, out var id) ? id : throw new ArgumentException($"Project ids are GUIDs, not {projectId}", nameof(projectId));

    private Task<T> OnProjects<T>(string sourceProjectId, Func<InterlinearProjects, Task<T>> call) =>
        sources.Exclusive(sourceProjectId, async () =>
        {
            await sources.Open(sourceProjectId);
            return await call(await sources.Projects(sourceProjectId));
        });

    private Task OnProjects(string sourceProjectId, Func<InterlinearProjects, Task> call) =>
        sources.Exclusive(sourceProjectId, async () =>
        {
            await sources.Open(sourceProjectId);
            await call(await sources.Projects(sourceProjectId));
        });

    private Task<T> OnRepository<T>(IProjectArgs args, Func<AnalysisRepository, Task<T>> call) =>
        sources.Exclusive(args.SourceProjectId, async () =>
        {
            await sources.Open(args.SourceProjectId);
            return await call(await sources.Repository(args.SourceProjectId, args.ProjectId));
        });

    private Task OnRepository(IProjectArgs args, Func<AnalysisRepository, Task> call) =>
        sources.Exclusive(args.SourceProjectId, async () =>
        {
            await sources.Open(args.SourceProjectId);
            await call(await sources.Repository(args.SourceProjectId, args.ProjectId));
        });
}
