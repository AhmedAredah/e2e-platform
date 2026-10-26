using CalculatorDemo;

try { return await new Application().RunAsync(args); }
catch (FormatException error) { Console.Error.WriteLine(error.Message); return 2; }
