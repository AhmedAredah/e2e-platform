// SPDX-License-Identifier: MIT
#include "quick_adapter.h"
#include <QGuiApplication>
#include <QJsonArray>
#include <QQuickItem>
#include <QQuickWindow>
#include <QTest>

namespace e2e::qt::detail {
namespace {
bool visuallyVisible(QQuickItem* item) {
    for (QQuickItem* current = item; current; current = current->parentItem())
        if (!current->isVisible() || current->opacity() == 0) return false;
    return true;
}
}
QJsonObject QuickAdapter::node(QObject* object, QObject* rootObject, int depth, ObjectRegistry& registry, bool isRoot) {
    auto* item = qobject_cast<QQuickItem*>(object);
    Q_UNUSED(rootObject);
    Q_UNUSED(isRoot);
        if (!registry.visit(depth)) return {};
        QJsonObject node = registry.node(item, false);
        const QString className = QString::fromLatin1(item->metaObject()->className());
        const bool secure = secureObject(item);
        const bool editable = item->property("readOnly").isValid() && !item->property("readOnly").toBool();
        QString role = "group";
        if (item->property("echoMode").isValid() || (item->property("readOnly").isValid() && item->property("text").isValid())) role = "textbox";
        else if (className.contains("CheckBox")) role = "checkbox";
        else if (className.contains("RadioButton")) role = "radio";
        else if (className.contains("Switch")) role = "switch";
        else if (className.contains("ComboBox")) role = "combobox";
        else if (className.contains("Button")) role = "button";
        else if (item->property("text").isValid()) role = "text";
        node["role"] = role;
        QJsonObject states{{"hidden", !visuallyVisible(item)}, {"disabled", !item->isEnabled()}, {"focused", item->hasActiveFocus()}};
        if (item->property("checked").isValid()) states["checked"] = item->property("checked").toBool();
        QString name = accessibleName(item);
        if (secure) { states["secure"] = true; node["inputPurpose"] = "password"; name.clear(); }
        else {
            const QString text = clean(item->property("text").toString());
            if (!text.isEmpty()) { node["text"] = text; if (name.isEmpty()) name = clean(text, 256); }
            if (role == "textbox") node["value"] = text;
            if (role == "combobox") node["value"] = clean(item->property("currentText").toString());
            node["attributes"] = QJsonObject{{"class", clean(className, 256)}, {"editable", editable ? "true" : "false"}, {"placeholder", clean(item->property("placeholderText").toString())}};
        }
        if (!name.isEmpty()) node["name"] = clean(name, 256);
        node["states"] = states;
        node["rect"] = rectJson(item->mapRectToScene(item->boundingRect()));
        if (!registry.reserveNode(node)) return {};
        if (secure) return node;
        QJsonArray children;
        for (QQuickItem* child : item->childItems()) {
            const QJsonObject value = this->node(child, rootObject, depth + 1, registry, false);
            if (!value.isEmpty()) children.append(value);
            if (registry.truncated) break;
        }
        if (!children.isEmpty()) node["children"] = children;
        return node;
    }

QObject* QuickAdapter::root() const {
    if (auto* focused = qobject_cast<QQuickWindow*>(QGuiApplication::focusWindow())) return focused;
    for (QWindow* window : QGuiApplication::topLevelWindows())
        if (auto* quick = qobject_cast<QQuickWindow*>(window); quick && quick->isVisible()) return quick;
    return nullptr;
}
bool QuickAdapter::accepts(QObject* object) const { return qobject_cast<QQuickWindow*>(object) || qobject_cast<QQuickItem*>(object); }
QSize QuickAdapter::size(QObject* root) const { return static_cast<QQuickWindow*>(root)->size(); }
QJsonObject QuickAdapter::snapshot(QObject* root, ObjectRegistry& registry) {
    auto* window = static_cast<QQuickWindow*>(root);
    QJsonObject tree = registry.node(window, true);
    tree["role"] = "window";
    tree["name"] = clean(window->title(), 256);
    tree["rect"] = rectJson(QRectF(0, 0, window->width(), window->height()));
    tree["children"] = QJsonArray{node(window->contentItem(), window, 1, registry, false)};
    return {{"root", tree}, {"viewport", QJsonObject{{"width", window->width()}, {"height", window->height()}}}, {"location", "qt:view"}, {"truncated", registry.truncated}};
}
void QuickAdapter::actionable(QObject* object, QObject* root) const {
    auto* item = qobject_cast<QQuickItem*>(object);
    if (!item || !visuallyVisible(item) || !item->isEnabled() || item->width() <= 0 || item->height() <= 0 || item->window() != root)
        throw Failure("NOT_ACTIONABLE", "Qt Quick item is not actionable");
    const QPointF center = item->mapToScene(item->boundingRect().center());
    if (!QRectF(0, 0, item->window()->width(), item->window()->height()).contains(center)) throw Failure("NOT_ACTIONABLE", "Qt Quick target is outside the viewport");
    for (QQuickItem* parent = item->parentItem(); parent; parent = parent->parentItem())
        if (parent->clip() && !parent->boundingRect().contains(parent->mapFromScene(center))) throw Failure("NOT_ACTIONABLE", "Qt Quick target is clipped");
}
void QuickAdapter::click(QObject* object, Qt::MouseButton button, bool twice, bool hover) {
    auto* item = static_cast<QQuickItem*>(object);
    QPointer<QQuickWindow> window(item->window());
    const QPoint point = item->mapToScene(item->boundingRect().center()).toPoint();
    QQuickItem* hit = window->contentItem();
    for (int depth = 0; ; ++depth) {
        if (depth > MaxDepth) throw Failure("NOT_ACTIONABLE", "Qt Quick hit-test depth exceeds limit");
        const QPointF local = hit->mapFromScene(point);
        QQuickItem* child = hit->childAt(local.x(), local.y());
        if (!child) break;
        hit = child;
    }
    // A visual overlay is rejected even if it might forward input. Public Qt
    // APIs cannot prove arbitrary event-filter or pointer-handler behavior.
    if (hit != item && !item->isAncestorOf(hit)) throw Failure("NOT_ACTIONABLE", "Qt Quick target is covered by another item");
    QQuickItem* grabber = window->mouseGrabberItem();
    if (grabber && grabber != item && !item->isAncestorOf(grabber)) throw Failure("NOT_ACTIONABLE", "another Qt Quick item owns pointer input");
    if (hover) { QTest::mouseMove(window, point); return; }
    if (twice) { QTest::mouseDClick(window, button, Qt::NoModifier, point); return; }
    QTest::mousePress(window, button, Qt::NoModifier, point);
    if (!window) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt window was destroyed during pointer input");
    QTest::mouseRelease(window, button, Qt::NoModifier, point);
}
void QuickAdapter::focus(QObject* object) { static_cast<QQuickItem*>(object)->forceActiveFocus(Qt::OtherFocusReason); }
void QuickAdapter::key(QObject* object, Qt::Key key, Qt::KeyboardModifiers modifiers, const QString& text) {
    sendKeyPair(static_cast<QQuickItem*>(object)->window(), key, modifiers, text);
}
void QuickAdapter::typeCharacter(QObject* object, char character) {
    sendKeyPair(static_cast<QQuickItem*>(object)->window(), static_cast<Qt::Key>(QChar::fromLatin1(character).toUpper().unicode()), Qt::NoModifier, QString(QChar::fromLatin1(character)));
}
bool QuickAdapter::editable(QObject* object) const { return object->property("readOnly").isValid() && !object->property("readOnly").toBool(); }
bool QuickAdapter::checkable(QObject* object) const { return object->property("checked").isValid(); }
QObject* QuickAdapter::focused(QObject* root) const { return static_cast<QQuickWindow*>(root)->activeFocusItem(); }
void QuickAdapter::selectOption(QObject*, const QJsonValue&) { throw Failure("UNSUPPORTED_CAPABILITY", "Qt Quick selectOption is not implemented"); }
QImage QuickAdapter::capture(QObject* root) {
    auto* window = static_cast<QQuickWindow*>(root);
    if (qint64(window->width()) * window->height() * window->devicePixelRatio() * window->devicePixelRatio() > MaxPixels) throw Failure("ENGINE_FAILURE", "screenshot exceeds pixel limit");
    return window->grabWindow();
}
void QuickAdapter::secureRegions(QObject* root, QList<QRectF>& regions, int& count) const {
    QList<QQuickItem*> stack{static_cast<QQuickWindow*>(root)->contentItem()};
    int visited = 0;
    while (!stack.isEmpty()) {
        QQuickItem* item = stack.takeLast();
        if (++visited > MaxNodes) throw Failure("POLICY_DENIED", "cannot prove screenshot masking for oversized Qt Quick tree");
        if (secureObject(item)) { ++count; if (item->isVisible()) regions.append(item->mapRectToScene(item->boundingRect())); }
        stack.append(item->childItems());
    }
}
}
