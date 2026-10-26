"""Small extensible arithmetic domain shared by CLI and HTTP entry points."""
from abc import ABC, abstractmethod
import math


class Operation(ABC):
    @abstractmethod
    def evaluate(self, left: float, right: float) -> float:
        """Return a finite result for two finite operands."""


class SumOperation(Operation):
    def evaluate(self, left: float, right: float) -> float:
        return left + right


class PlantedFault(Operation):
    """Deliberate wrong-result decorator; negative verification must catch it."""
    def __init__(self, operation: Operation):
        self._operation = operation

    def evaluate(self, left: float, right: float) -> float:
        return self._operation.evaluate(left, right) + 1


class Calculator:
    def __init__(self, operation: Operation):
        self._operation = operation

    def calculate(self, left: str, right: str) -> dict:
        a, b = float(left), float(right)
        result = self._operation.evaluate(a, b)
        if not all(math.isfinite(value) for value in (a, b, result)):
            raise ValueError("operands and result must be finite")
        return {"schemaVersion": 1, "operation": "sum", "operands": [a, b], "sum": result}
