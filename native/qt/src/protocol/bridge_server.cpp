// SPDX-License-Identifier: MIT
#include "bridge_server.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QTimer>
#include <QCoreApplication>
#include <QApplication>
#include <QGuiApplication>
#include <QWindow>
#include <QWidget>
#include <cstdio>
#include <cmath>
namespace e2e::qt::detail {
BridgeServer::BridgeServer(QObject* parent) : QObject(parent), server(this) {
    QObject::connect(&server, &QTcpServer::newConnection, this, [this] { accept(); });
}
BridgeServer::~BridgeServer() {
    // Socket destruction can emit disconnected before QObject disconnects this
    // receiver. Quiesce owned sockets while client/pending and all other members
    // are still alive, rather than during QTcpServer's later member destruction.
    QObject::disconnect(&server, nullptr, this, nullptr);
    for (QTcpSocket* socket : server.findChildren<QTcpSocket*>())
        QObject::disconnect(socket, nullptr, this, nullptr);
    // close() owns unaccepted pending connections. Enumerate the remaining
    // accepted sockets afterwards so a pending socket cannot be deleted twice.
    server.close();
    for (QTcpSocket* socket : server.findChildren<QTcpSocket*>()) {
        socket->abort();
        delete socket;
    }
}
bool BridgeServer::addControlAdapter(std::shared_ptr<ControlAdapter> adapter) {
    if (server.isListening()) { error = "control adapters must be registered before the bridge starts"; return false; }
    try { return surface.addControlAdapter(std::move(adapter), error); }
    catch (...) { error = "control adapter registration failed"; return false; }
}
bool BridgeServer::start() {
        if (shuttingDown) { error = "bridge is shutting down"; return false; }
        if (server.isListening()) return true;
        token = qgetenv("E2E_NATIVE_TOKEN");
        if (token.isEmpty()) { error = "E2E_NATIVE_TOKEN is not set; bridge disabled"; return false; }
        if (token.size() < 16 || token.size() > 256) { error = "E2E_NATIVE_TOKEN must contain 16 to 256 bytes"; return false; }
        bool ok = false;
        const QByteArray rawPort = qgetenv("E2E_NATIVE_PORT");
        const int port = rawPort.isEmpty() ? 0 : rawPort.toInt(&ok);
        if ((!rawPort.isEmpty() && !ok) || port < 0 || port > 65535) { error = "invalid E2E_NATIVE_PORT"; return false; }
        if (!server.listen(QHostAddress::LocalHost, static_cast<quint16>(port))) { error = server.errorString(); return false; }
        const QByteArray ready = QJsonDocument(QJsonObject{{"port", server.serverPort()}}).toJson(QJsonDocument::Compact);
        std::fprintf(stdout, "E2E_NATIVE_READY %s\n", ready.constData());
        std::fflush(stdout);
        return true;
    }

void BridgeServer::accept() {
        while (server.hasPendingConnections()) {
            QTcpSocket* socket = server.nextPendingConnection();
            if (client || shuttingDown) { socket->disconnectFromHost(); socket->deleteLater(); continue; }
            client = socket;
            ++generation;
            authenticated = false;
            pending.clear();
            socket->setReadBufferSize(MaxMessage + 1);
            QObject::connect(socket, &QTcpSocket::readyRead, this, [this, socket] {
                if (client != socket || shuttingDown) return;
                pending += socket->readAll();
                if (pending.size() > MaxMessage) { socket->abort(); return; }
                // readyRead is not emitted recursively. Leave its stack before
                // input handlers can enter a nested application event loop.
                const ConnectionTarget target{socket, generation};
                QTimer::singleShot(0, this, [this, target] { if (current(target)) drain(); });
            });
            QObject::connect(socket, &QTcpSocket::disconnected, this, [this, socket] {
                if (client == socket) { client = nullptr; pending.clear(); authenticated = false; }
                socket->deleteLater();
            });
            QTimer::singleShot(5000, socket, [this, socket] {
                if (client == socket && !authenticated) socket->abort();
            });
        }
    }

void BridgeServer::drain() {
        if (dispatching || !client || shuttingDown) return;
        dispatching = true;
        int handled = 0;
        while (client && !shuttingDown && pending.contains('\n') && handled++ < 32) {
            const qsizetype end = pending.indexOf('\n');
            const QByteArray line = pending.left(end);
            pending.remove(0, end + 1);
            dispatch(line, {client, generation});
        }
        dispatching = false;
        if (client && !shuttingDown && pending.contains('\n')) QTimer::singleShot(0, this, [this] { drain(); });
    }

bool BridgeServer::current(const ConnectionTarget& target) const {
    return target.socket && client == target.socket && generation == target.generation
        && target.socket->state() == QAbstractSocket::ConnectedState;
}

void BridgeServer::reply(const ConnectionTarget& target, QJsonValue id, const QJsonValue& result, const Failure* failure) {
        if (!current(target)) return;
        QJsonObject message{{"jsonrpc", "2.0"}, {"id", id}};
        if (failure) {
            message["error"] = QJsonObject{{"code", -32000}, {"message", QString::fromUtf8(failure->what())},
                {"data", QJsonObject{{"code", failure->code}, {"retryable", failure->code == "NOT_ACTIONABLE" || failure->code == "NODE_STALE"}}}};
        } else message["result"] = result;
        QByteArray bytes = QJsonDocument(message).toJson(QJsonDocument::Compact);
        if (bytes.size() > MaxReply || target.socket->bytesToWrite() > MaxReply) { target.socket->abort(); return; }
        bytes.append('\n');
        target.socket->write(bytes);
    }

void BridgeServer::shutdown(const ConnectionTarget& target, const QJsonValue& id) {
    shuttingDown = true;
    reply(target, id, QJsonValue::Null);
    QTcpSocket* socket = target.socket.data();
    if (socket && socket->state() != QAbstractSocket::UnconnectedState) {
        // Qt drains queued output before completing an orderly disconnect.
        // Quitting immediately can discard the shutdown reply on Windows.
        QObject::connect(socket, &QTcpSocket::disconnected, this, [] { QCoreApplication::quit(); });
        socket->disconnectFromHost();
        if (socket->state() != QAbstractSocket::UnconnectedState) {
            // A blocked peer must not leave the application alive indefinitely
            // or turn an undelivered shutdown acknowledgement into success.
            QTimer::singleShot(2000, this, [] { QCoreApplication::exit(3); });
            return;
        }
    }
    QTimer::singleShot(0, this, [] { QCoreApplication::quit(); });
}

/**
 * Complete ordinary input synchronously. If application code enters a nested
 * event loop (for example QDialog::exec), acknowledge accepted input so the
 * controller can inspect and close that dialog. A later failure closes the
 * authenticated connection and is latched until application restart: it can
 * never disappear behind an already emitted success reply.
 */
void BridgeServer::mutation(const ConnectionTarget& target, const QJsonValue& id,
                            const std::function<void()>& operation) {
    if (activeMutations >= 8) throw Failure("NOT_ACTIONABLE", "nested Qt mutation limit reached");
    ++activeMutations;
    bool accepted = false;
    const QPointer<QWidget> previousModalWidget(QApplication::activeModalWidget());
    const QPointer<QWindow> previousModalWindow(QGuiApplication::modalWindow());
    QTimer acknowledgement;
    QObject::connect(&acknowledgement, &QTimer::timeout, this, [this, target, id, &accepted, &acknowledgement, previousModalWidget, previousModalWindow] {
        QWidget* widget = QApplication::activeModalWidget();
        QWindow* window = QGuiApplication::modalWindow();
        if ((!widget || widget == previousModalWidget) && (!window || window == previousModalWindow)) return;
        acknowledgement.stop();
        accepted = true;
        reply(target, id, QJsonValue::Null);
        dispatching = false;
        QTimer::singleShot(0, this, [this] { drain(); });
    });
    acknowledgement.start(1);
    const auto finish = [this, &acknowledgement, &accepted, &target, &id](const Failure* failure) {
        acknowledgement.stop();
        --activeMutations;
        if (!accepted) {
            reply(target, id, QJsonValue::Null, failure);
        } else if (failure) {
            acceptedMutationFailed = true;
            if (current(target)) target.socket->abort();
        }
    };
    try { operation(); finish(nullptr); }
    catch (const Failure& failure) { finish(&failure); }
    catch (...) {
        Failure failure("ACTION_MAY_HAVE_COMMITTED", "Qt mutation failed during dispatch");
        finish(&failure);
    }
}

void BridgeServer::dispatch(const QByteArray& line, const ConnectionTarget& target) {
        QJsonParseError parse;
        const QJsonDocument document = QJsonDocument::fromJson(line, &parse);
        QJsonValue id(QJsonValue::Null);
        try {
            if (parse.error != QJsonParseError::NoError || !document.isObject()) throw Failure("INVALID_STATE", "invalid JSON-RPC message");
            const QJsonObject message = document.object();
            id = message.value("id");
            if (message.value("jsonrpc") != "2.0" || (!id.isDouble() || id.toDouble() < 1 || id.toDouble() > 9007199254740991.0 || std::floor(id.toDouble()) != id.toDouble()) || !message.value("method").isString())
                throw Failure("INVALID_STATE", "invalid JSON-RPC envelope");
            if (message.contains("params") && !message.value("params").isObject()) throw Failure("INVALID_STATE", "params must be an object");
            const QString method = message.value("method").toString();
            const QJsonObject params = message.value("params").toObject();
            if (method == "initialize") {
                const QByteArray supplied = params.value("token").toString().toUtf8();
                unsigned int difference = static_cast<unsigned int>(supplied.size() ^ token.size());
                for (int i = 0; i < token.size(); ++i) difference |= static_cast<unsigned char>(token[i]) ^ static_cast<unsigned char>(i < supplied.size() ? supplied[i] : 0);
                if (difference != 0 || params.value("protocolVersion").toInt() != 1) {
                    Failure failure("POLICY_DENIED", "bridge authentication or version rejected");
                    reply(target, id, QJsonValue::Null, &failure);
                    if (current(target)) target.socket->disconnectFromHost();
                    return;
                }
                if (acceptedMutationFailed) {
                    Failure failure("ACTION_MAY_HAVE_COMMITTED", "an accepted Qt mutation failed; restart the application");
                    reply(target, id, QJsonValue::Null, &failure);
                    if (current(target)) target.socket->disconnectFromHost();
                    return;
                }
                authenticated = true;
                reply(target, id, QJsonObject{{"protocolVersion", 1}, {"name", "e2e-qt"}, {"version", "0.1.0"},
                    {"actions", QJsonArray{"tap", "doubleTap", "secondaryTap", "hover", "fill", "clear", "focus", "press", "check", "uncheck", "selectOption", "scrollIntoView", "swipe"}},
                    {"actionability", true}, {"windows", true},
                    {"keyboard", true}, {"screenshots", !surface.hasCustomAdapters()}});
                return;
            }
            if (!current(target) || !authenticated) throw Failure("POLICY_DENIED", "initialize required");
            if (acceptedMutationFailed && method != "shutdown") throw Failure("ACTION_MAY_HAVE_COMMITTED", "an accepted Qt mutation failed; restart the application");
            if (method == "snapshot") {
                QJsonObject capture = surface.snapshot(params.value("pixels").toBool());

                reply(target, id, capture);
            }
            else if (method == "perform") mutation(target, id, [this, &params] { surface.perform(params); });
            else if (method == "actionability") { surface.actionability(params); reply(target, id, QJsonValue::Null); }
            else if (method == "windows") reply(target, id, surface.windows());
            else if (method == "window.activate") {
                const QString windowId = requiredText(params, "id");
                mutation(target, id, [this, &windowId] { surface.activateWindow(windowId); });
            }
            else if (method == "keyboard.type") {
                const QString text = requiredText(params, "text");
                mutation(target, id, [this, &params, &text] { surface.typeFocused(text, params.value("replace").toBool()); });
            }
            else if (method == "keyboard.press") {
                const QString key = requiredText(params, "key");
                mutation(target, id, [this, &key] { surface.pressFocused(key); });
            }
            else if (method == "screenshot") reply(target, id, surface.screenshot());
            else if (method == "shutdown") shutdown(target, id);
            else throw Failure("UNSUPPORTED_CAPABILITY", "method is not supported");
        } catch (const Failure& failure) { reply(target, id, QJsonValue::Null, &failure); }
        catch (const std::exception&) { Failure failure("ENGINE_FAILURE", "Qt bridge operation failed"); reply(target, id, QJsonValue::Null, &failure); }
    }

}
