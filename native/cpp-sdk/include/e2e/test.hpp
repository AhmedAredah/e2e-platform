// SPDX-License-Identifier: MIT
#pragma once
#include <e2e/session.hpp>
#include <functional>
#include <iostream>
#include <unordered_set>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace e2e {
struct TestCase { std::string name; std::function<void(Session&)> body; std::string file; int line = 0; };
inline std::vector<TestCase>& registry() { static std::vector<TestCase> tests; return tests; }

/** Static registration never starts a process, connects a driver or runs test code. */
class RegisterTest final {
public:
    RegisterTest(std::string name, std::function<void(Session&)> body, std::string file = {}, int line = 0) {
        const auto separator = file.find_last_of("/\\");
        if (separator != std::string::npos) file.erase(0, separator + 1);
        registry().push_back({std::move(name), std::move(body), std::move(file), line});
    }
};

/** Keeps ordinary std::cout diagnostics off the reserved wire for the entire test body. */
class RedirectDiagnostics final {
public:
    RedirectDiagnostics() : saved_(std::cout.rdbuf(std::cerr.rdbuf())) {}
    ~RedirectDiagnostics() { std::cout.rdbuf(saved_); }
    RedirectDiagnostics(const RedirectDiagnostics&) = delete;
    RedirectDiagnostics& operator=(const RedirectDiagnostics&) = delete;
private:
    std::streambuf* saved_;
};

/** Discovery and one-case execution are separate; the parent controls retries and workers. */
inline int run(int argc, char** argv) {
    try {
        std::unordered_set<std::string> names;
        if (registry().empty() || registry().size() > 10000) throw Error("Invalid C++ test registration count");
        for (const auto& test : registry()) {
            bool invalid_name = test.name.empty() || test.name.size() > 1024;
            for (const unsigned char character : test.name) if (character < 0x20 || character == 0x7f) invalid_name = true;
            if (!test.name.empty() && (test.name.front() == ' ' || test.name.back() == ' ')) invalid_name = true;
            if (invalid_name || !names.insert(test.name).second) throw Error("Invalid or duplicate C++ test registration");
        }
        if (argc == 2 && std::string(argv[1]) == "--e2e-list") {
            Json tests = Json::array();
            for (const auto& test : registry()) tests.push_back(test.name);
            const auto frame = Json{{"protocol", protocol_version}, {"tests", tests}}.dump();
            if (frame.size() > max_protocol_line) throw Error("C++ discovery exceeds protocol limit");
            std::cout << frame << '\n' << std::flush;
            return std::cout ? 0 : 2;
        }
        if (argc != 3 || std::string(argv[1]) != "--e2e-case") { std::cerr << "Usage: test-binary --e2e-list | --e2e-case NAME\n"; return 2; }
        for (const auto& test : registry()) {
            if (test.name != argv[2]) continue;
            std::ostream wire(std::cout.rdbuf());
            StdioTransport transport(std::cin, wire);
            Session session(transport);
            RedirectDiagnostics diagnostics;
            try {
                Json started{{"name", test.name}};
                if (!test.file.empty() && test.line > 0) started["source"] = Json{{"file",test.file},{"line",test.line}};
                transport.call_void("case.start", started);
                test.body(session);
                if (transport.failed()) throw Error("A test operation failed before the body returned");
                transport.call_void("case.complete", Json::object());
                return 0;
            }
            catch (...) { std::cerr << "C++ test failed; see the parent runner report.\n"; return 1; }
        }
        std::cerr << "Unknown C++ test case.\n";
        return 2;
    } catch (...) { std::cerr << "C++ test discovery or protocol setup failed.\n"; return 2; }
}
#ifdef _WIN32
/** Converts native UTF-16 arguments without the active ANSI code page. */
inline int run(int argc, wchar_t** argv) {
    try {
        std::vector<std::string> storage;
        std::vector<char*> arguments;
        for (int i = 0; i < argc; ++i) {
            const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, nullptr, 0, nullptr, nullptr);
            if (size <= 0) throw Error("Invalid UTF-16 test argument");
            std::string value(static_cast<std::size_t>(size), '\0');
            if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, value.data(), size, nullptr, nullptr) != size)
                throw Error("Test argument conversion failed");
            value.pop_back(); storage.push_back(std::move(value));
        }
        for (auto& argument : storage) arguments.push_back(argument.data());
        arguments.push_back(nullptr);
        return run(argc, arguments.data());
    } catch (...) { std::cerr << "C++ test argument conversion failed.\n"; return 2; }
}
#endif
} // namespace e2e

#define E2E_INTERNAL_JOIN2(a, b) a##b
#define E2E_INTERNAL_JOIN(a, b) E2E_INTERNAL_JOIN2(a, b)
#define E2E_INTERNAL_TEST(name, line) \
    static void E2E_INTERNAL_JOIN(e2e_body_, line)(::e2e::Session& session); \
    static ::e2e::RegisterTest E2E_INTERNAL_JOIN(e2e_registration_, line)(name, E2E_INTERNAL_JOIN(e2e_body_, line), __FILE__, line); \
    static void E2E_INTERNAL_JOIN(e2e_body_, line)(::e2e::Session& session)
#define E2E_TEST(name) E2E_INTERNAL_TEST(name, __LINE__)

/** Define exactly one entrypoint per compiled test executable. */
#ifdef _WIN32
#define E2E_TEST_MAIN() int wmain(int argc, wchar_t** argv) { return ::e2e::run(argc, argv); }
#else
#define E2E_TEST_MAIN() int main(int argc, char** argv) { return ::e2e::run(argc, argv); }
#endif
