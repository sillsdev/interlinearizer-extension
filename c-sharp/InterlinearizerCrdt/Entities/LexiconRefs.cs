namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// Links an analysis to one item in a lexicon. The authority labels the id space the ids belong
/// to. The project id names the lexicon project within it, absent only for an authority whose
/// lexicon is not divided into projects.
/// </summary>
public abstract record LexiconRef(string Authority, string? ProjectId);

/// <summary>Reference to a lexicon entry.</summary>
public record EntryRef(string Authority, string? ProjectId, string EntryId) : LexiconRef(Authority, ProjectId);

/// <summary>
/// Reference to a lexicon sense. A sense id names the sense itself rather than a position in its
/// entry, so a ref survives the sense moving to a different entry.
/// </summary>
public record SenseRef(string Authority, string? ProjectId, string SenseId) : LexiconRef(Authority, ProjectId);

/// <summary>Reference to a specific allomorph (surface variant) on a lexicon entry.</summary>
public record AllomorphRef(string Authority, string? ProjectId, string AllomorphId) : LexiconRef(Authority, ProjectId);

/// <summary>Reference to a morphosyntactic analysis in a lexicon.</summary>
public record GrammarRef(string Authority, string? ProjectId, string MsaId) : LexiconRef(Authority, ProjectId);
