// SPDX-License-Identifier: MIT
#include "quick_adapter.h"
#include <QGuiApplication>
#include <QJsonArray>
#include <QQuickItem>
#include <QQuickWindow>
#include <QInputMethodEvent>
#include <QWheelEvent>
#include <algorithm>
#include <QTest>
#include <cmath>

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
        const auto custom = custom_ ? custom_->snapshot(item) : std::optional<ControlSnapshot>{};
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
        role = accessibleRole(item, role);
        node["role"] = role;
        QJsonObject states{{"hidden", !visuallyVisible(item)}, {"disabled", !item->isEnabled()}, {"focused", item->hasActiveFocus()}};
        if (item->property("checked").isValid()) states["checked"] = item->property("checked").toBool();
        QString name = accessibleName(item);
        if (secure) { states["secure"] = true; node["inputPurpose"] = "password"; name.clear(); }
        else {
            const QString numericValue = accessibleValue(item);
            if (!numericValue.isEmpty()) node["value"] = numericValue;
            const QString text = clean(item->property("text").toString());
            if (!text.isEmpty()) { node["text"] = text; if (name.isEmpty()) name = clean(text, 256); }
            if (role == "textbox") node["value"] = text;
            if (role == "combobox") node["value"] = clean(item->property("currentText").toString());
            node["attributes"] = QJsonObject{{"class", clean(className, 256)}, {"editable", editable ? "true" : "false"}, {"placeholder", clean(item->property("placeholderText").toString())}};
        }
        if (!name.isEmpty()) node["name"] = clean(name, 256);
        node["states"] = states;
        node["rect"] = rectJson(item->mapRectToScene(item->boundingRect()));
        if (custom) ControlAdapters::apply(node, *custom);
        if (!registry.reserveNode(node)) return {};
        if (secure || (custom && custom->omitChildren)) return node;
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
    const bool secure = secureObject(window);
    if (secure) {
        tree["states"] = QJsonObject{{"secure", true}};
        tree["inputPurpose"] = "generic-secret";
    } else tree["name"] = clean(window->title(), 256);
    tree["rect"] = rectJson(QRectF(0, 0, window->width(), window->height()));
    if (!secure) tree["children"] = QJsonArray{node(window->contentItem(), window, 1, registry, false)};
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
QRectF QuickAdapter::rectangle(QObject* object, QObject*) const {
    if (auto* window = qobject_cast<QQuickWindow*>(object)) return QRectF(QPointF(), window->size());
    auto* item = qobject_cast<QQuickItem*>(object);
    if (!item) throw Failure("NODE_STALE", "Qt Quick target no longer exists");
    return item->mapRectToScene(item->boundingRect());
}
void QuickAdapter::ready(QObject* object, QObject* root, const QJsonObject& action) const {
    const QString kind = requiredText(action, "kind");
    auto* item = qobject_cast<QQuickItem*>(object);
    if (auto* window = qobject_cast<QQuickWindow*>(object); window && kind == "swipe") item = window->contentItem();
    if (kind == "scrollIntoView") {
        if (!item || !visuallyVisible(item) || item->window() != root) throw Failure("NOT_ACTIONABLE", "Qt Quick scroll target is hidden or outside the active window");
        return;
    }
    actionable(item, root);
    if (kind == "selectOption" && !(custom_ && custom_->handles(object))) optionIndex(object, action.value("value"));
    if ((kind == "fill" || kind == "clear") && !(custom_ && custom_->handles(object)) && !editable(item)) throw Failure("NOT_ACTIONABLE", "Qt Quick target is not editable");
    if (kind == "swipe") {
        const QString direction = requiredText(action, "direction");
        if (direction != "up" && direction != "down" && direction != "left" && direction != "right") throw Failure("INVALID_STATE", "invalid scroll direction");
        if (action.contains("momentum") && action.value("momentum") != "none") throw Failure("UNSUPPORTED_CAPABILITY", "Qt wheel input does not implement kinetic momentum");
    }
    if (kind != "tap" && kind != "doubleTap" && kind != "secondaryTap" && kind != "hover" && kind != "check" && kind != "uncheck" && kind != "swipe") return;
    QQuickWindow* window = item->window();
    const QPoint point = item->mapToScene(item->boundingRect().center()).toPoint();
    QQuickItem* hit = window->contentItem();
    for (int depth = 0; ; ++depth) {
        if (depth > MaxDepth) throw Failure("NOT_ACTIONABLE", "Qt Quick hit-test depth exceeds limit");
        const QPointF local = hit->mapFromScene(point);
        QQuickItem* child = hit->childAt(local.x(), local.y());
        if (!child) break;
        hit = child;
    }
    if (hit != item && !item->isAncestorOf(hit)) throw Failure("NOT_ACTIONABLE", "Qt Quick target is covered by another item");
    QQuickItem* grabber = window->mouseGrabberItem();
    if (grabber && grabber != item && !item->isAncestorOf(grabber)) throw Failure("NOT_ACTIONABLE", "another Qt Quick item owns pointer input");
}
void QuickAdapter::scrollIntoView(QObject* object, QObject*) {
    QPointer<QQuickItem> target(static_cast<QQuickItem*>(object));
    for (QQuickItem* parent = target->parentItem(); parent; parent = parent->parentItem()) {
        if (!parent->inherits("QQuickFlickable")) continue;
        auto* content = qobject_cast<QQuickItem*>(parent->property("contentItem").value<QObject*>());
        if (!content) throw Failure("UNSUPPORTED_CAPABILITY", "Qt Quick scroll container has no content item");
        const QRectF rect = target->mapRectToItem(content, target->boundingRect());
        const qreal x = parent->property("contentX").toDouble(), y = parent->property("contentY").toDouble();
        qreal nextX = x, nextY = y;
        if (rect.left() < x) nextX = rect.left();
        else if (rect.right() > x + parent->width()) nextX = rect.right() - parent->width();
        if (rect.top() < y) nextY = rect.top();
        else if (rect.bottom() > y + parent->height()) nextY = rect.bottom() - parent->height();
        nextX = std::clamp(nextX, qreal(0), std::max(qreal(0), parent->property("contentWidth").toDouble() - parent->width()));
        nextY = std::clamp(nextY, qreal(0), std::max(qreal(0), parent->property("contentHeight").toDouble() - parent->height()));
        QPointer<QQuickItem> container(parent);
        if (!parent->setProperty("contentX", nextX) || !target || !container)
            throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt Quick container changed during scrolling");
        if (!parent->setProperty("contentY", nextY) || !target || !container)
            throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt Quick container changed during scrolling");
    }
}
void QuickAdapter::swipe(QObject* object, QObject* root, const QString& direction) {
    auto* window = static_cast<QQuickWindow*>(root);
    const QRectF rect = rectangle(object, root);
    const QPoint point = rect.center().toPoint();
    const QPoint delta = direction == "up" ? QPoint(0, 240) : direction == "down" ? QPoint(0, -240)
        : direction == "left" ? QPoint(240, 0) : QPoint(-240, 0);
    QPointer<QQuickWindow> guardedWindow(window);
    QTest::mouseMove(window, point);
    if (!guardedWindow) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt Quick window was destroyed during wheel positioning");
    QWheelEvent event(point, window->mapToGlobal(point), {}, delta, Qt::NoButton, Qt::NoModifier, Qt::NoScrollPhase, false);
    // Keep wheel input on the same timestamp sequence as Qt Test pointer
    // input: a zero timestamp after a click makes Flickable discard scrolling.
    event.setTimestamp(++QTest::lastMouseTimestamp);
    QCoreApplication::sendEvent(window, &event);
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
void QuickAdapter::focus(QObject* object) {
    QPointer<QQuickItem> target(static_cast<QQuickItem*>(object));
    target->forceActiveFocus(Qt::OtherFocusReason);
    if (!target || !target->hasActiveFocus()) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt Quick focus was redirected or target destroyed");
}
void QuickAdapter::key(QObject* object, Qt::Key key, Qt::KeyboardModifiers modifiers, const QString& text) {
    auto* item = static_cast<QQuickItem*>(object);
    if (!item->hasActiveFocus() || !item->window()) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt Quick target no longer holds keyboard focus");
    QPointer<QQuickItem> target(item);
    sendKeyPair(item->window(), key, modifiers, text, [target] { return target && target->hasActiveFocus(); });
}
void QuickAdapter::typeCharacter(QObject* object, char character) {
    key(object, static_cast<Qt::Key>(QChar::fromLatin1(character).toUpper().unicode()), Qt::NoModifier, QString(QChar::fromLatin1(character)));
}
void QuickAdapter::commitText(QObject* object, const QString& text) {
    auto* item = static_cast<QQuickItem*>(object);
    if (!item->hasActiveFocus() || !item->window()) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt Quick target no longer holds keyboard focus");
    QInputMethodEvent event;
    event.setCommitString(text);
    QCoreApplication::sendEvent(item, &event);
}
bool QuickAdapter::editable(QObject* object) const { return object->property("readOnly").isValid() && !object->property("readOnly").toBool(); }
bool QuickAdapter::checkable(QObject* object) const { return object->property("checked").isValid(); }
bool QuickAdapter::checked(QObject* object) const { return object->property("checked").toBool(); }
void QuickAdapter::setChecked(QObject* object, bool value) { if (checked(object) != value) click(object, Qt::LeftButton, false, false); }
QObject* QuickAdapter::focused(QObject* root) const { return static_cast<QQuickWindow*>(root)->activeFocusItem(); }
int QuickAdapter::optionIndex(QObject* object, const QJsonValue& option) const {
    // Inspect only the control's public QML API. No private Qt headers or
    // generated JavaScript are involved, and selection follows the key path so
    // application handlers receive ComboBox::activated as real input does.
    if (!object->inherits("QQuickComboBox")) throw Failure("UNSUPPORTED_CAPABILITY", "selectOption requires a Qt Quick Controls ComboBox");
    QPointer<QObject> target(object);
    const int count = target->property("count").toInt();
    if (count < 1 || count > 10000) throw Failure("NOT_ACTIONABLE", "combobox model is empty or exceeds action bound");
    QString label, value;
    bool byLabel = option.isString(), byValue = false;
    int index = -1;
    if (byLabel) label = option.toString();
    else if (option.isObject()) {
        const QJsonObject selector = option.toObject();
        if (selector.size() == 1 && selector.value("label").isString()) { byLabel = true; label = selector.value("label").toString(); }
        else if (selector.size() == 1 && selector.value("value").isString()) { byValue = true; value = selector.value("value").toString(); }
        else if (selector.size() == 1 && selector.value("index").isDouble()) {
            const double candidate = selector.value("index").toDouble(-1);
            if (std::isfinite(candidate) && candidate >= 0 && candidate < count && std::floor(candidate) == candidate) index = int(candidate);
        }
    }
    if (byLabel || byValue) {
        for (int candidate = 0; candidate < count; ++candidate) {
            bool match = false;
            if (byLabel) {
                QString text;
                if (!QMetaObject::invokeMethod(target, "textAt", Qt::DirectConnection, Q_RETURN_ARG(QString, text), Q_ARG(int, candidate)))
                    throw Failure("UNSUPPORTED_CAPABILITY", "combobox text lookup is unavailable");
                match = text == label;
            } else {
                QVariant data;
                if (!QMetaObject::invokeMethod(target, "valueAt", Qt::DirectConnection, Q_RETURN_ARG(QVariant, data), Q_ARG(int, candidate)))
                    throw Failure("UNSUPPORTED_CAPABILITY", "combobox value lookup is unavailable");
                match = data.metaType().id() == QMetaType::QString && data.toString() == value;
            }
            if (!target) throw Failure("NODE_STALE", "combobox was destroyed during option lookup");
            if (match) {
                if (index >= 0) throw Failure("NOT_ACTIONABLE", "combobox option is ambiguous; select by index");
                index = candidate;
            }
        }
    }
    if (index < 0 || index >= count) throw Failure("NOT_ACTIONABLE", "combobox option is absent or selector is invalid");
    QObject* popup = target->property("popup").value<QObject*>();
    if (popup && popup->property("visible").toBool()) throw Failure("NOT_ACTIONABLE", "close the combobox popup before selecting an option");
    // Editable controls route navigation keys into their text editor. Refuse
    // that different interaction contract instead of setting currentIndex.
    if (target->property("editable").toBool()) throw Failure("UNSUPPORTED_CAPABILITY", "selectOption requires a non-editable Qt Quick ComboBox");
    return index;
}
void QuickAdapter::selectOption(QObject* object, const QJsonValue& option) {
    const int index = optionIndex(object, option);
    QPointer<QObject> target(object);
    const int count = target->property("count").toInt();
    if (target->property("currentIndex").toInt() == index) return;
    QString expectedText;
    QVariant expectedValue;
    if (!QMetaObject::invokeMethod(target, "textAt", Qt::DirectConnection, Q_RETURN_ARG(QString, expectedText), Q_ARG(int, index))
        || !QMetaObject::invokeMethod(target, "valueAt", Qt::DirectConnection, Q_RETURN_ARG(QVariant, expectedValue), Q_ARG(int, index)))
        throw Failure("UNSUPPORTED_CAPABILITY", "combobox option inspection is unavailable");
    if (!target) throw Failure("NODE_STALE", "combobox was destroyed during option lookup");
    focus(target);
    if (!target) throw Failure("ACTION_MAY_HAVE_COMMITTED", "combobox was destroyed during focus");
    key(target, Qt::Key_Home, Qt::NoModifier);
    if (!target || target->property("currentIndex").toInt() != 0 || target->property("count").toInt() != count)
        throw Failure("ACTION_MAY_HAVE_COMMITTED", "combobox did not accept initial navigation");
    for (int step = 0; step < index; ++step) {
        key(target, Qt::Key_Down, Qt::NoModifier);
        if (!target || target->property("currentIndex").toInt() != step + 1 || target->property("count").toInt() != count)
            throw Failure("ACTION_MAY_HAVE_COMMITTED", "combobox selection changed or did not reach the requested option");
    }
    if (target->property("currentText").toString() != expectedText || target->property("currentValue") != expectedValue)
        throw Failure("ACTION_MAY_HAVE_COMMITTED", "combobox model changed during selection");
}
QImage QuickAdapter::capture(QObject* root) {
    auto* window = static_cast<QQuickWindow*>(root);
    if (qint64(window->width()) * window->height() * window->devicePixelRatio() * window->devicePixelRatio() > MaxPixels) throw Failure("ENGINE_FAILURE", "screenshot exceeds pixel limit");
    return window->grabWindow();
}
void QuickAdapter::secureRegions(QObject* root, QList<QRectF>& regions, int& count) const {
    if (secureObject(root)) {
        const auto* window = static_cast<QQuickWindow*>(root);
        ++count;
        regions.append(QRectF(0, 0, window->width(), window->height()));
        return;
    }
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
