// SPDX-License-Identifier: MIT
#pragma once
#include <nlohmann/json.hpp>
#include <cstdint>
#include <istream>
#include <ostream>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>

namespace e2e {
using Json = nlohmann::json;
inline constexpr std::size_t max_protocol_line = 1024 * 1024;
inline constexpr std::uint64_t max_protocol_requests = 10000;

/** A bounded diagnostic; never includes application values or remote exception text. */
class Error : public std::runtime_error {
public:
    explicit Error(const char* message) : std::runtime_error(message) {}
};

/** Parses bounded JSON with duplicate-key and excessive-nesting rejection. */
inline Json parse_json(const std::string& text) {
    if (text.size() > max_protocol_line) throw Error("JSON exceeds the protocol limit");
    std::vector<std::unordered_set<std::string>> keys;
    try {
        return Json::parse(text, [&keys](int depth, Json::parse_event_t event, Json& value) {
            if (depth > 64) throw Error("JSON nesting exceeds the protocol limit");
            if (event == Json::parse_event_t::object_start) keys.emplace_back();
            else if (event == Json::parse_event_t::object_end) keys.pop_back();
            else if (event == Json::parse_event_t::key && !keys.back().insert(value.get<std::string>()).second) throw Error("JSON contains duplicate object keys");
            return true;
        });
    } catch (...) { throw Error("Invalid protocol JSON"); }
}

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
        if (next_id_ > max_protocol_requests) throw Error("Protocol request limit reached");
        if (method.empty() || !params.is_object()) throw Error("Invalid protocol request");
        const std::uint64_t id = next_id_++;
        try {
            const std::string request = Json{{"protocol", 1}, {"id", id}, {"method", method}, {"params", params}}.dump();
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
            if (!response.is_object() || response.size() != 3 || !response.contains("protocol") || !response["protocol"].is_number_integer() || response["protocol"] != 1
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
