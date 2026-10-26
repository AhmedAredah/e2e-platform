using System.Globalization;
using System.Text.Json.Serialization;

namespace CalculatorDemo.Domain;

public abstract class Operation
{
    public abstract double Evaluate(double left, double right);
}

public sealed class SumOperation : Operation
{
    public override double Evaluate(double left, double right) => left + right;
}

// Deliberate defect for the negative verification gate, never the normal implementation.
public sealed class PlantedFault(Operation operation) : Operation
{
    public override double Evaluate(double left, double right) => operation.Evaluate(left, right) + 1;
}

public sealed record CalculationResult(
    [property: JsonPropertyName("schemaVersion")] int SchemaVersion,
    [property: JsonPropertyName("operation")] string Operation,
    [property: JsonPropertyName("operands")] double[] Operands,
    [property: JsonPropertyName("sum")] double Sum);

public interface ICalculator
{
    CalculationResult Calculate(string left, string right);
}

public sealed class Calculator(Operation operation) : ICalculator
{
    public CalculationResult Calculate(string left, string right)
    {
        var a = double.Parse(left, NumberStyles.Float, CultureInfo.InvariantCulture);
        var b = double.Parse(right, NumberStyles.Float, CultureInfo.InvariantCulture);
        var sum = operation.Evaluate(a, b);
        if (!double.IsFinite(a) || !double.IsFinite(b) || !double.IsFinite(sum))
            throw new FormatException("operands and result must be finite");
        return new(1, "sum", [a, b], sum);
    }
}
