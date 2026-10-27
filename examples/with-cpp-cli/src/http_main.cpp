// SPDX-License-Identifier: MIT
#include "calculator/http_server.h"
#include <exception>
#include <iostream>
#include <string>
#include <stdexcept>

int main(int argc, char** argv) {
    try {
        bool wrong = false;
        for (int i = 1; i < argc; ++i) {
            if (std::string(argv[i]) == "--wrong-result" && !wrong) wrong = true;
            else throw std::runtime_error("only --wrong-result is accepted");
        }
        calculator::SumOperation operation;
        calculator::CalculatorHttpHandler handler(operation, wrong);
        calculator::LoopbackHttpServer(handler).serve();
    } catch (const std::exception& error) {
        std::cerr << "HTTP fixture error: " << error.what() << '\n';
        return 2;
    }
}
