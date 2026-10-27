// SPDX-License-Identifier: MIT
#include "support.h"
#include <QAbstractButton>
#include <QAbstractItemView>
#include <QAccessible>
#include <QComboBox>
#include <QCheckBox>
#include <QStyle>
#include <QStyleOptionButton>
#include <QLabel>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QRadioButton>
#include <QTextEdit>
#include <QHash>
#include <QStringList>
#include <QCoreApplication>
#include <QKeyEvent>
#include <QPointer>
#include <QMetaProperty>
#include <QSet>

#ifdef E2E_QT_HAS_QUICK
#include <QQuickItem>
#endif

namespace e2e::qt::detail {
void sendKeyPair(QObject* object, Qt::Key key, Qt::KeyboardModifiers modifiers, const QString& text, const std::function<bool()>& retainsFocus) {
    QPointer<QObject> target(object);
    QKeyEvent press(QEvent::KeyPress, key, modifiers, text);
    QCoreApplication::sendEvent(target, &press);
    if (!target) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt target was destroyed during key input");
    // A character-bearing release must not reveal text to a control that
    // acquired focus in the press handler. Navigation keys may move focus.
    if (!text.isEmpty() && !retainsFocus()) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt keyboard focus changed during character input");
    QKeyEvent release(QEvent::KeyRelease, key, modifiers, text);
    QCoreApplication::sendEvent(target, &release);
}
QString clean(QString value, int limit) {
    // The runner knows registered secrets; clipping here would leave prefixes
    // that its later exact-value redaction can no longer recognize.
    if (value.contains(QChar::Null)) return QStringLiteral("[omitted: text contains NUL]");
    return value.size() > limit ? QStringLiteral("[omitted: text exceeds limit]") : value;
}

QJsonObject rectJson(const QRectF& rect) {
    return {{"x", rect.x()}, {"y", rect.y()}, {"width", rect.width()}, {"height", rect.height()}};
}

QString requiredText(const QJsonObject& params, const char* key) {
    if (!params.value(QLatin1String(key)).isString()) throw Failure("INVALID_STATE", "string argument required");
    const QString text = params.value(QLatin1String(key)).toString();
    if (text.size() > MaxText) throw Failure("INVALID_STATE", "text argument exceeds limit");
    return text;
}

QString accessibleName(QObject* object) {
    auto* accessible = QAccessible::queryAccessibleInterface(object);
    return accessible ? clean(accessible->text(QAccessible::Name), 256) : QString();
}

QString accessibleRole(QObject* object, const QString& fallback) {
    auto* interface = QAccessible::queryAccessibleInterface(object);
    if (!interface) return fallback;
    switch (interface->role()) {
    case QAccessible::Button: return "button";
    case QAccessible::CheckBox: return "checkbox";
    case QAccessible::RadioButton: return "radio";
    case QAccessible::ComboBox: return "combobox";
    case QAccessible::EditableText: return "textbox";
    case QAccessible::StaticText: return "text";
    case QAccessible::List: return "listbox";
    case QAccessible::Tree: return "tree";
    case QAccessible::Table: return "grid";
    case QAccessible::PageTab: return "tab";
    case QAccessible::PageTabList: return "tablist";
    case QAccessible::MenuBar: return "menubar";
    case QAccessible::PopupMenu: return "menu";
    case QAccessible::MenuItem: return "menuitem";
    case QAccessible::Slider: return "slider";
    case QAccessible::SpinBox: return "spinbutton";
    case QAccessible::ProgressBar: return "progressbar";
    case QAccessible::ScrollBar: return "scrollbar";
    case QAccessible::ToolBar: return "toolbar";
    case QAccessible::Dialog: return "dialog";
    case QAccessible::Window: return "window";
    default: return fallback;
    }
}
QString accessibleValue(QObject* object) {
    auto* interface = QAccessible::queryAccessibleInterface(object);
    if (!interface) return {};
    if (auto* value = interface->valueInterface()) return clean(value->currentValue().toString());
    return {};
}
QString widgetRole(QWidget* widget) {
    if (qobject_cast<QRadioButton*>(widget)) return "radio";
    if (qobject_cast<QCheckBox*>(widget)) return "checkbox";
    if (qobject_cast<QAbstractButton*>(widget)) return "button";
    if (qobject_cast<QLineEdit*>(widget) || qobject_cast<QTextEdit*>(widget) || qobject_cast<QPlainTextEdit*>(widget)) return "textbox";
    if (qobject_cast<QComboBox*>(widget)) return "combobox";
    if (qobject_cast<QLabel*>(widget)) return "text";
    if (qobject_cast<QAbstractItemView*>(widget)) return "grid";
    if (widget->isWindow()) return widget->isModal() ? "dialog" : "window";
    return "group";
}

QPoint widgetPoint(QWidget* widget) {
    if (auto* button = qobject_cast<QAbstractButton*>(widget)) {
        if (qobject_cast<QCheckBox*>(widget) || qobject_cast<QRadioButton*>(widget)) {
            QStyleOptionButton option;
            option.initFrom(widget);
            option.text = button->text();
            option.icon = button->icon();
            option.iconSize = button->iconSize();
            const auto element = qobject_cast<QRadioButton*>(widget) ? QStyle::SE_RadioButtonClickRect : QStyle::SE_CheckBoxClickRect;
            return widget->style()->subElementRect(element, &option, widget).center();
        }
    }
    return widget->rect().center();
}

namespace {
/** Application markers cannot clear secrecy established by a sensitive fill. */
class SensitiveObjects final : public QObject {
public:
    explicit SensitiveObjects(QObject* parent) : QObject(parent) {}
    void mark(QObject* object) {
        if (objects_.contains(object)) return;
        objects_.insert(object);
        QObject::connect(object, &QObject::destroyed, this, [this, object] { objects_.remove(object); });
    }
    bool contains(QObject* object) const { return objects_.contains(object); }
private:
    QSet<QObject*> objects_;
};

SensitiveObjects& sensitiveObjects() {
    // QObject infrastructure must not outlive the application/GUI thread.
    static QPointer<SensitiveObjects> objects;
    if (!objects) objects = new SensitiveObjects(QCoreApplication::instance());
    return *objects;
}

bool secureMarker(QObject* object) {
    if (sensitiveObjects().contains(object)) return true;
    const int index = object->metaObject()->indexOfProperty("e2eSecure");
    if (index >= 0) {
        const QMetaProperty property = object->metaObject()->property(index);
        // A mutable declaration without NOTIFY can change and change back
        // inside paint, defeating both signal guards and before/after checks.
        if (!property.isConstant() && !property.hasNotifySignal()) return true;
    }
    return object->property("e2eSecure").toBool();
}
}

void markSensitiveObject(QObject* object) { sensitiveObjects().mark(object); }

bool secureObject(QObject* object) {
    bool detected = false;
    if (auto* interface = QAccessible::queryAccessibleInterface(object)) detected = interface->state().passwordEdit;
    for (QObject* ancestor = object; ancestor; ancestor = ancestor->parent())
        if (secureMarker(ancestor)) { detected = true; break; }
    if (auto* edit = qobject_cast<QLineEdit*>(object)) detected |= edit->echoMode() != QLineEdit::Normal;
#ifdef E2E_QT_HAS_QUICK
    for (auto* item = qobject_cast<QQuickItem*>(object); item; item = item->parentItem()) {
        if (secureMarker(item) || (item->property("echoMode").isValid() && item->property("echoMode").toInt() != 0)) {
            detected = true;
            break;
        }
    }
#endif
    // Revealing a password or clearing a marker must not declassify old data.
    if (detected) sensitiveObjects().mark(object);
    return detected;
}

ParsedKey parseKey(QString value) {
#ifdef Q_OS_MACOS
    constexpr bool macos = true;
#else
    constexpr bool macos = false;
#endif
    return parseKey(std::move(value), {macos, QCoreApplication::testAttribute(Qt::AA_MacDontSwapCtrlAndMeta)});
}

ParsedKey parseKey(QString value, KeyboardPlatform platform) {
    // Qt normally represents physical Command as Control on macOS. The
    // application attribute opts out of that translation, not of our grammar.
    const bool swapped = platform.macos && !platform.dontSwapControlAndMeta;
    const auto control = swapped ? Qt::MetaModifier : Qt::ControlModifier;
    const auto meta = swapped ? Qt::ControlModifier : Qt::MetaModifier;
    Qt::KeyboardModifiers modifiers = Qt::NoModifier;
    QStringList parts = value.split('+');
    if (value.endsWith('+')) {
        if (value == "+") parts = QStringList{"+"};
        else if (value.endsWith("++")) { parts.removeLast(); parts.last() = "+"; }
    }
    for (int i = 0; i + 1 < parts.size(); ++i) {
        const QString& part = parts[i];
        if (part == "ControlOrMeta") modifiers |= platform.macos ? meta : control;
        else if (part == "Control" || part == "Ctrl") modifiers |= control;
        else if (part == "Meta" || part == "Command") modifiers |= meta;
        else if (part == "Alt") modifiers |= Qt::AltModifier;
        else if (part == "Shift") modifiers |= Qt::ShiftModifier;
        else throw Failure("UNSUPPORTED_CAPABILITY", "unsupported key modifier");
    }
    const QString key = parts.constLast();
    static const QHash<QString, Qt::Key> keys = {
        {"Enter", Qt::Key_Return}, {"Return", Qt::Key_Return}, {"Tab", Qt::Key_Tab},
        {"Insert", Qt::Key_Insert}, {"Escape", Qt::Key_Escape}, {"Backspace", Qt::Key_Backspace}, {"Delete", Qt::Key_Delete},
        {"ArrowUp", Qt::Key_Up}, {"ArrowDown", Qt::Key_Down}, {"ArrowLeft", Qt::Key_Left},
        {"ArrowRight", Qt::Key_Right}, {"Home", Qt::Key_Home}, {"End", Qt::Key_End},
        {"PageUp", Qt::Key_PageUp}, {"PageDown", Qt::Key_PageDown}, {"Space", Qt::Key_Space},
    };
    if (keys.contains(key)) return {keys.value(key), modifiers, key == "Space" ? QString(" ") : QString()};
    if (key.size() == 1 && key.at(0).unicode() >= 32 && key.at(0).unicode() <= 126) {
        const QString text = modifiers.testFlag(Qt::ShiftModifier) ? key.toUpper() : key;
        return {static_cast<Qt::Key>(key.toUpper().at(0).unicode()), modifiers, text};
    }
    if (key.startsWith('F')) {
        bool ok = false;
        const int number = key.mid(1).toInt(&ok);
        if (ok && number >= 1 && number <= 12) return {static_cast<Qt::Key>(Qt::Key_F1 + number - 1), modifiers, {}};
    }
    throw Failure("UNSUPPORTED_CAPABILITY", "unsupported key");
}
}
