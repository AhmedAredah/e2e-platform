// SPDX-License-Identifier: MIT
#include "calculator/options.h"
#include "calculator/number.h"

#include <cmath>
#include <locale>
#include <sstream>
#include <stdexcept>

namespace calculator {
Options CommandLineParser::parse(int argc, char** argv, const std::string& operation, std::istream& input) const {
    if (argc < 2 || std::string(argv[1]) != operation) {
        throw std::runtime_error("usage: e2e_cpp_calculator sum (--a NUMBER --b NUMBER | --stdin) [--output PATH] [--wrong-output]");
    }
    Options options;
    for (int i = 2; i < argc; ++i) {
        const std::string flag(argv[i]);
        if (flag == "--stdin") {
            if (options.read_stdin) throw std::runtime_error("duplicate --stdin");
            options.read_stdin = true;
        } else if (flag == "--wrong-output") {
            if (options.wrong_output) throw std::runtime_error("duplicate --wrong-output");
            options.wrong_output = true;
        } else if (flag == "--a" || flag == "--b" || flag == "--output") {
            if (++i >= argc) throw std::runtime_error("missing value for " + flag);
            const std::string value(argv[i]);
            if (flag == "--output") {
                if (!options.output.empty()) throw std::runtime_error("duplicate --output");
                if (value.empty()) throw std::runtime_error("output path cannot be empty");
                options.output = value;
            } else if (flag == "--a") {
                if (options.has_a) throw std::runtime_error("duplicate --a");
                options.a = NumberParser{}.parse(value);
                options.has_a = true;
            } else {
                if (options.has_b) throw std::runtime_error("duplicate --b");
                options.b = NumberParser{}.parse(value);
                options.has_b = true;
            }
        } else {
            throw std::runtime_error("unknown option: " + flag);
        }
    }
    if (options.read_stdin) {
        if (options.has_a || options.has_b) throw std::runtime_error("--stdin cannot be combined with --a or --b");
        std::string first;
        std::string second;
        std::string extra;
        if (!(input >> first >> second) || (input >> extra)) {
            throw std::runtime_error("stdin must contain exactly two numbers");
        }
        options.a = NumberParser{}.parse(first);
        options.b = NumberParser{}.parse(second);
    } else if (!options.has_a || !options.has_b) {
        throw std::runtime_error("both --a and --b are required");
    }
    return options;
}

}  // namespace calculator
