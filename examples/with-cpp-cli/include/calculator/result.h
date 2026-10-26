// SPDX-License-Identifier: MIT
#pragma once

#include <string>

namespace calculator {
struct Result {
    std::string operation;
    double a;
    double b;
    double value;
};
}  // namespace calculator
