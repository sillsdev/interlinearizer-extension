namespace Interlinearizer.Host.Services;

/// <summary>
/// What <see cref="PingService"/> answers: the message it was sent, echoed back, and which .NET
/// runtime and process answered it.
/// </summary>
public record PingResult(string Message, string RuntimeVersion, int ProcessId);
