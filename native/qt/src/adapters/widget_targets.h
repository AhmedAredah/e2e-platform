// SPDX-License-Identifier: MIT
#pragma once
#include "../object_registry.h"
#include <QAbstractItemView>
#include <QAction>
#include <QJsonArray>
#include <QHeaderView>
#include <QPersistentModelIndex>
#include <QTabBar>
#include <memory>
#include <vector>

namespace e2e::qt::detail {
/** Lifetime checked identities for controls that are not separate QWidgets. */
class WidgetTarget final : public QObject {
public:
    enum class Kind { ModelItem, Action, Tab, Header };
    WidgetTarget(QWidget* owner, const QModelIndex& index);
    WidgetTarget(QWidget* owner, QAction* action);
    WidgetTarget(QTabBar* owner, int tab);
    WidgetTarget(QHeaderView* owner, int section);
    bool valid() const;
    QString identity() const;
    QWidget* owner() const;
    QRect rectangle() const;
    QJsonObject snapshot(ObjectRegistry& registry, QWidget* root) const;
    void ready(QWidget* root, bool allowOffscreen) const;
    void click(Qt::MouseButton button, bool twice, bool hover);
    void focus();
    void scrollIntoView();
    bool checkable() const;
    bool checked() const;
    void setChecked(bool value);
    bool seen = false;
    Kind kind() const { return kind_; }
private:
    Kind kind_;
    QPointer<QWidget> owner_;
    QPersistentModelIndex index_;
    QPointer<QAction> action_;
    int number_ = -1;
    int count_ = -1;
    QString tabText_;
    QVariant tabData_;
    bool hidden() const;
};

/** Rebuild lookup keys each observation so persistent model indexes can move safely. */
class WidgetTargets final {
public:
    void begin();
    void finish();
    QJsonArray children(QWidget* owner, QWidget* root, ObjectRegistry& registry, int depth);
private:
    std::vector<std::unique_ptr<WidgetTarget>> targets_;
    QHash<QString, WidgetTarget*> available_;
    WidgetTarget* retain(std::unique_ptr<WidgetTarget> candidate);
    QJsonArray modelChildren(QAbstractItemView* view, const QModelIndex& parent, QWidget* root, ObjectRegistry& registry, int depth);
};
}
