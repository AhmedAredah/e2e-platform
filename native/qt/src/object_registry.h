// SPDX-License-Identifier: MIT
#pragma once
#include "support.h"
#include <QHash>
#include <QPointer>
#include <QSet>
#include <QJsonDocument>
namespace e2e::qt::detail {
/** Lifetime-safe object identity and bounded snapshot traversal. */
class ObjectRegistry final : public QObject {
public:
    explicit ObjectRegistry(QObject* parent = nullptr) : QObject(parent) {}
    void begin() { currentIds.clear(); nodeCount = 0; snapshotBytes = 0; truncated = false; }
    QObject* resolve(const QString& id) const {
        if (!currentIds.contains(id) || !objects.value(id)) throw Failure("NODE_STALE", "Qt object is no longer in the observed view");
        return objects.value(id);
    }
    bool visit(int depth) { if (depth > MaxDepth || ++nodeCount > MaxNodes) { truncated = true; return false; } return true; }
    bool reserveNode(const QJsonObject& node) {
        const qsizetype size = QJsonDocument(node).toJson(QJsonDocument::Compact).size();
        if (snapshotBytes + size > 4 * 1024 * 1024) {
            truncated = true;
            currentIds.remove(node.value("ref").toObject().value("id").toString());
            return false;
        }
        snapshotBytes += size;
        return true;
    }
    bool truncated = false;
    QJsonObject node(QObject* object, bool root) {
        const QString id = identify(object, root);
        QJsonObject node{{"ref", QJsonObject{{"id", id}, {"revision", ""}}}};
        if (!object->objectName().isEmpty()) node["testId"] = clean(object->objectName(), 256);
        return node;
    }

private:
    quint64 nextId = 1;
    int nodeCount = 0;
    qsizetype snapshotBytes = 0;
    QHash<QObject*, QString> reverse;
    QHash<QString, QPointer<QObject>> objects;
    QSet<QString> currentIds;
    QString identify(QObject* object, bool root = false) {
        auto found = reverse.constFind(object);
        QString id;
        if (found == reverse.cend()) {
            if (objects.size() > MaxNodes * 4) throw Failure("ENGINE_FAILURE", "object registry capacity exceeded");
            id = (root ? QStringLiteral("root-%1") : QStringLiteral("qt-%1")).arg(nextId++);
            reverse.insert(object, id);
            objects.insert(id, object);
            QObject::connect(object, &QObject::destroyed, this, [this, object, id] { reverse.remove(object); objects.remove(id); currentIds.remove(id); });
        } else id = *found;
        currentIds.insert(id);
        return id;
    }

};
}
