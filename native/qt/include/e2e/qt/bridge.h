// SPDX-License-Identifier: MIT
#pragma once

#include <e2e/qt/export.h>
#include <QObject>
#include <QString>
#include <memory>

namespace e2e::qt {
class ControlAdapter;

/** Test-build-only loopback automation bridge. Construct after QApplication. */
class E2E_QT_BRIDGE_EXPORT Bridge final : public QObject {
public:
    explicit Bridge(QObject* parent = nullptr);
    ~Bridge() override;
    Bridge(const Bridge&) = delete;
    Bridge& operator=(const Bridge&) = delete;

    /** Start only when E2E_NATIVE_TOKEN is set. No listener is created otherwise. */
    bool start();
    QString errorString() const;
    /** Register on the GUI thread before start(). Registration order sets precedence. */
    bool registerControlAdapter(std::shared_ptr<ControlAdapter> adapter);

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace e2e::qt
