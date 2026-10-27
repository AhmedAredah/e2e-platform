// SPDX-License-Identifier: MIT
#pragma once
#include "adapters/object_adapter.h"
#include "control_adapters.h"
#include <memory>
#include <vector>
#include <QElapsedTimer>
#include <QHash>
#include <QJsonArray>
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
    void actionability(const QJsonObject& params);
    QJsonArray windows();
    void activateWindow(const QString& id);
    bool addControlAdapter(std::shared_ptr<ControlAdapter> adapter, QString& error) { return custom_.add(std::move(adapter), error); }
    bool hasCustomAdapters() const { return !custom_.empty(); }
private:
    ObjectRegistry registry_;
    ControlAdapters custom_;
    std::vector<std::unique_ptr<ObjectAdapter>> adapters_;
    QPointer<QObject> root_;
    ObjectAdapter* adapter_ = nullptr;
    QElapsedTimer clock_;
    struct StableGeometry { QRectF rect; QPointer<QObject> root; qint64 since; };
    QHash<QString, StableGeometry> stable_;
    QHash<QString, QPointer<QObject>> windows_;
    quint64 nextWindow_ = 1;
    std::pair<QObject*, ObjectAdapter*> active() const;
    void ensureRoot() const;
    void key(QObject* object, const QString& text, ObjectAdapter& adapter);
    void type(QObject* object, const QString& text, bool replace, ObjectAdapter& adapter, QObject* root);
};
}
