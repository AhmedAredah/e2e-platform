// SPDX-License-Identifier: MIT
#pragma once
#include "adapters/object_adapter.h"
#include <memory>
#include <vector>
namespace e2e::qt::detail {
/** Bounded session policy and action orchestration, independent of a toolkit tree. */
class Surface final {
public:
    Surface();
    QJsonObject snapshot(bool pixels);
    QJsonObject screenshot();
    void perform(const QJsonObject& params);
    void typeFocused(const QString& text, bool replace);
    void pressFocused(const QString& text);
private:
    ObjectRegistry registry_;
    std::vector<std::unique_ptr<ObjectAdapter>> adapters_;
    QPointer<QObject> root_;
    ObjectAdapter* adapter_ = nullptr;
    std::pair<QObject*, ObjectAdapter*> active() const;
    void ensureRoot() const;
    void key(QObject* object, const QString& text, ObjectAdapter& adapter);
    void type(QObject* object, const QString& text, bool replace, ObjectAdapter& adapter, QObject* root);
};
}
