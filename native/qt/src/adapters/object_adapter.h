// SPDX-License-Identifier: MIT
#pragma once
#include "../object_registry.h"
#include <QImage>
#include <QList>
#include <QSize>

namespace e2e::qt::detail {
/** Toolkit surface contract; transport and session policy never inspect controls. */
class ObjectAdapter {
public:
    virtual ~ObjectAdapter() = default;
    virtual QObject* root() const = 0;
    virtual bool accepts(QObject* object) const = 0;
    virtual QJsonObject snapshot(QObject* root, ObjectRegistry& registry) = 0;
    virtual QSize size(QObject* root) const = 0;
    virtual void actionable(QObject* object, QObject* root) const = 0;
    virtual void click(QObject* object, Qt::MouseButton button, bool twice, bool hover) = 0;
    virtual void focus(QObject* object) = 0;
    virtual void key(QObject* object, Qt::Key key, Qt::KeyboardModifiers modifiers, const QString& text = {}) = 0;
    virtual void typeCharacter(QObject* object, char character) = 0;
    virtual bool editable(QObject* object) const = 0;
    virtual bool checkable(QObject* object) const = 0;
    virtual QObject* focused(QObject* root) const = 0;
    virtual void selectOption(QObject* object, const QJsonValue& value) = 0;
    virtual QImage capture(QObject* root) = 0;
    virtual void secureRegions(QObject* root, QList<QRectF>& regions, int& count) const = 0;
};
} // namespace e2e::qt::detail
