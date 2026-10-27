// SPDX-License-Identifier: MIT
#pragma once
#include <stdexcept>

namespace e2e {
/** A bounded diagnostic that never includes application values. */
class Error : public std::runtime_error {
public:
    explicit Error(const char* message) : std::runtime_error(message) {}
};
} // namespace e2e
