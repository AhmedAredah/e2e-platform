// SPDX-License-Identifier: MIT
#pragma once
#include <e2e/json.hpp>
#include <cstdint>
#include <cmath>
#include <istream>
#include <ostream>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>

namespace e2e {
inline constexpr std::uint64_t max_protocol_requests = 10000;
inline constexpr int protocol_version = 2;

/** Alternate hosts implement one synchronous, ordered protocol call boundary. */
class Transport {
public:
    virtual ~Transport() = default;
    virtual Json call(const std::string& method, const Json& params) = 0;
    /** Void operations acknowledge success only with JSON null, never a false or malformed result. */
    void call_void(const std::string& method, const Json& params) {
        if (failed()) throw Error("Protocol connection is unusable");
        try {
            if (!call(method, params).is_null()) throw Error("Invalid void operation response");
        } catch (...) { invalidate(); throw; }
    }
    /** A caught operation failure still makes the registered test fail. */
    bool failed() const noexcept { return failed_; }
    /** Typed clients poison a malformed result just as the wire poisons a malformed envelope. */
    [[noreturn]] void reject_result() { invalidate(); throw Error("Invalid test operation result"); }
    /** Local validation failure must survive a test body catching its exception. */
    [[noreturn]] void reject_value() { invalidate(); throw Error("Unsupported test value"); }
    /** Encodes values losslessly or latches local validation/encoding failures. */
    std::string encode_value(const Json& value) {
        try {
            validate_json_value(value);
            auto text = value.dump();
            if (text.size() > max_protocol_line) reject_value();
            return text;
        } catch (...) { reject_value(); }
    }
protected:
    void invalidate() noexcept { failed_ = true; }
private:
    bool failed_ = false;
};

/** One request at a time over reserved UTF-8 stdin/stdout. Parent owns timeouts and cleanup. */
class StdioTransport final : public Transport {
public:
    StdioTransport(std::istream& input, std::ostream& output) : input_(input), output_(output) {}
    Json call(const std::string& method, const Json& params) override {
        if (failed()) throw Error("Protocol connection is unusable");
        if (next_id_ > max_protocol_requests) { invalidate(); throw Error("Protocol request limit reached"); }
        if (method.empty() || !params.is_object()) { invalidate(); throw Error("Invalid protocol request"); }
        const std::uint64_t id = next_id_++;
        try {
            validate_json_value(params);
            const std::string request = Json{{"protocol", protocol_version}, {"id", id}, {"method", method}, {"params", params}}.dump();
            if (request.size() > max_protocol_line) throw Error("Protocol request is too large");
            output_ << request << '\n' << std::flush;
            if (!output_) throw Error("Protocol output failed");
            std::string line;
            char byte = 0;
            while (input_.get(byte)) {
                if (byte == '\n') break;
                if (line.size() == max_protocol_line) throw Error("Protocol response is too large");
                line.push_back(byte);
            }
            if (!input_ || byte != '\n') throw Error("Protocol response ended before its newline");
            Json response = parse_json(line);
            if (!response.is_object() || response.size() != 3 || !response.contains("protocol") || !response["protocol"].is_number_integer() || response["protocol"] != protocol_version
                || !response.contains("id") || !response["id"].is_number_integer() || response["id"] != id
                || (response.contains("result") == response.contains("error"))) throw Error("Protocol response identity is invalid");
            if (response.contains("error")) {
                const auto& error = response["error"];
                if (!error.is_object() || error.size() != 1 || !error.contains("message") || !error["message"].is_string()) throw Error("Protocol error envelope is invalid");
                invalidate();
                throw Error("Remote test operation failed");
            }
            return response["result"];
        } catch (...) {
            invalidate();
            throw Error("Test operation or protocol exchange failed");
        }
    }
private:
    std::istream& input_;
    std::ostream& output_;
    std::uint64_t next_id_ = 1;
};
} // namespace e2e
