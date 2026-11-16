using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Interlinearizer.Crdt.Entities;

namespace Interlinearizer.Host.Papi;

/// <summary>How records are shaped on the Platform.Bible network, as the TypeScript seam expects them.</summary>
internal static class WireJson
{
    /// <summary>
    /// Leaves a record's project off the wire: a repository serves one project, so its records
    /// never name it. Writes timestamps as JavaScript's <c>toISOString</c> does, because the
    /// TypeScript side compares them as strings and expects each back as it was put.
    /// </summary>
    public static void Configure(JsonSerializerOptions options)
    {
        options.TypeInfoResolver = (options.TypeInfoResolver ?? new DefaultJsonTypeInfoResolver())
            .WithAddedModifier(HideProject);
        options.Converters.Add(new IsoTimestampConverter());
    }

    private static void HideProject(JsonTypeInfo typeInfo)
    {
        if (!typeof(AnalysisRecord).IsAssignableFrom(typeInfo.Type)) return;
        foreach (var property in typeInfo.Properties)
        {
            if (property.Name == JsonNamingPolicy.CamelCase.ConvertName(nameof(AnalysisRecord.ProjectId)))
            {
                property.ShouldSerialize = (_, _) => false;
            }
        }
    }

    /// <summary>A timestamp in UTC to the millisecond, as <c>Date.prototype.toISOString</c> writes it.</summary>
    private sealed class IsoTimestampConverter : JsonConverter<DateTimeOffset>
    {
        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
            reader.GetDateTimeOffset();

        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
    }
}
