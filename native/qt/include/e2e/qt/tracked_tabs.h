// SPDX-License-Identifier: MIT
#pragma once
#include <e2e/qt/export.h>
#include <QTabBar>
#include <QTabWidget>

namespace e2e::qt {
/** Reports structural tab lifetimes without changing application-owned tab data. */
class E2E_QT_BRIDGE_EXPORT TrackedTabBar : public QTabBar {
public:
    explicit TrackedTabBar(QWidget* parent = nullptr);
    quint64 generation() const noexcept { return generation_; }
protected:
    void tabInserted(int index) override final;
    void tabRemoved(int index) override final;
    virtual void onTabInserted(int) {}
    virtual void onTabRemoved(int) {}
private:
    quint64 generation_ = 0;
};

/** QTabWidget with a lifetime-aware tab bar; ordinary widget behavior is preserved. */
class E2E_QT_BRIDGE_EXPORT TrackedTabWidget : public QTabWidget {
public:
    explicit TrackedTabWidget(QWidget* parent = nullptr);
};
}
