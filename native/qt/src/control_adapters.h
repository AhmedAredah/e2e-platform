// SPDX-License-Identifier: MIT
#pragma once
#include <e2e/qt/control_adapter.h>
#include "support.h"
#include <memory>
#include <vector>

namespace e2e::qt::detail {
/** Owns public adapters without exporting the helper's internal surface ABI. */
class ControlAdapters final {
public:
    bool add(std::shared_ptr<ControlAdapter> adapter, QString& error);
    bool empty() const { return adapters_.empty(); }
    std::optional<ControlSnapshot> snapshot(QObject* object) const;
    bool handles(QObject* object) const;
    bool ready(QObject* object, const QJsonObject& action) const;
    bool perform(QObject* object, const QJsonObject& action) const;
    static void apply(QJsonObject& node, const ControlSnapshot& data);
private:
    std::vector<std::shared_ptr<ControlAdapter>> adapters_;
    ControlAdapter* find(QObject* object) const;
};
}
