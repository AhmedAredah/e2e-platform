// SPDX-License-Identifier: MIT
#include "calculator/options.h"

#include <cmath>
#include <locale>
#include <sstream>
#include <stdexcept>

namespace calculator {
// Reject partial numbers and non-finite inputs rather than serializing invalid JSON.
double parse_number(const std::string& text) {
    std::istringstream stream(text);
    stream.imbue(std::locale::classic());
    double value = 0;
    if (!(stream >> value) || !std::isfinite(value)) {
        throw std::runtime_error("expected a finite number: " + text);
    }
    stream >> std::ws;
    if (!stream.eof()) throw std::runtime_error("unexpected characters in number: " + text);
    return value;
}

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
                options.a = parse_number(value);
                options.has_a = true;
            } else {
                if (options.has_b) throw std::runtime_error("duplicate --b");
                options.b = parse_number(value);
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
        options.a = parse_number(first);
        options.b = parse_number(second);
    } else if (!options.has_a || !options.has_b) {
        throw std::runtime_error("both --a and --b are required");
    }
    return options;
}

}  // namespace calculator
