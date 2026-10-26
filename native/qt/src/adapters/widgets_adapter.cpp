// SPDX-License-Identifier: MIT
#include "widgets_adapter.h"
#include <QAbstractButton>
#include <QAbstractItemView>
#include <QPersistentModelIndex>
#include <QApplication>
#include <QComboBox>
#include <QJsonArray>
#include <QLabel>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QTest>
#include <QTextEdit>
#include <QWindow>
#include <cmath>

namespace e2e::qt::detail {
QJsonObject WidgetsAdapter::node(QObject* object, QObject* rootObject, int depth, ObjectRegistry& registry, bool isRoot) {
    auto* widget = qobject_cast<QWidget*>(object);
    auto* root = qobject_cast<QWidget*>(rootObject);
        if (!registry.visit(depth)) return {};
        QJsonObject node = registry.node(widget, isRoot);
        const bool secure = secureObject(widget);
        const bool hidden = !widget->isVisibleTo(root) || !widget->isVisible();
        QJsonObject states{{"hidden", hidden}, {"disabled", !widget->isEnabled()}, {"focused", widget->hasFocus()}};
        node["role"] = widgetRole(widget);
        QString name = clean(widget->accessibleName(), 256);
        if (name.isEmpty()) name = accessibleName(widget);
        if (isRoot) name = clean(widget->windowTitle(), 256);
        if (secure) {
            states["secure"] = true;
            node["inputPurpose"] = qobject_cast<QLineEdit*>(widget) && qobject_cast<QLineEdit*>(widget)->echoMode() != QLineEdit::Normal ? "password" : "generic-secret";
            // Only explicit labels are trusted for secure fields; never derive a name from its value.
            name = clean(widget->accessibleName(), 256);
        } else {
            node["attributes"] = QJsonObject{{"class", clean(widget->metaObject()->className(), 256)}};
            if (auto* button = qobject_cast<QAbstractButton*>(widget)) {
                const QString text = clean(button->text());
                node["text"] = text;
                if (name.isEmpty()) name = clean(text, 256);
                if (button->isCheckable()) states[node.value("role") == "button" ? "pressed" : "checked"] = button->isChecked();
            } else if (auto* edit = qobject_cast<QLineEdit*>(widget)) {
                node["value"] = clean(edit->text());
                node["attributes"] = QJsonObject{{"class", "QLineEdit"}, {"placeholder", clean(edit->placeholderText())}, {"editable", edit->isReadOnly() ? "false" : "true"}};
            } else if (auto* edit = qobject_cast<QTextEdit*>(widget)) node["value"] = clean(edit->toPlainText());
            else if (auto* edit = qobject_cast<QPlainTextEdit*>(widget)) node["value"] = clean(edit->toPlainText());
            else if (auto* label = qobject_cast<QLabel*>(widget)) { node["text"] = clean(label->text()); if (name.isEmpty()) name = clean(label->text(), 256); }
            else if (auto* combo = qobject_cast<QComboBox*>(widget)) { node["value"] = clean(combo->currentText()); node["text"] = clean(combo->currentText()); }
        }
        if (!name.isEmpty()) node["name"] = name;
        node["states"] = states;
        node["rect"] = rectJson(QRect(widget->mapTo(root, QPoint()), widget->size()));
        if (!registry.reserveNode(node)) return {};
        if (secure) return node;
        QJsonArray children;
        for (QObject* child : widget->children()) {
            QWidget* childWidget = qobject_cast<QWidget*>(child);
            if (!childWidget || childWidget->isWindow()) continue;
            const QJsonObject childNode = this->node(childWidget, root, depth + 1, registry, false);
            if (!childNode.isEmpty()) children.append(childNode);
            if (registry.truncated) break;
        }
        if (!children.isEmpty()) node["children"] = children;
        return node;
    }


QObject* WidgetsAdapter::root() const {
    if (!qobject_cast<QApplication*>(QCoreApplication::instance())) return nullptr;
    if (auto* widget = QApplication::activeModalWidget()) return widget;
    if (auto* widget = QApplication::activeWindow()) return widget;
    for (QWidget* widget : QApplication::topLevelWidgets())
        if (widget->isVisible() && widget->windowType() != Qt::ToolTip) return widget;
    return nullptr;
}
bool WidgetsAdapter::accepts(QObject* object) const { return qobject_cast<QWidget*>(object); }
QSize WidgetsAdapter::size(QObject* root) const { return static_cast<QWidget*>(root)->size(); }
QJsonObject WidgetsAdapter::snapshot(QObject* root, ObjectRegistry& registry) {
    QJsonObject tree = node(root, root, 0, registry, true);
    const QSize viewport = size(root);
    return {{"root", tree}, {"viewport", QJsonObject{{"width", viewport.width()}, {"height", viewport.height()}}}, {"location", "qt:view"}, {"truncated", registry.truncated}};
}
void WidgetsAdapter::actionable(QObject* object, QObject* rootObject) const {
    auto* widget = qobject_cast<QWidget*>(object);
    auto* root = qobject_cast<QWidget*>(rootObject);
    if (!widget || !root || !widget->isVisible() || !widget->isEnabled() || widget->width() <= 0 || widget->height() <= 0 || widget->window() != root)
        throw Failure("NOT_ACTIONABLE", "Qt widget is hidden, disabled, empty, or outside active window");
    const QPoint point = widgetPoint(widget);
    if (!widget->visibleRegion().contains(point)) throw Failure("NOT_ACTIONABLE", "Qt target is clipped");
    QWidget* hit = root->childAt(widget->mapTo(root, point));
    if (widget != root && hit && hit != widget && !widget->isAncestorOf(hit)) throw Failure("NOT_ACTIONABLE", "Qt target is covered by another widget");
}
void WidgetsAdapter::click(QObject* object, Qt::MouseButton button, bool twice, bool hover) {
    auto* widget = static_cast<QWidget*>(object);
    QPointer<QWindow> window(widget->window()->windowHandle());
    if (!window) throw Failure("NOT_ACTIONABLE", "Qt window is not exposed");
    const QPoint point = widget->mapTo(widget->window(), widgetPoint(widget));
    if (hover) { QTest::mouseMove(window, point); return; }
    if (twice) { QTest::mouseDClick(window, button, Qt::NoModifier, point); return; }
    QTest::mousePress(window, button, Qt::NoModifier, point);
    if (!window) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt window was destroyed during pointer input");
    QTest::mouseRelease(window, button, Qt::NoModifier, point);
}
void WidgetsAdapter::focus(QObject* object) { static_cast<QWidget*>(object)->setFocus(Qt::OtherFocusReason); }
void WidgetsAdapter::key(QObject* object, Qt::Key key, Qt::KeyboardModifiers modifiers, const QString& text) {
    sendKeyPair(object, key, modifiers, text);
}
void WidgetsAdapter::typeCharacter(QObject* object, char character) {
    sendKeyPair(object, static_cast<Qt::Key>(QChar::fromLatin1(character).toUpper().unicode()), Qt::NoModifier, QString(QChar::fromLatin1(character)));
}
bool WidgetsAdapter::editable(QObject* object) const {
    if (auto* edit = qobject_cast<QLineEdit*>(object)) return !edit->isReadOnly();
    if (auto* edit = qobject_cast<QTextEdit*>(object)) return !edit->isReadOnly();
    if (auto* edit = qobject_cast<QPlainTextEdit*>(object)) return !edit->isReadOnly();
    return false;
}
bool WidgetsAdapter::checkable(QObject* object) const { auto* button = qobject_cast<QAbstractButton*>(object); return button && button->isCheckable(); }
QObject* WidgetsAdapter::focused(QObject*) const { return QApplication::focusWidget(); }
void WidgetsAdapter::selectOption(QObject* object, const QJsonValue& option) {
    auto* combo = qobject_cast<QComboBox*>(object);
    if (!combo) throw Failure("UNSUPPORTED_CAPABILITY", "selectOption requires QComboBox");
    const int count = combo->count();
    if (count < 1 || count > 10000) throw Failure("NOT_ACTIONABLE", "combobox model is empty or exceeds action bound");
    int index = -1;
    QString label, value;
    bool byLabel = option.isString(), byValue = false;
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
            const QVariant data = combo->itemData(candidate);
            const bool match = byLabel ? combo->itemText(candidate) == label
                : data.metaType().id() == QMetaType::QString && data.toString() == value;
            if (!match) continue;
            if (index >= 0) throw Failure("NOT_ACTIONABLE", "combobox option is ambiguous; select by index");
            index = candidate;
        }
    }
    if (index < 0) throw Failure("NOT_ACTIONABLE", "combobox option is absent or selector is invalid");
    if (combo->isEditable()) throw Failure("UNSUPPORTED_CAPABILITY", "selectOption requires a non-editable QComboBox");
    if (combo->view()->isVisible()) throw Failure("NOT_ACTIONABLE", "close the combobox popup before selecting an option");
    const QPersistentModelIndex selected(combo->model()->index(index, combo->modelColumn(), combo->rootModelIndex()));
    const auto allowed = Qt::ItemIsEnabled | Qt::ItemIsSelectable;
    if (!selected.isValid() || (selected.flags() & allowed) != allowed) throw Failure("NOT_ACTIONABLE", "combobox option is disabled or not selectable");
    if (combo->currentIndex() == index) return;
    const QString expectedText = combo->itemText(index);
    const QVariant expectedValue = combo->itemData(index);
    QList<int> path;
    for (int row = 0; row <= index; ++row) {
        const auto item = combo->model()->index(row, combo->modelColumn(), combo->rootModelIndex());
        if ((item.flags() & allowed) == allowed) path.append(row);
    }
    QPointer<QComboBox> target(combo);
    const auto unchanged = [&] {
        return target && selected.isValid() && target->model() == selected.model() && target->count() == count
            && selected.row() == index && target->itemText(index) == expectedText && target->itemData(index) == expectedValue;
    };
    focus(target);
    if (!unchanged()) throw Failure("ACTION_MAY_HAVE_COMMITTED", "combobox changed during focus");
    for (int step = 0; step < path.size(); ++step) {
        key(target, step == 0 ? Qt::Key_Home : Qt::Key_Down, Qt::NoModifier);
        if (!unchanged() || target->currentIndex() != path.at(step))
            throw Failure("ACTION_MAY_HAVE_COMMITTED", "combobox selection changed or did not reach the requested option");
    }
}

QImage WidgetsAdapter::capture(QObject* root) {
    auto* widget = static_cast<QWidget*>(root);
    if (qint64(widget->width()) * widget->height() * widget->devicePixelRatioF() * widget->devicePixelRatioF() > MaxPixels) throw Failure("ENGINE_FAILURE", "screenshot exceeds pixel limit");
    return widget->grab().toImage();
}
void WidgetsAdapter::secureRegions(QObject* rootObject, QList<QRectF>& regions, int& count) const {
    auto* root = static_cast<QWidget*>(rootObject);
    QList<QWidget*> all = root->findChildren<QWidget*>();
    if (all.size() > MaxNodes) throw Failure("POLICY_DENIED", "cannot prove screenshot masking for oversized widget tree");
    all.prepend(root);
    for (QWidget* child : all) if (secureObject(child)) {
        ++count;
        if (child->isVisibleTo(root)) regions.append(QRectF(child->mapTo(root, QPoint()), child->size()));
    }
}
}
