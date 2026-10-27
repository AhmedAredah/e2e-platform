// SPDX-License-Identifier: MIT
#pragma once
#include <e2e/protocol.hpp>
#include <optional>
#include <limits>
#include <utility>
#include <vector>

namespace e2e {
class Assertions;

/** Immutable selector composition; controls are re-resolved by the shared runner. */
class Locator {
public:
    explicit Locator(Transport& transport, Json selector = Json::array()) : transport_(transport), selector_(std::move(selector)) {}
    Locator get_by_role(const std::string& role, const std::optional<std::string>& name = std::nullopt, bool exact = false) const {
        Json step{{"kind", "role"}, {"value", role}, {"exact", exact}};
        if (name) step["name"] = *name;
        return append(std::move(step));
    }
    Locator get_by_text(const std::string& text, bool exact = false) const { return named("text", text, exact); }
    Locator get_by_label(const std::string& text, bool exact = false) const { return named("label", text, exact); }
    Locator get_by_placeholder(const std::string& text, bool exact = false) const { return named("placeholder", text, exact); }
    Locator get_by_test_id(const std::string& id) const { return named("testId", id, true); }
    Locator get_by_display_value(const std::string& value, bool exact = false) const { return named("displayValue", value, exact); }
    void click() const { action("tap"); }
    void clear() const { action("clear"); }
    void focus() const { action("focus"); }
    void hover() const { action("hover"); }
    void double_click() const { action("doubleTap"); }
    void secondary_click() const { action("secondaryTap"); }
    void fill(const std::string& value) const { action("fill", value); }
    void press(const std::string& key) const { action("press", key); }
    void check() const { action("check"); }
    void uncheck() const { action("uncheck"); }
    void select_option(const std::string& value) const { action("selectOption", value); }
    void scroll_into_view() const { action("scrollIntoView"); }
    std::optional<std::string> text_content() const { return read_text("textContent"); }
    std::optional<std::string> input_value() const { return read_text("inputValue"); }
    std::size_t count() const {
        const auto value = read("count");
        if (!value.is_number_integer() || value < 0 || value > 9007199254740991ULL || value > std::numeric_limits<std::size_t>::max()) transport_.reject_result();
        return value.get<std::size_t>();
    }
    Assertions expect() const;
private:
    friend class Assertions;
    Transport& transport_;
    Json selector_;
    Locator append(Json step) const { auto selector = selector_; selector.push_back(std::move(step)); return Locator(transport_, std::move(selector)); }
    Locator named(const char* kind, const std::string& value, bool exact) const { return append(Json{{"kind", kind}, {"value", value}, {"exact", exact}}); }
    void action(const char* name, const std::optional<std::string>& value = std::nullopt) const {
        Json params{{"selector", selector_}, {"action", name}};
        if (value) params["value"] = *value;
        transport_.call_void("locator.action", params);
    }
    Json read(const char* property) const { return transport_.call("locator.read", Json{{"selector", selector_}, {"property", property}}); }
    std::optional<std::string> read_text(const char* property) const {
        const auto value = read(property);
        if (value.is_null()) return std::nullopt;
        if (!value.is_string()) transport_.reject_result();
        return value.get<std::string>();
    }
};

/** Polling assertions execute in the shared runner and retain its report semantics. */
class Assertions final {
public:
    explicit Assertions(Locator locator) : locator_(std::move(locator)) {}
    Assertions message(std::string value) const { auto copy = *this; copy.message_ = std::move(value); return copy; }
    Assertions not_() const { auto copy = *this; copy.negate_ = !copy.negate_; return copy; }
    Assertions timeout_ms(std::uint32_t timeout) const { auto copy = *this; copy.timeout_ = timeout; return copy; }
    void to_be_visible() const { check("toBeVisible"); }
    void to_be_hidden() const { check("toBeHidden"); }
    void to_be_enabled() const { check("toBeEnabled"); }
    void to_be_disabled() const { check("toBeDisabled"); }
    void to_be_checked() const { check("toBeChecked"); }
    void to_have_text(const std::string& text) const { check("toHaveText", text); }
    void to_contain_text(const std::string& text) const { check("toContainText", text); }
    void to_have_value(const std::string& value) const { check("toHaveValue", value); }
    void to_have_count(std::size_t count) const { check("toHaveCount", count); }
private:
    Locator locator_;
    bool negate_ = false;
    std::string message_;
    std::optional<std::uint32_t> timeout_;
    void check(const char* matcher, std::optional<Json> expected = std::nullopt) const {
        Json params{{"selector", locator_.selector_}, {"matcher", matcher}, {"negate", negate_}};
        if (expected) params["expected"] = *expected;
        if (timeout_) params["timeoutMs"] = *timeout_;
        if (!message_.empty()) params["message"] = message_;
        locator_.transport_.call_void("locator.assert", params);
    }
};
inline Assertions Locator::expect() const { return Assertions(*this); }
inline Assertions expect(const Locator& locator) { return locator.expect(); }

/** Application lifetime stays owned by the parent runner's attempt. */
class App final {
public:
    explicit App(Transport& transport) : transport_(transport) {}
    void open(const std::optional<std::string>& path = std::nullopt) const { Json params = Json::object(); if (path) params["path"] = *path; transport_.call_void("app.open", params); }
    void restart() const { transport_.call_void("app.restart", Json::object()); }
    void clear_state() const { transport_.call_void("app.clearState", Json::object()); }
    void back() const { transport_.call_void("app.back", Json::object()); }
    Json screenshot(const std::optional<std::string>& label = std::nullopt) const { Json params = Json::object(); if (label) params["label"] = *label; return transport_.call("app.screenshot", params); }
    std::optional<std::string> base_url() const {
        const auto result = transport_.call("app.baseUrl", Json::object());
        if (result.is_null()) return std::nullopt;
        if (!result.is_string()) transport_.reject_result();
        return result.get<std::string>();
    }
private:
    Transport& transport_;
};

struct ProcessResult {
    std::string status;
    std::optional<std::int64_t> exit_code;
    std::string stdout_text;
    std::string stderr_text;
    bool truncated;
};

/** Finite subprocesses use the same supervisor and cleanup contract as TypeScript tests. */
class Processes final {
public:
    explicit Processes(Transport& transport) : transport_(transport) {}
    ProcessResult run(const std::string& executable, const std::vector<std::string>& args = {}, std::uint32_t timeout_ms = 5000,
                      const std::optional<std::string>& input = std::nullopt, const std::vector<std::int64_t>& expected_exit_codes = {0}) const {
        Json params{{"executable", executable}, {"args", args}, {"timeoutMs", timeout_ms}, {"expectedExitCodes", expected_exit_codes}};
        if (input) params["stdin"] = *input;
        const auto result = transport_.call("process.run", params);
        try {
            if (!result.is_object() || result.size() != 5 || !result.contains("status") || !result.contains("exitCode") || !result.contains("stdout") || !result.contains("stderr") || !result.contains("truncated")) transport_.reject_result();
            if (!result.at("status").is_string() || !result.at("stdout").is_string() || !result.at("stderr").is_string() || !result.at("truncated").is_boolean()) transport_.reject_result();
            const auto status = result.at("status").get<std::string>();
            if (status != "exited" && status != "signaled" && status != "timed-out" && status != "aborted" && status != "stopped") transport_.reject_result();
            const auto& code = result.at("exitCode");
            if ((status == "exited" && code.is_null()) || (!code.is_null() && (!code.is_number_integer() || code < 0 || code > 4294967295ULL))) transport_.reject_result();
            return {status, code.is_null() ? std::nullopt : std::optional<std::int64_t>(code.get<std::int64_t>()),
                    result.at("stdout").get<std::string>(), result.at("stderr").get<std::string>(), result.at("truncated").get<bool>()};
        } catch (...) { transport_.reject_result(); }
    }
private:
    Transport& transport_;
};

struct HttpResponse {
    int status;
    Json headers;
    std::string body;
    Json json(JsonNumberPolicy policy = JsonNumberPolicy::exact) const { return parse_json(body, policy); }
};

/** Bounded HTTP exchanges are executed by the parent's installed protocol client. */
class Http final {
public:
    explicit Http(Transport& transport) : transport_(transport) {}
    HttpResponse request(const std::string& url, const std::string& method = "GET", const Json& headers = Json::object(),
                         const std::optional<std::string>& body = std::nullopt, std::uint32_t timeout_ms = 5000) const {
        Json params{{"url", url}, {"method", method}, {"headers", headers}, {"timeoutMs", timeout_ms}};
        if (body) params["body"] = *body;
        const auto result = transport_.call("http.request", params);
        try {
            if (!result.is_object() || result.size() != 3 || !result.contains("status") || !result.contains("headers") || !result.contains("body")) transport_.reject_result();
            const auto& status = result.at("status");
            const auto& headers = result.at("headers");
            if (!status.is_number_integer() || status < 100 || status > 599 || !headers.is_object() || !result.at("body").is_string()) transport_.reject_result();
            for (const auto& header : headers.items()) if (!header.value().is_string()) transport_.reject_result();
            return {status.get<int>(), headers, result.at("body").get<std::string>()};
        } catch (...) { transport_.reject_result(); }
    }
    HttpResponse get(const std::string& url) const { return request(url); }
    HttpResponse post_json(const std::string& url, const Json& body) const {
        return request(url, "POST", Json{{"content-type", "application/json"}}, transport_.encode_value(body));
    }
private:
    Transport& transport_;
};

/** One registered C++ test body receives one session; it never owns the parent scheduler. */
class Session final {
public:
    explicit Session(Transport& transport) : transport_(transport) {}
    App app() const { return App(transport_); }
    Locator screen() const { return Locator(transport_); }
    Processes processes() const { return Processes(transport_); }
    Http http() const { return Http(transport_); }
    void expect_equal(const Json& actual, const Json& expected, const std::string& message = "C++ equality assertion failed") const {
        const auto actual_text = transport_.encode_value(actual);
        const auto expected_text = transport_.encode_value(expected);
        transport_.call_void("expect.equal", Json{{"actual", actual_text}, {"expected", expected_text}, {"message", message}});
    }
    void expect_true(bool actual) const { transport_.call_void("expect.true", Json{{"actual", actual}}); }
private:
    Transport& transport_;
};
} // namespace e2e
