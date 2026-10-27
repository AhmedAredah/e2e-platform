// SPDX-License-Identifier: MIT
#pragma once
#include "object_adapter.h"
#include "widget_targets.h"
#include "../control_adapters.h"
namespace e2e::qt::detail {
/** QWidget hierarchy, input events, and masking. */
class WidgetsAdapter final : public ObjectAdapter {
public:
    explicit WidgetsAdapter(ControlAdapters* custom = nullptr) : custom_(custom) {}
    QObject* root() const override;
    bool accepts(QObject*) const override;
    QJsonObject snapshot(QObject*, ObjectRegistry&) override;
    QSize size(QObject*) const override;
    void actionable(QObject*, QObject*) const override;
    void ready(QObject*, QObject*, const QJsonObject&) const override;
    QRectF rectangle(QObject*, QObject*) const override;
    void scrollIntoView(QObject*, QObject*) override;
    void swipe(QObject*, QObject*, const QString&) override;
    void click(QObject*, Qt::MouseButton, bool, bool) override;
    void focus(QObject*) override;
    void key(QObject*, Qt::Key, Qt::KeyboardModifiers, const QString& text = {}) override;
    void typeCharacter(QObject*, char) override;
    void commitText(QObject*, const QString&) override;
    bool editable(QObject*) const override;
    bool checkable(QObject*) const override;
    bool checked(QObject*) const override;
    void setChecked(QObject*, bool) override;
    QObject* focused(QObject*) const override;
    void selectOption(QObject*, const QJsonValue&) override;
    QImage capture(QObject*) override;
    void secureRegions(QObject*, QList<QRectF>&, int&) const override;
private:
    ControlAdapters* custom_;
    WidgetTargets targets_;
    QWidget* keyboardTarget(QObject*) const;
    QJsonObject node(QObject*, QObject*, int, ObjectRegistry&, bool);
};
}
