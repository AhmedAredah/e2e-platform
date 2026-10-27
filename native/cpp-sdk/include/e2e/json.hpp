// SPDX-License-Identifier: MIT
#pragma once
#include <e2e/error.hpp>
#include <nlohmann/json.hpp>
#include <cmath>
#include <string_view>
#include <unordered_set>
#include <vector>

namespace e2e {
using Json = nlohmann::json;
inline constexpr std::size_t max_protocol_line = 1024 * 1024;
/** Exact preserves decimal round trips; binary64 explicitly permits rounding and underflow. */
enum class JsonNumberPolicy { exact, binary64 };

namespace detail {
/** Matches parsed numeric values to their original tokens without copying the document. */
class JsonNumbers final {
public:
    explicit JsonNumbers(std::string_view source) : source_(source) {}
    void validate(const Json& value, JsonNumberPolicy policy) {
        while (cursor_ < source_.size()) {
            const char ch = source_[cursor_++];
            if (ch == '"') {
                while (cursor_ < source_.size()) {
                    const char quoted = source_[cursor_++];
                    if (quoted == '\\') { if (cursor_ < source_.size()) ++cursor_; }
                    else if (quoted == '"') break;
                }
            } else if (ch == '-' || (ch >= '0' && ch <= '9')) {
                const auto start = cursor_ - 1;
                while (cursor_ < source_.size() && std::string_view("0123456789.eE+-").find(source_[cursor_]) != std::string_view::npos) ++cursor_;
                const auto token = source_.substr(start, cursor_ - start);
                if (token.size() > 4096) throw Error("Numeric literal exceeds the parsing limit");
                if (policy == JsonNumberPolicy::exact && canonical(token) != canonical(value.dump()))
                    throw Error("JSON number loses decimal precision; preserve it as a string or select binary64 explicitly");
                return;
            }
        }
        throw Error("Invalid numeric token");
    }
private:
    std::string_view source_;
    std::size_t cursor_ = 0;
    static std::string canonical(std::string_view token) {
        const bool negative = token.front() == '-';
        if (negative) token.remove_prefix(1);
        const auto exponent_at = token.find_first_of("eE");
        const auto mantissa = token.substr(0, exponent_at);
        const auto point = mantissa.find('.');
        std::string digits(mantissa);
        if (point != std::string_view::npos) digits.erase(point, 1);
        const auto first = digits.find_first_not_of('0');
        if (first == std::string::npos) return "0";
        digits.erase(0, first);
        // Valid, nonzero binary64 results have small exponents. Oversized exponents
        // fail closed instead of overflowing normalization arithmetic.
        long long exponent = 0;
        if (exponent_at != std::string_view::npos) {
            const auto text = token.substr(exponent_at + 1);
            std::size_t used = 0;
            exponent = std::stoll(std::string(text), &used);
            if (used != text.size() || exponent < -1000000 || exponent > 1000000) throw Error("Numeric exponent exceeds the parsing limit");
        }
        if (point != std::string_view::npos) exponent -= static_cast<long long>(mantissa.size() - point - 1);
        const auto last = digits.find_last_not_of('0');
        exponent += static_cast<long long>(digits.size() - last - 1);
        digits.resize(last + 1);
        return (negative ? "-" : "") + digits + "e" + std::to_string(exponent);
    }
};
} // namespace detail

/** Rejects values serialization would silently replace before any wire operation. */
inline void validate_json_value(const Json& value, std::size_t depth = 0) {
    if (depth > 64) throw Error("JSON nesting exceeds the protocol limit");
    if (value.is_number_float() && !std::isfinite(value.get<double>())) throw Error("Nonfinite JSON numbers are not supported");
    if (value.is_discarded() || value.is_binary()) throw Error("Unsupported JSON value");
    if (value.is_structured()) for (const auto& child : value) validate_json_value(child, depth + 1);
}

/** Parses bounded JSON, rejecting duplicate keys, excessive nesting and silent numeric loss. */
inline Json parse_json(const std::string& text, JsonNumberPolicy policy = JsonNumberPolicy::exact) {
    if (text.size() > max_protocol_line) throw Error("JSON exceeds the protocol limit");
    if (policy != JsonNumberPolicy::exact && policy != JsonNumberPolicy::binary64) throw Error("Invalid JSON number policy");
    std::vector<std::unordered_set<std::string>> keys;
    detail::JsonNumbers numbers(text);
    try {
        return Json::parse(text, [&keys, &numbers, policy](int depth, Json::parse_event_t event, Json& value) {
            if (depth > 64) throw Error("JSON nesting exceeds the protocol limit");
            if (event == Json::parse_event_t::object_start) keys.emplace_back();
            else if (event == Json::parse_event_t::object_end) keys.pop_back();
            else if (event == Json::parse_event_t::key && !keys.back().insert(value.get<std::string>()).second) throw Error("JSON contains duplicate object keys");
            else if (event == Json::parse_event_t::value && value.is_number()) numbers.validate(value, policy);
            return true;
        });
    } catch (...) { throw Error("Invalid or lossy JSON"); }
}
} // namespace e2e
