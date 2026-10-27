// SPDX-License-Identifier: MIT
#include <e2e/qt/tracked_tabs.h>

namespace e2e::qt {
TrackedTabBar::TrackedTabBar(QWidget* parent) : QTabBar(parent) {}
void TrackedTabBar::tabInserted(int index) { ++generation_; QTabBar::tabInserted(index); onTabInserted(index); }
void TrackedTabBar::tabRemoved(int index) { ++generation_; QTabBar::tabRemoved(index); onTabRemoved(index); }
TrackedTabWidget::TrackedTabWidget(QWidget* parent) : QTabWidget(parent) { setTabBar(new TrackedTabBar(this)); }
}
