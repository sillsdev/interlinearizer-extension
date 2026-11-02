namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// A token at the time a link was made: its stable reference and a copy of its surface text, so
/// that a later change to the text can be detected.
/// </summary>
public record TokenSnapshot(string TokenRef, string SurfaceText);
