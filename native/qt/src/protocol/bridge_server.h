// SPDX-License-Identifier: MIT
#pragma once
#include "../surface.h"
#include <QTcpServer>
#include <QTcpSocket>
#include <functional>
namespace e2e::qt::detail {
/** Authenticated bounded JSON-RPC transport; one client per launched attempt. */
class BridgeServer final : public QObject {
public:
    explicit BridgeServer(QObject* parent);
    bool start();
    QString errorString() const { return error; }
    bool addControlAdapter(std::shared_ptr<ControlAdapter> adapter);
private:
    /** A request owns its connection even while application code runs a nested event loop. */
    struct ConnectionTarget {
        QPointer<QTcpSocket> socket;
        quint64 generation;
    };
    QTcpServer server;
    Surface surface;
    QString error;
    QByteArray token;
    QPointer<QTcpSocket> client;
    QByteArray pending;
    bool authenticated = false;
    bool dispatching = false;
    quint64 generation = 0;
    int activeMutations = 0;
    bool acceptedMutationFailed = false;
    void accept();
    void drain();
    bool current(const ConnectionTarget& target) const;
    void reply(const ConnectionTarget& target, QJsonValue id, const QJsonValue& result, const Failure* failure = nullptr);
    void mutation(const ConnectionTarget& target, const QJsonValue& id, const std::function<void()>& operation);
    void dispatch(const QByteArray& line, const ConnectionTarget& target);
};
}
