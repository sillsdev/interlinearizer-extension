using System.Text.Json;
using System.Text.Json.Serialization;

namespace Interlinearizer.Crdt.Changes;

/// <summary>A patch change's field: <c>default</c> is unset, and any assigned value, null included, is set.</summary>
[JsonConverter(typeof(PatchFieldConverterFactory))]
public readonly struct PatchField<T>(T value)
{
    public bool HasValue { get; } = true;
    public T Value { get; } = value;
    public static implicit operator PatchField<T>(T value) => new(value);
}

public class PatchFieldConverter<T> : JsonConverter<PatchField<T>>
{
    public override PatchField<T> Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) =>
        new(JsonSerializer.Deserialize<T>(ref reader, options)!);

    public override void Write(Utf8JsonWriter writer, PatchField<T> field, JsonSerializerOptions options) =>
        JsonSerializer.Serialize(writer, field.Value, options);
}

public class PatchFieldConverterFactory : JsonConverterFactory
{
    public override bool CanConvert(Type type) =>
        type.IsGenericType && type.GetGenericTypeDefinition() == typeof(PatchField<>);

    public override JsonConverter CreateConverter(Type type, JsonSerializerOptions options) =>
        (JsonConverter)Activator.CreateInstance(
            typeof(PatchFieldConverter<>).MakeGenericType(type.GetGenericArguments()[0]))!;
}
