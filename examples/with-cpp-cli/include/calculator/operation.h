// SPDX-License-Identifier: MIT
#pragma once

#include <string>

namespace calculator {
// Extend this contract for another binary numerical operation.
class BinaryOperation {
public:
    virtual ~BinaryOperation() = default;
    virtual std::string name() const = 0;
    virtual double evaluate(double a, double b) const = 0;
};

class SumOperation final : public BinaryOperation {
public:
    std::string name() const override;
    double evaluate(double a, double b) const override;
};
}  // namespace calculator
