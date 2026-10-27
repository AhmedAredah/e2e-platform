// SPDX-License-Identifier: MIT
#include "capture_guard.h"
#include "support.h"
#include <QCoreApplication>
#include <QEvent>
#include <QMetaProperty>
#include <QMetaMethod>
#include <QWidget>
#include <QAction>
#ifdef E2E_QT_HAS_QUICK
#include <QQuickItem>
#include <QQuickWindow>
#endif

namespace e2e::qt::detail {
CaptureGuard::CaptureGuard(QObject* root) {
    watch(root);
    // Security can be inherited from an owner outside the visible subtree.
    for (QObject* owner = root->parent(); owner; owner = owner->parent()) {
        objects_.insert(owner);
        watchProperty(owner, "e2eSecure");
    }
    QCoreApplication::instance()->installEventFilter(this);
}
CaptureGuard::~CaptureGuard() { QCoreApplication::instance()->removeEventFilter(this); }
void CaptureGuard::watchProperty(QObject* object, const char* name) {
    const int index = object->metaObject()->indexOfProperty(name);
    if (index < 0) return;
    const QMetaProperty property = object->metaObject()->property(index);
    if (property.hasNotifySignal())
        connect(object, property.notifySignal(), this, metaObject()->method(metaObject()->indexOfSlot("invalidate()")), Qt::DirectConnection);
}
void CaptureGuard::watch(QObject* object, int depth) {
    if (objects_.contains(object)) return;
    if (objects_.size() >= MaxNodes || depth > MaxDepth) throw Failure("POLICY_DENIED", "capture tree exceeds masking guard limit");
    objects_.insert(object);
    connect(object, &QObject::destroyed, this, [this] { changed_ = true; });
    watchProperty(object, "e2eSecure");
    watchProperty(object, "echoMode");
    if (auto* widget = qobject_cast<QWidget*>(object)) for (QAction* action : widget->actions()) {
        watch(action, depth + 1);
        connect(action, &QAction::changed, this, [this] { changed_ = true; });
        for (QObject* owner = action->parent(); owner; owner = owner->parent()) {
            if (objects_.contains(owner)) continue;
            if (objects_.size() >= MaxNodes) throw Failure("POLICY_DENIED", "capture action owners exceed masking guard limit");
            objects_.insert(owner);
            watchProperty(owner, "e2eSecure");
            connect(owner, &QObject::destroyed, this, [this] { changed_ = true; });
        }
    }
#ifdef E2E_QT_HAS_QUICK
    if (auto* window = qobject_cast<QQuickWindow*>(object)) watch(window->contentItem(), depth + 1);
    if (auto* item = qobject_cast<QQuickItem*>(object)) {
        const auto invalidate = [this] { changed_ = true; };
        connect(item, &QQuickItem::xChanged, this, invalidate);
        connect(item, &QQuickItem::yChanged, this, invalidate);
        connect(item, &QQuickItem::widthChanged, this, invalidate);
        connect(item, &QQuickItem::heightChanged, this, invalidate);
        connect(item, &QQuickItem::rotationChanged, this, invalidate);
        connect(item, &QQuickItem::scaleChanged, this, invalidate);
        connect(item, &QQuickItem::transformOriginChanged, this, invalidate);
        connect(item, &QQuickItem::visibleChanged, this, invalidate);
        connect(item, &QQuickItem::opacityChanged, this, invalidate);
        connect(item, &QQuickItem::parentChanged, this, invalidate);
        connect(item, &QQuickItem::childrenChanged, this, invalidate);
        auto transforms = item->transform();
        for (qsizetype index = 0; transforms.count && index < transforms.count(&transforms); ++index) {
            QQuickTransform* transform = transforms.at(&transforms, index);
            watch(transform, depth + 1);
            // QML Scale/Rotation/Translate each expose different transform inputs.
            for (int property = 0; property < transform->metaObject()->propertyCount(); ++property)
                watchProperty(transform, transform->metaObject()->property(property).name());
        }
        for (auto* child : item->childItems()) watch(child, depth + 1);
    }
#endif
    for (auto* child : object->children()) watch(child, depth + 1);
}
bool CaptureGuard::eventFilter(QObject* object, QEvent* event) {
    if (objects_.contains(object)) switch (event->type()) {
    case QEvent::Show: case QEvent::Hide: case QEvent::Move: case QEvent::Resize:
    case QEvent::ParentChange: case QEvent::ChildAdded: case QEvent::ChildRemoved:
    case QEvent::ZOrderChange: case QEvent::DynamicPropertyChange:
    case QEvent::ActionAdded: case QEvent::ActionRemoved: case QEvent::ActionChanged:
    case QEvent::LayoutRequest: case QEvent::UpdateRequest:
        changed_ = true;
        break;
    default: break;
    }
    return false;
}
}
