using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// A multi-token unit glossed as a single phrase. When both <see cref="Gloss"/> and
/// <see cref="SenseRef"/> are present, the gloss wins for rendering.
/// </summary>
public class PhraseAnalysis : Analysis, IObjectBase<PhraseAnalysis>
{
    public MultiString? Gloss { get; set; }

    /// <summary>The lexicon sense this phrase maps to, for a multi-word lexical entry.</summary>
    public SenseRef? SenseRef { get; set; }

    public IObjectBase Copy() => new PhraseAnalysis
    {
        Id = Id,
        ProjectId = ProjectId,
        DeletedAt = DeletedAt,
        CreatedAt = CreatedAt,
        UpdatedAt = UpdatedAt,
        SurfaceText = SurfaceText,
        Confidence = Confidence,
        Producer = Producer,
        SourceUser = SourceUser,
        Gloss = Gloss?.Copy(),
        SenseRef = SenseRef,
    };
}

/// <summary>
/// Links one <see cref="PhraseAnalysis"/> to one occurrence: the ordered tokens, all in one book,
/// that compose the phrase there.
/// </summary>
public class PhraseAnalysisLink : AnalysisLink, IObjectBase<PhraseAnalysisLink>
{
    private List<TokenSnapshot> _tokens = [];

    /// <summary>Never empty: the first token places the whole run in its book.</summary>
    public required List<TokenSnapshot> Tokens
    {
        get => _tokens;
        set
        {
            if (value.Count == 0) throw new ArgumentException("A phrase link needs at least one token", nameof(value));
            _tokens = value;
            BookCode = Refs.BookOf(value[0].TokenRef);
        }
    }

    public IObjectBase Copy() => new PhraseAnalysisLink
    {
        Id = Id,
        ProjectId = ProjectId,
        DeletedAt = DeletedAt,
        AnalysisId = AnalysisId,
        CreatedAt = CreatedAt,
        UpdatedAt = UpdatedAt,
        Status = Status,
        Confidence = Confidence,
        Tokens = Tokens.ToList(),
    };
}
