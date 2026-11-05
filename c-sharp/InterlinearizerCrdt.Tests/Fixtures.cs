namespace Interlinearizer.Crdt.Tests;

/// <summary>Builders for fully populated changes, so that a test asserts on every field.</summary>
public static class Fixtures
{
    public static readonly SenseRef Sense = new("lexicon", "lex-project", "sense-1");
    public static readonly EntryRef Entry = new("lexicon", "lex-project", "entry-1");
    public static readonly TokenSnapshot Token1 = new("GEN 1:1 tok 0", "In");
    public static readonly TokenSnapshot Token2 = new("GEN 1:1 tok 1", "the");

    /// <summary>The project the record fixtures belong to.</summary>
    public static readonly Guid ProjectId = new("33333333-3333-3333-3333-333333333333");
    public static CreateInterlinearProjectChange CreateInterlinearProject(Guid id) => new(id)
    {
        Name = "Genesis draft",
        Description = "A draft of Genesis.",
        TargetProjectId = "target-project",
        AnalysisLanguages = ["fr", "en"],
        Segmentation = new SegmentationDelta(["GEN 1:2"], [Token2]),
    };

    /// <summary>Sets some fields, clears one, and replaces the languages.</summary>
    public static PatchInterlinearProjectChange PatchInterlinearProject(Guid id) => new(id)
    {
        Name = "Genesis and Exodus",
        TargetProjectId = null,
        AnalysisLanguages = new List<string> { "en", "de" },
    };

    public static MultiString Multi(string en, string fr) => new() { ["en"] = en, ["fr"] = fr };

    public static MorphemeAnalysis Morpheme(string form) => new()
    {
        Id = Guid.NewGuid(),
        Form = form,
        WritingSystem = "grc",
        EntryRef = Entry,
        SenseRef = Sense,
        AllomorphRef = new AllomorphRef("lexicon", "lex-project", "allo-1"),
        GrammarRef = new GrammarRef("lexicon", "lex-project", "msa-1"),
        Gloss = Multi(form + "-gloss", form + "-glose"),
    };

    public static CreateSegmentAnalysisChange CreateSegmentAnalysis(Guid id) => new(id)
    {
        ProjectId = ProjectId,
        SurfaceText = "In the beginning",
        Confidence = Confidence.High,
        Producer = "human",
        SourceUser = "kevin",
        FreeTranslation = Multi("In the beginning", "Au commencement"),
        LiteralTranslation = Multi("In beginning", "En commencement"),
    };

    public static ReplaceSegmentAnalysisChange ReplaceSegmentAnalysis(Guid id) => new(id)
    {
        SurfaceText = "In the beginning,",
        Confidence = Confidence.Medium,
        Producer = "translator-tool",
        SourceUser = null,
        FreeTranslation = Multi("At the start", "Au début"),
        LiteralTranslation = null,
    };

    /// <summary>Sets some fields, clears one, and edits one translation key while removing another.</summary>
    public static PatchSegmentAnalysisChange PatchSegmentAnalysis(Guid id) => new(id)
    {
        Confidence = Confidence.Low,
        SourceUser = null,
        FreeTranslation = new MultiStringPatch { ["en"] = "At first", ["fr"] = null },
    };

    public static PatchSegmentAnalysisLinkChange PatchSegmentAnalysisLink(Guid id) => new(id)
    {
        Status = AssignmentStatus.Rejected,
        Confidence = null,
    };

    public static PatchTokenAnalysisChange PatchTokenAnalysis(Guid id) => new(id)
    {
        Pos = null,
        Features = new MultiStringPatch { ["Case"] = "Gen", ["Number"] = null, ["Gender"] = "Fem" },
        Gloss = new MultiStringPatch { ["fr"] = null, ["de"] = "Anfang" },
        GlossSenseRef = null,
    };

    public static PatchTokenAnalysisLinkChange PatchTokenAnalysisLink(Guid id) => new(id)
    {
        Token = Token2,
        Status = AssignmentStatus.Approved,
    };

