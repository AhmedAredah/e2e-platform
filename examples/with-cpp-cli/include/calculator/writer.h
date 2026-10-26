// SPDX-License-Identifier: MIT
#pragma once

#include <ostream>
#include <string>
#include "calculator/result.h"

namespace calculator {
// A CSV or domain-specific writer can preserve application/operation behavior.
class ResultWriter {
public:
    virtual ~ResultWriter() = default;
    virtual void write(const Result& result, const std::string& path, std::ostream& output) const = 0;
};

class JsonResultWriter final : public ResultWriter {
public:
    void write(const Result& result, const std::string& path, std::ostream& output) const override;
};
}  // namespace calculator
