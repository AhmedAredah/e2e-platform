// SPDX-License-Identifier: MIT
#include <e2e/test.hpp>
#include <sstream>
#include <iostream>

namespace {
void require(bool condition, const char* label) { if (!condition) throw std::runtime_error(label); }
void rejects(const std::string& response) {
    std::istringstream input(response);
    std::ostringstream output;
    e2e::StdioTransport transport(input, output);
    bool rejected = false;
    try { transport.call("expect.true", {{"actual", true}}); }
    catch (const e2e::Error& error) { rejected = true; require(std::string(error.what()).find("sensitive-fixture") == std::string::npos, "remote diagnostic leaked"); }
    require(rejected, "invalid response accepted");
    const auto first = output.str();
    try { transport.call("expect.true", {{"actual", true}}); } catch (const e2e::Error&) {}
    require(output.str() == first, "poisoned transport retried a request");
}

void rejects_void_results() {
    const std::vector<std::function<void(e2e::Session&)>> operations = {
        [](auto& session) { session.app().open(); },
        [](auto& session) { session.app().restart(); },
        [](auto& session) { session.app().clear_state(); },
        [](auto& session) { session.app().back(); },
        [](auto& session) { session.screen().get_by_test_id("button").click(); },
        [](auto& session) { session.screen().get_by_test_id("button").expect().to_be_visible(); },
        [](auto& session) { session.expect_equal(1, 1); },
        [](auto& session) { session.expect_true(true); },
    };
    for (const auto& operation : operations) {
        std::istringstream input("{\"protocol\":2,\"id\":1,\"result\":false}\n");
        std::ostringstream output;
        e2e::StdioTransport transport(input, output);
        e2e::Session session(transport);
        bool rejected = false;
        try { operation(session); } catch (const e2e::Error&) { rejected = true; }
        require(rejected && transport.failed(), "malformed void acknowledgement did not poison the transport");
        const auto before = output.str();
        try { session.expect_true(true); } catch (const e2e::Error&) {}
        require(output.str() == before, "malformed acknowledgement allowed another request");
    }
}

void caught_failures_still_fail() {
    for (const auto* response : {
        "{\"protocol\":2,\"id\":1,\"error\":{\"message\":\"private diagnostic\"}}\n",
        "{\"protocol\":2,\"id\":1,\"result\":false}\n",
    }) {
        e2e::registry().clear();
        e2e::registry().push_back({"caught failure", [](e2e::Session& session) {
            try { session.expect_true(true); } catch (const e2e::Error&) {}
        }});
        std::string operation(response);
        operation.replace(operation.find("\"id\":1"), 6, "\"id\":2");
        std::istringstream input("{\"protocol\":2,\"id\":1,\"result\":null}\n" + operation);
        std::ostringstream output;
        auto* original_input = std::cin.rdbuf(input.rdbuf());
        auto* original_output = std::cout.rdbuf(output.rdbuf());
        char executable[] = "test-binary", option[] = "--e2e-case", name[] = "caught failure";
        char* args[] = {executable, option, name};
        const int status = e2e::run(3, args);
        std::cin.rdbuf(original_input); std::cout.rdbuf(original_output);
        e2e::registry().clear();
        require(status != 0, "caught operation failure produced a successful test exit");
    }
}

void lossless_numbers_and_local_failures() {
    const auto frame = e2e::Json{{"protocol",2},{"id",1},{"result",nullptr}}.dump()+"\n";
    {
        std::istringstream input(frame); std::ostringstream output; e2e::StdioTransport transport(input,output); e2e::Session session(transport);
        session.expect_equal(e2e::Json{{"wide",18446744073709551615ULL}}, e2e::Json{{"wide",18446744073709551614ULL}});
        const auto params=e2e::parse_json(output.str()).at("params");
        require(params.at("actual")=="{\"wide\":18446744073709551615}","uint64 lost before wire");
        require(params.at("expected")=="{\"wide\":18446744073709551614}","distinct uint64 lost before wire");
    }
    for (const double number : {std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()}) {
        for (const bool http : {false,true}) {
            std::istringstream input(frame); std::ostringstream output; e2e::StdioTransport transport(input,output); e2e::Session session(transport);
            try { if(http) session.http().post_json("http://localhost/",{{"nested",{number}}}); else session.expect_equal({{"nested",{number}}},nullptr); }
            catch(const e2e::Error&) {}
            require(transport.failed() && output.str().empty(),"nonfinite value serialized or caught failure erased");
        }
    }
}

void validates_typed_results() {
    const e2e::Json process{{"status", "exited"}, {"exitCode", 4294967295ULL}, {"stdout", "ok"}, {"stderr", ""}, {"truncated", false}};
    const e2e::Json http{{"status", 200}, {"headers", {{"content-type", "application/json"}}}, {"body", "{}"}};
    const auto frame = [](const e2e::Json& result) { return e2e::Json{{"protocol", 2}, {"id", 1}, {"result", result}}.dump() + '\n'; };
    {
        std::istringstream input(frame(process)); std::ostringstream output;
        e2e::StdioTransport transport(input, output); e2e::Session session(transport);
        const auto result = session.processes().run("fixture", {}, 1000, std::nullopt, {4294967295LL});
        require(result.exit_code == 4294967295LL, "Windows unsigned exit code was narrowed");
        require(e2e::parse_json(output.str())["params"]["expectedExitCodes"][0] == 4294967295LL, "unsigned expected exit code was narrowed");
    }
    {
        std::istringstream input(frame(http)); std::ostringstream output;
        e2e::StdioTransport transport(input, output); e2e::Session session(transport);
        const auto result = session.http().get("http://127.0.0.1/");
        require(result.status == 200 && result.json().is_object(), "valid HTTP result was rejected");
    }
    std::vector<e2e::Json> bad_process;
    for (const auto& code : {e2e::Json(-1), e2e::Json(4294967296ULL), e2e::Json(0.5), e2e::Json("0"), e2e::Json(nullptr)}) {
        auto result = process; result["exitCode"] = code; bad_process.push_back(std::move(result));
    }
    for (const auto& change : {e2e::Json{{"status", "unknown"}}, e2e::Json{{"stdout", 1}}, e2e::Json{{"truncated", "false"}}, e2e::Json{{"unexpected", true}}}) {
        auto result = process; result.update(change); bad_process.push_back(std::move(result));
    }
    auto missing_output = process; missing_output.erase("stdout"); bad_process.push_back(std::move(missing_output));
    std::vector<e2e::Json> bad_http;
    for (const auto& change : {e2e::Json{{"status", 99}}, e2e::Json{{"status", 600}}, e2e::Json{{"status", 200.5}}, e2e::Json{{"headers", e2e::Json::array()}},
        e2e::Json{{"headers", {{"x", true}}}}, e2e::Json{{"body", nullptr}}, e2e::Json{{"unexpected", true}}}) {
        auto result = http; result.update(change); bad_http.push_back(std::move(result));
    }
    for (const bool is_http : {false, true}) {
        for (const auto& result : is_http ? bad_http : bad_process) {
            std::istringstream input(frame(result)); std::ostringstream output;
            e2e::StdioTransport transport(input, output); e2e::Session session(transport);
            bool rejected = false;
            try { if (is_http) session.http().get("http://127.0.0.1/"); else session.processes().run("fixture"); }
            catch (const e2e::Error&) { rejected = true; }
            require(rejected && transport.failed(), "malformed typed result did not poison the transport");
        }
    }
}
}
#ifdef _WIN32
int wmain() {
#else
int main() {
#endif
    try {
        rejects_void_results();
        caught_failures_still_fail();
        validates_typed_results();
        lossless_numbers_and_local_failures();
        std::istringstream input("{\"protocol\":2,\"id\":1,\"result\":null}\n{\"protocol\":2,\"id\":2,\"result\":3}\n");
        std::ostringstream output;
        e2e::StdioTransport transport(input, output);
        e2e::Session session(transport);
        session.screen().get_by_role("dialog", "Project", true).get_by_test_id("save").expect().not_().timeout_ms(2000).to_be_disabled();
        require(session.screen().get_by_test_id("rows").count() == 3, "count result lost");
        std::istringstream records(output.str());
        std::string first; std::getline(records, first);
        const auto request = e2e::parse_json(first);
        require(request["method"] == "locator.assert" && request["params"]["negate"] == true && request["params"]["timeoutMs"] == 2000, "assertion semantics lost");
        require(request["params"]["selector"].size() == 2 && request["params"]["selector"][0]["name"] == "Project", "selector scope lost");
        for (const auto* response : {
            "{\"protocol\":2,\"id\":2,\"result\":null}\n",
            "{\"protocol\":2,\"id\":1.0,\"result\":null}\n",
            "{\"protocol\":3,\"id\":1,\"result\":null}\n",
            "{\"protocol\":2,\"id\":1,\"result\":null,\"extra\":true}\n",
            "{\"protocol\":2,\"id\":1,\"result\":null,\"error\":{}}\n",
            "{\"protocol\":2,\"id\":1,\"id\":1,\"result\":null}\n",
            "{\"protocol\":2,\"id\":1,\"error\":{\"message\":\"sensitive-fixture\"}}\n",
            "{\"protocol\":2,\"id\":1,\"result\":null}",
        }) rejects(response);
        rejects(std::string(e2e::max_protocol_line + 1, 'x') + '\n');
        rejects("{\"protocol\":2,\"id\":1,\"result\":" + std::string(70, '[') + "0" + std::string(70, ']') + "}\n");
        std::ostringstream replies;
        for (std::uint64_t id = 1; id <= e2e::max_protocol_requests; ++id) replies << "{\"protocol\":2,\"id\":" << id << ",\"result\":null}\n";
        std::istringstream limited_input(replies.str());
        std::ostringstream limited_output;
        e2e::StdioTransport limited(limited_input, limited_output);
        for (std::uint64_t id = 1; id <= e2e::max_protocol_requests; ++id) limited.call("expect.true", {{"actual", true}});
        const auto previous = limited_output.str().size();
        bool capped = false;
        try { limited.call("expect.true", {{"actual", true}}); } catch (const e2e::Error&) { capped = true; }
        require(capped && previous == limited_output.str().size(), "request count was not bounded");
        std::cout << "C++ SDK protocol, selectors, limits and failure isolation passed.\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