    public static PatchPhraseAnalysisChange PatchPhraseAnalysis(Guid id) => new(id)
    {
        SurfaceText = "in the beginning",
        Gloss = new MultiStringPatch { ["en"] = null, ["fr"] = null },
    };

    public static PatchPhraseAnalysisLinkChange PatchPhraseAnalysisLink(Guid id) => new(id)
    {
        Tokens = new List<TokenSnapshot> { Token2, Token1 },
        Confidence = Confidence.High,
    };

    public static CreateSegmentAnalysisLinkChange CreateSegmentAnalysisLink(Guid id, Guid analysisId) => new(id)
    {
        ProjectId = ProjectId,
        AnalysisId = analysisId,
        SegmentId = "GEN 1:1",
        Status = AssignmentStatus.Approved,
        Confidence = Confidence.High,
    };

    public static ReplaceSegmentAnalysisLinkChange ReplaceSegmentAnalysisLink(Guid id, Guid analysisId) => new(id)
    {
        AnalysisId = analysisId,
        SegmentId = "GEN 1:2",
        Status = AssignmentStatus.Stale,
        Confidence = null,
    };

    public static CreateTokenAnalysisChange CreateTokenAnalysis(Guid id) => new(id)
    {
        ProjectId = ProjectId,
        SurfaceText = "ἀρχῇ",
        Confidence = Confidence.Guess,
        Producer = "parser",
        SourceUser = null,
        Morphemes = [Morpheme("ἀρχ"), Morpheme("ῇ")],
        MorphemesStale = false,
        Pos = "noun",
        Features = new() { ["Case"] = "Dat", ["Number"] = "Sg" },
        Gloss = Multi("beginning", "commencement"),
        GlossSenseRef = Sense,
    };

    public static ReplaceTokenAnalysisChange ReplaceTokenAnalysis(Guid id) => new(id)
    {
        SurfaceText = "ἀρχή",
        Confidence = Confidence.High,
        Producer = "human",
        SourceUser = "kevin",
        Morphemes = [Morpheme("ἀρχή")],
        MorphemesStale = true,
        Pos = "N",
        Features = null,
        Gloss = Multi("start", "début"),
        GlossSenseRef = null,
    };

    public static CreateTokenAnalysisLinkChange CreateTokenAnalysisLink(Guid id, Guid analysisId) => new(id)
    {
        ProjectId = ProjectId,
        AnalysisId = analysisId,
        Token = Token1,
        Status = AssignmentStatus.Suggested,
        Confidence = Confidence.Low,
    };

    public static ReplaceTokenAnalysisLinkChange ReplaceTokenAnalysisLink(Guid id, Guid analysisId) => new(id)
    {
        AnalysisId = analysisId,
        Token = Token2,
        Status = AssignmentStatus.Approved,
        Confidence = Confidence.High,
    };

    public static CreatePhraseAnalysisChange CreatePhraseAnalysis(Guid id) => new(id)
    {
        ProjectId = ProjectId,
        SurfaceText = "In the",
        Confidence = Confidence.Medium,
        Producer = "phrase-finder",
        SourceUser = "kevin",
        Gloss = Multi("in the", "dans le"),
        SenseRef = Sense,
    };

    public static ReplacePhraseAnalysisChange ReplacePhraseAnalysis(Guid id) => new(id)
    {
        SurfaceText = "In the beginning",
        Confidence = null,
        Producer = null,
        SourceUser = null,
        Gloss = null,
        SenseRef = new SenseRef("lexicon", null, "sense-2"),
    };

    public static CreatePhraseAnalysisLinkChange CreatePhraseAnalysisLink(Guid id, Guid analysisId) => new(id)
    {
        ProjectId = ProjectId,
        AnalysisId = analysisId,
        Tokens = [Token1, Token2],
        Status = AssignmentStatus.Candidate,
        Confidence = Confidence.Medium,
    };

    public static ReplacePhraseAnalysisLinkChange ReplacePhraseAnalysisLink(Guid id, Guid analysisId) => new(id)
    {
        AnalysisId = analysisId,
        Tokens = [Token2],
        Status = AssignmentStatus.Rejected,
        Confidence = null,
    };
}
