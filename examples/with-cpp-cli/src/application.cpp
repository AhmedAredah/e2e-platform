// SPDX-License-Identifier: MIT
#include "calculator/application.h"

#include <cmath>
#include <stdexcept>
#include "calculator/result.h"

namespace calculator {
CalculatorApplication::CalculatorApplication(const CommandLineParser& parser, const BinaryOperation& operation, const ResultWriter& writer)
    : parser_(parser), operation_(operation), writer_(writer) {}

int CalculatorApplication::run(int argc, char** argv, std::istream& input, std::ostream& output, std::ostream& errors) const {
    try {
        const Options options = parser_.parse(argc, argv, operation_.name(), input);
        double value = operation_.evaluate(options.a, options.b);
        // Deliberately planted defect: a successful process can still export a wrong result.
        if (options.wrong_output) value += 1.0;
        if (!std::isfinite(value)) throw std::runtime_error("result is not finite");
        writer_.write(Result{operation_.name(), options.a, options.b, value}, options.output, output);
        return 0;
    } catch (const std::exception& error) {
        errors << "error: " << error.what() << '\n';
        return 2;
    }
}
}  // namespace calculator
