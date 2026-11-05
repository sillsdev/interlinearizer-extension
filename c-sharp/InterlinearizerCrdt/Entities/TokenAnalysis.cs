using System.Text.Json.Serialization;
using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// Analysis of a single token: a word-level gloss plus an optional morpheme-level parse. When
/// both <see cref="Gloss"/> and <see cref="GlossSenseRef"/> are present, the gloss wins for
/// rendering.
/// </summary>
public class TokenAnalysis : Analysis, IObjectBase<TokenAnalysis>
{
    /// <summary>Ordered morpheme breakdown; absent when the token is analyzed as one unit.</summary>
    public List<MorphemeAnalysis>? Morphemes { get; set; }

    /// <summary>
    /// Whether <see cref="Morphemes"/> were split from a different spelling than
    /// <see cref="Analysis.SurfaceText"/> and await re-splitting or confirmation.
    /// </summary>
    public bool? MorphemesStale { get; set; }

    /// <summary>Part of speech, as a free-form tag or lexicon POS id.</summary>
    public string? Pos { get; set; }

    /// <summary>Morphosyntactic features as a flat attribute-value map.</summary>
    public Dictionary<string, string>? Features { get; set; }

    public MultiString? Gloss { get; set; }

    /// <summary>The lexicon sense whose gloss text this analysis uses.</summary>
    public SenseRef? GlossSenseRef { get; set; }

    public IObjectBase Copy() => new TokenAnalysis
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
        Morphemes = Morphemes?.ToList(),
        MorphemesStale = MorphemesStale,
        Pos = Pos,
        Features = Features is null ? null : new Dictionary<string, string>(Features),
        Gloss = Gloss?.Copy(),
        GlossSenseRef = GlossSenseRef,
    };
}

/// <summary>Links one <see cref="TokenAnalysis"/> to exactly one token.</summary>
public class TokenAnalysisLink : AnalysisLink, IObjectBase<TokenAnalysisLink>
{
    private TokenSnapshot _token = new("", "");

    public required TokenSnapshot Token
    {
        get => _token;
        set
        {
            _token = value;
            TokenRef = value.TokenRef;
            BookCode = Refs.BookOf(value.TokenRef);
        }
    }

    /// <summary>The linked token's ref, kept as a column so that a token's links can be looked up.</summary>
    [JsonIgnore]
    public string TokenRef { get; private set; } = "";

    public IObjectBase Copy() => new TokenAnalysisLink
    {
        Id = Id,
        ProjectId = ProjectId,
        DeletedAt = DeletedAt,
        AnalysisId = AnalysisId,
        CreatedAt = CreatedAt,
        UpdatedAt = UpdatedAt,
        Status = Status,
        Confidence = Confidence,
        Token = Token,
    };
}
