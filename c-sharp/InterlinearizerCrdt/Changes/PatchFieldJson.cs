using System.Collections.Concurrent;
using System.Linq.Expressions;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;

namespace Interlinearizer.Crdt.Changes;

/// <summary>
/// How a <see cref="PatchField{T}"/> is stored: a set field as its value, null included, and an
/// unset field as no property at all, which is the only way it reads back as unset.
/// </summary>
public static class PatchFieldJson
{
    private static readonly ConcurrentDictionary<Type, Func<object, bool>> HasValueGetters = new();

    public static void Configure(JsonSerializerOptions options)
    {
        options.TypeInfoResolver = (options.TypeInfoResolver ?? new DefaultJsonTypeInfoResolver())
            .WithAddedModifier(SkipUnsetPatchFields);
    }

    private static void SkipUnsetPatchFields(JsonTypeInfo typeInfo)
    {
        foreach (var property in typeInfo.Properties)
        {
            if (!IsPatchField(property.PropertyType)) continue;
            var hasValue = HasValueGetters.GetOrAdd(property.PropertyType, CompileHasValue);
            property.ShouldSerialize = (_, value) => value is not null && hasValue(value);
        }
    }

    private static bool IsPatchField(Type type) =>
        type.IsGenericType && type.GetGenericTypeDefinition() == typeof(PatchField<>);

    private static Func<object, bool> CompileHasValue(Type patchFieldType)
    {
        var boxed = Expression.Parameter(typeof(object), "field");
        var hasValue = Expression.Property(Expression.Convert(boxed, patchFieldType), nameof(PatchField<int>.HasValue));
        return Expression.Lambda<Func<object, bool>>(hasValue, boxed).Compile();
    }
}
