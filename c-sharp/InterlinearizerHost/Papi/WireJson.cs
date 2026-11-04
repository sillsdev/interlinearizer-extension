using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Interlinearizer.Crdt.Entities;

namespace Interlinearizer.Host.Papi;

/// <summary>How records are shaped on the Platform.Bible network, as the TypeScript seam expects them.</summary>
internal static class WireJson
{
    /// <summary>
    /// Leaves a record's project off the wire: a repository serves one project, so its records
    /// never name it.
    /// </summary>
    public static void Configure(JsonSerializerOptions options)
    {
        options.TypeInfoResolver = (options.TypeInfoResolver ?? new DefaultJsonTypeInfoResolver())
            .WithAddedModifier(HideProject);
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
}
