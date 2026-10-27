using System.Net.WebSockets;
using System.Text.Json;
using StreamJsonRpc;

namespace Interlinearizer.Host.Papi;

/// <summary>
/// A minimal connection to the Platform.Bible network: JSON-RPC 2.0 over the main process's local
/// WebSocket. Its public methods take the same shape as the ones Platform.Bible's own .NET process
/// offers its services, so a service written against this class can move into that process with
/// only its constructor's parameter type changed.
/// </summary>
internal sealed class PapiClient : IDisposable
{
    private static readonly Uri s_connectionUri = new("ws://localhost:8876");
    private static readonly TimeSpan s_registrationTimeout = TimeSpan.FromSeconds(10);

    private readonly ClientWebSocket _webSocket = new();
    private readonly JsonRpc _jsonRpc;
    private readonly TaskCompletionSource _disconnected = new();

    public PapiClient()
    {
        var formatter = new SystemTextJsonFormatter();
        // TypeScript on the other end expects camelCase property names.
        formatter.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        _jsonRpc = new JsonRpc(new WebSocketMessageHandler(_webSocket, formatter))
        {
            // Handlers are registered after the connection starts listening.
            AllowModificationWhileListening = true,
        };
        _jsonRpc.Disconnected += (_, args) =>
        {
            Console.WriteLine($"Disconnected from Platform.Bible: {args.Reason} {args.Description}");
            _disconnected.TrySetResult();
        };
    }

    /// <summary>
    /// Completes when the connection to Platform.Bible closes, for whatever reason.
    /// </summary>
    public Task DisconnectTask => _disconnected.Task;

    /// <summary>
    /// Connects to the Platform.Bible main process and starts answering requests.
    /// </summary>
    /// <exception cref="WebSocketException">Platform.Bible is not listening.</exception>
    public async Task ConnectAsync(CancellationToken cancellationToken)
    {
        await _webSocket.ConnectAsync(s_connectionUri, cancellationToken);
        _jsonRpc.StartListening();
    }

    /// <summary>
    /// Registers a handler for a request type, such as <c>command:interlinearizer.example</c>.
    /// The request's positional arguments are matched to the handler's parameters by count.
    /// </summary>
    /// <returns>Whether the network accepted the registration.</returns>
    public async Task<bool> RegisterRequestHandlerAsync(string requestType, Delegate requestHandler)
    {
        _jsonRpc.AddLocalRpcMethod(requestType, requestHandler);
        var registration = _jsonRpc.InvokeAsync<bool>("network:registerMethod", requestType);
        try
        {
            return await registration.WaitAsync(s_registrationTimeout);
        }
        catch (TimeoutException)
        {
            Console.WriteLine($"No answer registering {requestType}");
            return false;
        }
    }

    public void Dispose()
    {
        _jsonRpc.Dispose();
        _webSocket.Dispose();
    }
}
