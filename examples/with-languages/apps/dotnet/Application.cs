using System.Net;
using System.Text.Json;
using CalculatorDemo.Domain;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace CalculatorDemo;

public sealed class Application
{
    public async Task<int> RunAsync(string[] rawArguments)
    {
        var wrong = rawArguments.Contains("--wrong-result");
        var arguments = rawArguments.Where(argument => argument != "--wrong-result").ToArray();
        Operation operation = new SumOperation();
        ICalculator calculator = new Calculator(wrong ? new PlantedFault(operation) : operation);
        if (arguments.Length == 3 && arguments[0] == "sum")
        {
            Console.WriteLine(JsonSerializer.Serialize(calculator.Calculate(arguments[1], arguments[2])));
            return 0;
        }
        if (!arguments.SequenceEqual(["serve"]))
            throw new FormatException("usage: sum <a> <b> | serve [--wrong-result]");
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = [] });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));
        await using var app = builder.Build();
        app.MapGet("/health", () => Results.Json(new { ok = true }));
        app.MapGet("/sum", (HttpRequest request) =>
        {
            if (request.Query.Count != 2 || request.Query["a"].Count != 1 || request.Query["b"].Count != 1)
                return Results.Json(new { error = "invalid operands" }, statusCode: 400);
            try { return Results.Json(calculator.Calculate(request.Query["a"].ToString(), request.Query["b"].ToString())); }
            catch (FormatException) { return Results.Json(new { error = "invalid operands" }, statusCode: 400); }
        });
        await app.StartAsync();
        var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses;
        var port = new Uri(addresses.Single()).Port;
        Console.WriteLine("E2E_LANGUAGE_READY " + JsonSerializer.Serialize(new { port }));
        await app.WaitForShutdownAsync();
        return 0;
    }
}
