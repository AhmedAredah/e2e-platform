// SPDX-License-Identifier: MIT
#pragma once

#include <istream>
#include <string>

namespace calculator {
struct Options {
    double a = 0;
    double b = 0;
    bool has_a = false;
    bool has_b = false;
    bool read_stdin = false;
    bool wrong_output = false;
    std::string output;
};

class CommandLineParser {
public:
    Options parse(int argc, char** argv, const std::string& operation, std::istream& input) const;
};
}  // namespace calculator
