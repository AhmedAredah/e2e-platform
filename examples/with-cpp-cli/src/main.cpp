// SPDX-License-Identifier: MIT
#include <iostream>
#include <filesystem>
#include <string>
#include <vector>
#include "calculator/application.h"

namespace {
int run(int argc, char** argv) {
    const calculator::CommandLineParser parser;
    const calculator::SumOperation operation;
    const calculator::JsonResultWriter writer;
    const calculator::CalculatorApplication application(parser, operation, writer);
    return application.run(argc, argv, std::cin, std::cout, std::cerr);
}
}  // namespace

#ifdef _WIN32
// Preserve the Windows Unicode command line before applying UTF-8 parser contracts.
int wmain(int argc, wchar_t** argv) {
    std::vector<std::string> arguments;
    arguments.reserve(static_cast<std::size_t>(argc));
    for (int i = 0; i < argc; ++i) {
        const auto bytes = std::filesystem::path(argv[i]).u8string();
        arguments.emplace_back(bytes.begin(), bytes.end());
    }
    std::vector<char*> pointers;
    pointers.reserve(arguments.size());
    for (auto& argument : arguments) pointers.push_back(argument.data());
    return run(argc, pointers.data());
}
#else
int main(int argc, char** argv) { return run(argc, argv); }
#endif
