"""Application boundary keeps argument parsing and transports out of the domain."""
import json
from .operations import Calculator, PlantedFault, SumOperation
from .http_server import CalculatorServer


class Application:
    def run(self, arguments: list[str]) -> int:
        wrong = "--wrong-result" in arguments
        arguments = [argument for argument in arguments if argument != "--wrong-result"]
        operation = SumOperation()
        calculator = Calculator(PlantedFault(operation) if wrong else operation)
        if len(arguments) == 3 and arguments[0] == "sum":
            print(json.dumps(calculator.calculate(arguments[1], arguments[2]), allow_nan=False))
        elif arguments == ["serve"]:
            with CalculatorServer(calculator) as server:
                print("E2E_LANGUAGE_READY " + json.dumps({"port": server.server_port}), flush=True)
                server.serve_forever(poll_interval=0.1)
        else:
            raise ValueError("usage: sum <a> <b> | serve [--wrong-result]")
        return 0
