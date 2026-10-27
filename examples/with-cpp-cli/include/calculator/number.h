// SPDX-License-Identifier: MIT
#pragma once
#include <cmath>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <string>

namespace calculator {
/** Locale-independent finite binary64 input with explicit rejection of underflow to zero. */
class NumberParser final {
public:
    double parse(const std::string& text, bool allowWhitespace = true) const {
        std::istringstream input(text);
        input.imbue(std::locale::classic());
        if (!allowWhitespace) input >> std::noskipws;
        double value = 0;
        if (!(input >> value) || !std::isfinite(value)) throw std::runtime_error("expected a finite number: " + text);
        if (allowWhitespace) input >> std::ws;
        if (!input.eof()) throw std::runtime_error("expected a finite number: " + text);
        if (value == 0) {
            const auto exponent = text.find_first_of("eE");
            const auto significand = text.substr(0, exponent);
            if (significand.find_first_of("123456789") != std::string::npos)
                throw std::runtime_error("number underflows binary64");
        }
        return value;
    }
};
} // namespace calculator
