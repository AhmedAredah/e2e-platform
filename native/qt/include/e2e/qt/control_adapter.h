// SPDX-License-Identifier: MIT
#pragma once

#include <e2e/qt/export.h>
#include <QJsonObject>
#include <QMap>
#include <QObject>
#include <QStringList>
#include <optional>

namespace e2e::qt {

/** Version-one semantic data for one application-owned control. */
struct ControlSnapshot {
    QString role = QStringLiteral("group");
    std::optional<QString> name;
    std::optional<QString> text;
    std::optional<QString> value;
    QMap<QString, QString> attributes;
    std::optional<bool> checked;
    std::optional<bool> selected;
    std::optional<bool> expanded;
    std::optional<bool> pressed;
    bool secure = false;
    bool omitChildren = true;
};

/**
 * Source-level extension contract for custom QWidget/QQuickItem controls.
 * Rebuild adapters with the helper and application's Qt/compiler kit; this is
 * not a cross-version binary plugin ABI. All callbacks execute on the GUI
 * thread and must return promptly. The helper owns a shared adapter reference.
 * Never retain a control reference beyond a callback without a QPointer.
 *
 * Actions use the documented protocol-v1 action object. ready() must be a
 * read-only check: false means no mutation has occurred. perform() is invoked
 * once; exceptions are uncertain outcomes and must never request a retry.
 * Application adapters are trusted code, not a sandbox.
 */
class E2E_QT_BRIDGE_EXPORT ControlAdapter {
public:
    virtual ~ControlAdapter();
    virtual unsigned int interfaceVersion() const noexcept { return 1; }
    virtual QString name() const = 0;
    virtual bool accepts(const QObject& control) const = 0;
    virtual ControlSnapshot snapshot(const QObject& control) const = 0;
    virtual QStringList actions() const = 0;
    virtual bool ready(const QObject& control, const QJsonObject& action) const = 0;
    virtual void perform(QObject& control, const QJsonObject& action) = 0;
};

} // namespace e2e::qt
