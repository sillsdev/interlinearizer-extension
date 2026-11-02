using SIL.Harmony.Entities;

namespace Interlinearizer.Crdt.Entities;

/// <summary>Analysis of a segment as a whole: its free and literal translations.</summary>
public class SegmentAnalysis : Analysis, IObjectBase<SegmentAnalysis>
{
    /// <summary>Idiomatic translation of the segment.</summary>
    public MultiString? FreeTranslation { get; set; }

    /// <summary>Word-for-word translation.</summary>
    public MultiString? LiteralTranslation { get; set; }

    public IObjectBase Copy() => new SegmentAnalysis
    {
        Id = Id,
        DeletedAt = DeletedAt,
        CreatedAt = CreatedAt,
        UpdatedAt = UpdatedAt,
        SurfaceText = SurfaceText,
        Confidence = Confidence,
        Producer = Producer,
        SourceUser = SourceUser,
        FreeTranslation = FreeTranslation?.Copy(),
        LiteralTranslation = LiteralTranslation?.Copy(),
    };
}

/// <summary>Links one <see cref="SegmentAnalysis"/> to a single segment.</summary>
public class SegmentAnalysisLink : AnalysisLink, IObjectBase<SegmentAnalysisLink>
{
    private string _segmentId = "";

    /// <summary>The segment's id in the text layer.</summary>
    public required string SegmentId
    {
        get => _segmentId;
        set
        {
            _segmentId = value;
            BookCode = Refs.BookOf(value);
        }
    }

    public IObjectBase Copy() => new SegmentAnalysisLink
    {
        Id = Id,
        DeletedAt = DeletedAt,
        AnalysisId = AnalysisId,
        CreatedAt = CreatedAt,
        UpdatedAt = UpdatedAt,
        Status = Status,
        Confidence = Confidence,
        SegmentId = SegmentId,
    };
}
