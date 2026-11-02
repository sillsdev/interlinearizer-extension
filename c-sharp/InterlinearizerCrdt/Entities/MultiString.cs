namespace Interlinearizer.Crdt.Entities;

/// <summary>
/// A string value keyed by BCP 47 writing-system tag. A missing key means no value in that
/// language.
/// </summary>
public class MultiString : Dictionary<string, string>
{
    public MultiString()
    {
    }

    public MultiString(IDictionary<string, string> values) : base(values)
    {
    }

    public MultiString Copy() => new(this);
}
