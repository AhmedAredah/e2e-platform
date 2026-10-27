// SPDX-License-Identifier: MIT
#include <e2e/session.hpp>
#include <iostream>

namespace {
void require(bool condition) { if (!condition) throw std::runtime_error("JSON fidelity regression"); }
void rejects(const std::string& body) {
    bool rejected = false;
    try { e2e::HttpResponse{200, e2e::Json::object(), body}.json(); }
    catch (const e2e::Error& error) {
        rejected = true;
        require(std::string(error.what()).find("private-value") == std::string::npos);
    }
    require(rejected);
}
}

int main() {
    try {
        for (const auto* value : {"1.0000000000000001", "1e-9999", "-1e-9999", "18446744073709551616", "-9223372036854775809", "1e9999"}) {
            rejects(std::string("{\"private-value\":[{\"nested\":") + value + "}]}");
        }
        rejects("{\"private-value\":1,\"private-\\u0076alue\":2}");
        rejects(std::string(66, '[') + "0" + std::string(66, ']'));
        const auto value = e2e::parse_json(R"({"quote\\\"123": "1e-9999", "n":[0.1,1.2300e2,-0.0,18446744073709551615,-9223372036854775808]})");
        require(value["n"][0] == 0.1 && value["n"][1] == 123 && value["n"][2] == 0);
        require(value["n"][3].get<std::uint64_t>() == 18446744073709551615ULL);
        require(value["n"][4].get<std::int64_t>() == std::numeric_limits<std::int64_t>::min());
        require(e2e::parse_json("1.0000000000000001", e2e::JsonNumberPolicy::binary64) == 1);
        require(e2e::parse_json("1e-9999", e2e::JsonNumberPolicy::binary64) == 0);
        std::cout << "Strict HTTP JSON fidelity and explicit binary64 policy passed.\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
