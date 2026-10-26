// SPDX-License-Identifier: MIT
#pragma once
#include <QJsonObject>
#include <QRectF>
#include <QString>
#include <QObject>
class QWidget;
#include <stdexcept>
namespace e2e::qt::detail {
inline constexpr int MaxMessage = 1024 * 1024;
inline constexpr int MaxReply = 12 * 1024 * 1024;
inline constexpr int MaxNodes = 20000;
inline constexpr int MaxDepth = 64;
inline constexpr int MaxText = 65536;
inline constexpr qint64 MaxPixels = 16 * 1024 * 1024;
struct Failure : std::runtime_error {
    QString code;
    explicit Failure(QString c, const char* message) : std::runtime_error(message), code(std::move(c)) {}
};
QString clean(QString value, int limit = MaxText);
QJsonObject rectJson(const QRectF& rect);
QString requiredText(const QJsonObject& params, const char* key);
QString accessibleName(QObject* object);
QString widgetRole(QWidget* widget);
QPoint widgetPoint(QWidget* widget);
bool secureObject(QObject* object);
struct ParsedKey { Qt::Key key; Qt::KeyboardModifiers modifiers; QString text; };
struct KeyboardPlatform { bool macos; bool dontSwapControlAndMeta; };
ParsedKey parseKey(QString value);
ParsedKey parseKey(QString value, KeyboardPlatform platform);
void sendKeyPair(QObject* target, Qt::Key key, Qt::KeyboardModifiers modifiers, const QString& text);
}
