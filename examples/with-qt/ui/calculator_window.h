// SPDX-License-Identifier: MIT
#pragma once
#include <QWidget>
#include <optional>
namespace example {
/** Owns the Widgets demo and its import/calculate/export workflows. */
class CalculatorWindow final : public QWidget {
public:
    explicit CalculatorWindow(bool deliberateDefect);
private:
    struct Calculation { double total; QString currency; };
    bool badCalculation_;
    quint64 inputRevision_ = 0;
    std::optional<Calculation> calculation_;
};
}
