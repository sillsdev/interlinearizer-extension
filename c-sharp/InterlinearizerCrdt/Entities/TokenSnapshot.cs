namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// A token at the time a link was made: its stable reference and a copy of its surface text, so
/// that a later change to the text can be detected. <see cref="FormCount"/> is how many tokens of
/// its form its verse then held, when known, so that re-anchoring can tell when an identical word
/// may have been the one removed.
/// </summary>
public record TokenSnapshot(string TokenRef, string SurfaceText, int? FormCount = null);
