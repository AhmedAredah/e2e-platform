// SPDX-License-Identifier: MIT
#pragma once
#include "object_adapter.h"
namespace e2e::qt::detail {
/** Qt Quick visual hierarchy and window-delivered input events. */
class QuickAdapter final : public ObjectAdapter {
public:
    QObject* root() const override;
    bool accepts(QObject*) const override;
    QJsonObject snapshot(QObject*, ObjectRegistry&) override;
    QSize size(QObject*) const override;
    void actionable(QObject*, QObject*) const override;
    void click(QObject*, Qt::MouseButton, bool, bool) override;
    void focus(QObject*) override;
    void key(QObject*, Qt::Key, Qt::KeyboardModifiers, const QString& text = {}) override;
    void typeCharacter(QObject*, char) override;
    bool editable(QObject*) const override;
    bool checkable(QObject*) const override;
    QObject* focused(QObject*) const override;
    void selectOption(QObject*, const QJsonValue&) override;
    QImage capture(QObject*) override;
    void secureRegions(QObject*, QList<QRectF>&, int&) const override;
private:
    QJsonObject node(QObject*, QObject*, int, ObjectRegistry&, bool);
};
}
