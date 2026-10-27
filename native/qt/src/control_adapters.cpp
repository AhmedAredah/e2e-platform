// SPDX-License-Identifier: MIT
#include "control_adapters.h"
#include <QPointer>
#include <QSet>
#include <QWidget>
#ifdef E2E_QT_HAS_QUICK
#include <QQuickItem>
#endif

namespace e2e::qt {
ControlAdapter::~ControlAdapter() = default;
}

namespace e2e::qt::detail {
namespace {
const QSet<QString> permittedActions{
    "tap", "doubleTap", "secondaryTap", "hover", "fill", "clear", "focus",
    "press", "check", "uncheck", "selectOption", "scrollIntoView", "swipe"};
}
bool ControlAdapters::add(std::shared_ptr<ControlAdapter> adapter, QString& error) {
    if (!adapter || adapter->interfaceVersion() != 1) { error = "control adapter version must be 1"; return false; }
    const QString name = adapter->name();
    if (name.trimmed().isEmpty() || name.size() > 128) { error = "control adapter needs a bounded name"; return false; }
    for (const auto& current : adapters_) if (current->name() == name) { error = "control adapter name already registered"; return false; }
    QSet<QString> seen;
    for (const QString& action : adapter->actions()) {
        if (!permittedActions.contains(action) || seen.contains(action)) { error = "control adapter declares an unsupported or duplicate action"; return false; }
        seen.insert(action);
    }
    if (adapters_.size() >= 64) { error = "control adapter registration limit exceeded"; return false; }
    adapters_.push_back(std::move(adapter));
    return true;
}
ControlAdapter* ControlAdapters::find(QObject* object) const {
    if (!object) throw Failure("NODE_STALE", "custom control was destroyed");
    bool supported = qobject_cast<QWidget*>(object);
#ifdef E2E_QT_HAS_QUICK
    supported |= qobject_cast<QQuickItem*>(object) != nullptr;
#endif
    if (!supported) return nullptr;
    QPointer<QObject> target(object);
    for (const auto& adapter : adapters_) {
        const bool accepted = adapter->accepts(*object);
        if (!target) throw Failure("NODE_STALE", "custom control was destroyed during inspection");
        if (accepted) return adapter.get();
    }
    return nullptr;
}
std::optional<ControlSnapshot> ControlAdapters::snapshot(QObject* object) const {
    ControlAdapter* adapter = find(object);
    if (!adapter) return {};
    QPointer<QObject> target(object);
    auto result = adapter->snapshot(*object);
    if (!target) throw Failure("NODE_STALE", "custom control was destroyed during observation");
    if (result.role.isEmpty() || result.role.size() > 128 || result.attributes.size() > 64)
        throw Failure("ENGINE_FAILURE", "custom control snapshot exceeds contract bounds");
    if (result.secure) markSensitiveObject(object);
    return result;
}
bool ControlAdapters::handles(QObject* object) const { return find(object) != nullptr; }
bool ControlAdapters::ready(QObject* object, const QJsonObject& action) const {
    ControlAdapter* adapter = find(object);
    if (!adapter) return false;
    if (!adapter->actions().contains(action.value("kind").toString()))
        throw Failure("UNSUPPORTED_CAPABILITY", "custom control does not implement this action");
    QPointer<QObject> target(object);
    const bool ready = adapter->ready(*object, action);
    if (!target) throw Failure("NODE_STALE", "custom control was destroyed during readiness inspection");
    if (!ready) throw Failure("NOT_ACTIONABLE", "custom control is not ready");
    return true;
}
bool ControlAdapters::perform(QObject* object, const QJsonObject& action) const {
    if (!ready(object, action)) return false;
    ControlAdapter* adapter = find(object);
    if (!adapter) throw Failure("NODE_STALE", "custom control adapter changed before input");
    QPointer<QObject> target(object);
    try { adapter->perform(*object, action); }
    catch (...) { throw Failure("ACTION_MAY_HAVE_COMMITTED", "custom control action failed after dispatch"); }
    if (!target) throw Failure("ACTION_MAY_HAVE_COMMITTED", "custom control was destroyed during input");
    return true;
}
void ControlAdapters::apply(QJsonObject& node, const ControlSnapshot& data) {
    node["role"] = clean(data.role, 128);
    for (const char* field : {"name", "text", "value", "attributes"}) node.remove(field);
    if (data.name) node["name"] = clean(*data.name, 256);
    auto states = node.value("states").toObject();
    if (data.checked) states["checked"] = *data.checked;
    if (data.selected) states["selected"] = *data.selected;
    if (data.expanded) states["expanded"] = *data.expanded;
    if (data.pressed) states["pressed"] = *data.pressed;
    node["states"] = states;
    if (states.value("secure").toBool()) return;
    if (data.text) node["text"] = clean(*data.text);
    if (data.value) node["value"] = clean(*data.value);
    QJsonObject attributes;
    for (auto it = data.attributes.cbegin(); it != data.attributes.cend(); ++it) {
        if (it.key().isEmpty() || it.key().size() > 128) throw Failure("ENGINE_FAILURE", "custom control attribute name exceeds bound");
        attributes[it.key()] = clean(it.value(), 4096);
    }
    if (!attributes.isEmpty()) node["attributes"] = attributes;
}
}
