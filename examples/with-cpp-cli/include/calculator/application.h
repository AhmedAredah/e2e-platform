// SPDX-License-Identifier: MIT
#pragma once

#include <istream>
#include <ostream>
#include "calculator/operation.h"
#include "calculator/options.h"
#include "calculator/writer.h"

namespace calculator {
class CalculatorApplication {
public:
    CalculatorApplication(const CommandLineParser& parser, const BinaryOperation& operation, const ResultWriter& writer);
    int run(int argc, char** argv, std::istream& input, std::ostream& output, std::ostream& errors) const;

private:
    const CommandLineParser& parser_;
    const BinaryOperation& operation_;
    const ResultWriter& writer_;
};
}  // namespace calculator
