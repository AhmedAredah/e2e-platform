// SPDX-License-Identifier: MIT
#pragma once
#include "calculator/operation.h"
#include <string>

namespace calculator {
struct HttpResponse { int status; std::string body; };

/** Application-level request contract, independent of the socket transport. */
class HttpHandler {
public:
    virtual ~HttpHandler() = default;
    virtual HttpResponse handle(const std::string& method, const std::string& target) const = 0;
};

/** Small arithmetic reference handler with an explicit injectable wrong-result mode. */
class CalculatorHttpHandler final : public HttpHandler {
public:
    CalculatorHttpHandler(const BinaryOperation& operation, bool wrongResult);
    HttpResponse handle(const std::string& method, const std::string& target) const override;
private:
    const BinaryOperation& operation_;
    bool wrongResult_;
};

/** Bounded loopback-only HTTP fixture; deliberately not a production web server. */
class LoopbackHttpServer final {
public:
    explicit LoopbackHttpServer(const HttpHandler& handler);
    void serve() const;
private:
    const HttpHandler& handler_;
};
} // namespace calculator
