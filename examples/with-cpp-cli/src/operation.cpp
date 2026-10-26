// SPDX-License-Identifier: MIT
#include "calculator/operation.h"

namespace calculator {
std::string SumOperation::name() const { return "sum"; }
double SumOperation::evaluate(double a, double b) const { return a + b; }
}  // namespace calculator
