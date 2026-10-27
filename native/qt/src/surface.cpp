// SPDX-License-Identifier: MIT
#include "surface.h"
#include "adapters/widgets_adapter.h"
#ifdef E2E_QT_HAS_QUICK
#include "adapters/quick_adapter.h"
#endif
#include "capture_guard.h"
#include <QApplication>
#include <QWidget>
#include <QWindow>
#include <QBuffer>
#include <QCoreApplication>
#include <QInputMethodEvent>
#include <QPainter>

namespace e2e::qt::detail {
Surface::Surface() {
    clock_.start();
    adapters_.push_back(std::make_unique<WidgetsAdapter>(&custom_));
#ifdef E2E_QT_HAS_QUICK
    adapters_.push_back(std::make_unique<QuickAdapter>(&custom_));
#endif
}
QJsonArray Surface::windows() {
    for (auto it = windows_.begin(); it != windows_.end();) {
        if (!it.value()) it = windows_.erase(it); else ++it;
    }
    QJsonArray result;
    QObject* activeObject = nullptr;
    try { activeObject = active().first; } catch (const Failure&) { }
    for (QWindow* window : QGuiApplication::topLevelWindows()) {
        QObject* object = window;
        if (qobject_cast<QApplication*>(QCoreApplication::instance()))
            for (QWidget* widget : QApplication::topLevelWidgets())
                if (widget->windowHandle() == window) { object = widget; break; }
        bool supported = false;
        for (const auto& adapter : adapters_) if (adapter->accepts(object)) { supported = true; break; }
        if (!supported) continue;
        QString id;
        for (auto it = windows_.cbegin(); it != windows_.cend(); ++it) if (it.value() == object) { id = it.key(); break; }
        if (id.isEmpty()) {
            if (windows_.size() >= 256) throw Failure("ENGINE_FAILURE", "Qt window limit exceeded");
            id = QStringLiteral("window-%1").arg(nextWindow_++);
            windows_.insert(id, object);
        }
        result.append(QJsonObject{{"id", id}, {"title", secureObject(object) ? QString() : clean(window->title(), 256)},
            {"visible", window->isVisible()}, {"active", object == activeObject}, {"modal", window->modality() != Qt::NonModal}});
    }
    return result;
}
void Surface::activateWindow(const QString& id) {
    QPointer<QObject> object = windows_.value(id);
    if (!object) throw Failure("NODE_STALE", "Qt window handle is stale or was not enumerated");
    QPointer<QWindow> window = qobject_cast<QWindow*>(object);
    if (auto* widget = qobject_cast<QWidget*>(object)) window = widget->windowHandle();
    if (!window || !window->isVisible()) throw Failure("NOT_ACTIONABLE", "Qt window is not visible");
    QWindow* modal = QGuiApplication::modalWindow();
    if (modal && modal != window) throw Failure("NOT_ACTIONABLE", "another Qt modal window blocks activation");
    window->raise();
    if (!object || !window) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt window was destroyed during activation");
    window->requestActivate();
    root_.clear(); adapter_ = nullptr; registry_.begin(); stable_.clear();
}
void Surface::actionability(const QJsonObject& params) {
    ensureRoot();
    const QString id = requiredText(params.value("ref").toObject(), "id");
    QObject* object = registry_.resolve(id);
    const QJsonObject action = params.value("action").toObject();
    requiredText(action, "kind");
    if (!adapter_->accepts(object)) throw Failure("UNSUPPORTED_CAPABILITY", "Qt adapter cannot inspect this target");
    adapter_->ready(object, root_, action);
    if (custom_.handles(object)) custom_.ready(object, action);
    const QRectF rect = adapter_->rectangle(object, root_);
    auto it = stable_.find(id);
    if (it == stable_.end() || it->rect != rect || it->root != root_) {
        if (stable_.size() >= MaxNodes) stable_.clear();
        stable_.insert(id, StableGeometry{rect, root_, clock_.elapsed()});
        throw Failure("NOT_ACTIONABLE", "Qt target geometry has not settled");
    }
    if (clock_.elapsed() - it->since < 50) throw Failure("NOT_ACTIONABLE", "Qt target geometry has not settled");
}
std::pair<QObject*, ObjectAdapter*> Surface::active() const {
    // Select globally before choosing an adapter. A background widget must not
    // displace a focused or modal Quick window in a mixed application.
    if (qobject_cast<QApplication*>(QCoreApplication::instance()))
        if (auto* popup = QApplication::activePopupWidget())
            for (const auto& adapter : adapters_) if (adapter->accepts(popup)) return {popup, adapter.get()};
    QWindow* window = QGuiApplication::modalWindow();
    if (!window) window = QGuiApplication::focusWindow();
    if (window) {
        QObject* object = window;
        if (qobject_cast<QApplication*>(QCoreApplication::instance()))
            for (QWidget* widget : QApplication::topLevelWidgets())
                if (widget->windowHandle() == window) { object = widget; break; }
        for (const auto& adapter : adapters_) if (adapter->accepts(object)) return {object, adapter.get()};
        throw Failure("UNSUPPORTED_CAPABILITY", "active Qt window has no supported adapter");
    }
    for (const auto& adapter : adapters_) if (QObject* root = adapter->root()) return {root, adapter.get()};
    throw Failure("NOT_ACTIONABLE", "no visible Qt window");
}
void Surface::ensureRoot() const {
    if (!root_ || active().first != root_) throw Failure("NODE_STALE", "active Qt window changed");
}
QJsonObject Surface::snapshot(bool pixels) {
    const auto target = active();
    root_ = target.first;
    adapter_ = target.second;
    QJsonObject pixelsResult;
    if (pixels) pixelsResult = screenshot();
    // Grabbing pixels can polish layouts. Serialize the settled, redacted tree.
    ensureRoot();
    registry_.begin();
    QJsonObject result = adapter_->snapshot(root_, registry_);
    ensureRoot();
    if (pixels) result["screenshot"] = pixelsResult;
    return result;
}
void Surface::key(QObject* object, const QString& text, ObjectAdapter& adapter) {
    const ParsedKey parsed = parseKey(text);
    adapter.key(object, parsed.key, parsed.modifiers, parsed.text);
}
void Surface::type(QObject* object, const QString& text, bool replace, ObjectAdapter& adapter, QObject* root) {
    adapter.actionable(object, root);
    if (!adapter.editable(object)) throw Failure("NOT_ACTIONABLE", "target is not an editable text control");
    QPointer<QObject> target(object);
    adapter.focus(object);
    if (!target) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt target was destroyed during focus");
    if (replace) { key(target, "ControlOrMeta+A", adapter); if (target) key(target, "Backspace", adapter); }
    if (!target) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt target was destroyed during input");
    for (qsizetype index = 0; index < text.size();) {
        if (!target) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt target was destroyed during input");
        const QChar character = text.at(index);
        if (character.unicode() >= 32 && character.unicode() <= 126) {
            adapter.typeCharacter(target, character.toLatin1());
            ++index;
        } else {
            // Non-ASCII text follows Qt's input-method commit path, preserving Unicode.
            qsizetype end = index + 1;
            while (end < text.size() && (text.at(end).unicode() < 32 || text.at(end).unicode() > 126)) ++end;
            adapter.commitText(target, text.mid(index, end - index));
            index = end;
        }
    }
}
void Surface::typeFocused(const QString& text, bool replace) {
    const auto target = active();
    root_ = target.first;
    adapter_ = target.second;
    QObject* object = adapter_->focused(root_);
    if (!object) throw Failure("NOT_ACTIONABLE", "no Qt control holds focus");
    type(object, text, replace, *target.second, target.first);
}
void Surface::pressFocused(const QString& text) {
    const auto target = active();
    root_ = target.first;
    adapter_ = target.second;
    QObject* object = adapter_->focused(root_);
    if (!object) throw Failure("NOT_ACTIONABLE", "no Qt control holds focus");
    adapter_->actionable(object, root_);
    key(object, text, *target.second);
}
void Surface::perform(const QJsonObject& params) {
    ensureRoot();
    ObjectAdapter& adapter = *adapter_;
    QPointer<QObject> root(root_);
    QObject* object = registry_.resolve(requiredText(params.value("ref").toObject(), "id"));
    if (!adapter.accepts(object)) throw Failure("UNSUPPORTED_CAPABILITY", "Qt adapter cannot act on this object");
    const QJsonObject action = params.value("action").toObject();
    const QString kind = requiredText(action, "kind");
    QPointer<QObject> target(object);
    adapter.ready(object, root, action);
    if (custom_.handles(object)) {
        if (kind == "fill" && action.value("sensitive").toBool()) markSensitiveObject(object);
        custom_.perform(object, action);
        return;
    }
    if (kind == "scrollIntoView") adapter.scrollIntoView(object, root);
    else if (kind == "swipe") adapter.swipe(object, root, requiredText(action, "direction"));
    else if (kind == "tap" || kind == "doubleTap" || kind == "secondaryTap" || kind == "hover")
        adapter.click(object, kind == "secondaryTap" ? Qt::RightButton : Qt::LeftButton, kind == "doubleTap", kind == "hover");
    else if (kind == "focus") adapter.focus(object);
    else if (kind == "fill" || kind == "clear") {
        const QString text = kind == "clear" ? QString() : requiredText(action, "value");
        if (kind == "fill" && action.value("sensitive").toBool()) markSensitiveObject(object);
        type(object, text, true, adapter, root);
    } else if (kind == "press") {
        const QString text = requiredText(action, "key");
        adapter.focus(object);
        if (!target) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt target was destroyed during focus");
        key(target, text, adapter);
    }
    else if (kind == "check" || kind == "uncheck") {
        const bool desired = kind == "check";
        if (!adapter.checkable(object)) throw Failure("UNSUPPORTED_CAPABILITY", "target is not checkable");
        adapter.setChecked(object, desired);
        bool reached = false;
        try { reached = target && adapter.checked(target) == desired; } catch (const Failure&) { }
        if (!reached) throw Failure("ACTION_MAY_HAVE_COMMITTED", "control did not reach requested checked state");
    } else if (kind == "selectOption") adapter.selectOption(object, action.value("value"));
    else throw Failure("UNSUPPORTED_CAPABILITY", "action is not supported");
}
QJsonObject Surface::screenshot() {
    if (!custom_.empty()) throw Failure("UNSUPPORTED_CAPABILITY", "custom control adapters do not establish screenshot masking; disable screenshots for this profile");
    const auto target = active();
    if (root_ && target.first != root_) throw Failure("NODE_STALE", "active Qt window changed before screenshot");
    QPointer<QObject> capturedRoot(target.first);
    QList<QRectF> regions;
    int secureCount = 0;
    QSize viewport;
    QImage image;
    bool stable = false;
    for (int attempt = 0; attempt < 3; ++attempt) {
        CaptureGuard guard(target.first);
        viewport = target.second->size(target.first);
        regions.clear(); secureCount = 0;
        target.second->secureRegions(target.first, regions, secureCount);
        image = target.second->capture(target.first);
        if (!capturedRoot || active().first != capturedRoot) throw Failure("NODE_STALE", "Qt window changed during capture");
        QList<QRectF> afterRegions;
        int afterCount = 0;
        target.second->secureRegions(capturedRoot, afterRegions, afterCount);
        // Some Qt properties (including QLineEdit::echoMode) have no notify
        // signal. Validate the actual mask inputs after rendering as well.
        if (!guard.changed() && target.second->size(capturedRoot) == viewport
            && afterCount == secureCount && afterRegions == regions) { stable = true; break; }
        // Discard the entire frame. Layout polishing may settle on a fresh
        // attempt; masks are recomputed, never reused across a changed capture.
        image = QImage();
    }
    if (!stable) throw Failure("POLICY_DENIED", "Qt surface changed during capture; screenshot masking cannot be proven");
    if (image.isNull()) throw Failure("ENGINE_FAILURE", "Qt screenshot capture returned no image");
    image.setDevicePixelRatio(1);
    const qreal scale = qreal(image.width()) / viewport.width();
    QPainter painter(&image);
    for (const QRectF& rect : regions) painter.fillRect(QRectF(rect.x() * scale, rect.y() * scale, rect.width() * scale, rect.height() * scale).adjusted(-2, -2, 2, 2), Qt::black);
    painter.end();
    QByteArray bytes;
    QBuffer buffer(&bytes);
    buffer.open(QIODevice::WriteOnly);
    if (!image.save(&buffer, "PNG")) throw Failure("ENGINE_FAILURE", "Qt screenshot encoding failed");
    return {{"base64", QString::fromLatin1(bytes.toBase64())}, {"width", image.width()}, {"height", image.height()},
        {"mimeType", "image/png"}, {"masked", true}, {"maskedRegionCount", secureCount}, {"scale", scale}};
}
}
