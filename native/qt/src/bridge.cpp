// SPDX-License-Identifier: MIT
#include <e2e/qt/bridge.h>
#include "protocol/bridge_server.h"
#include <QCoreApplication>
#include <QThread>
namespace e2e::qt {
class Bridge::Impl final {
public:
    explicit Impl(Bridge* owner) : server(owner) {}
    detail::BridgeServer server;
};
Bridge::Bridge(QObject* parent) : QObject(parent), impl_(std::make_unique<Impl>(this)) {}
Bridge::~Bridge() = default;
bool Bridge::start() {
    if (!QCoreApplication::instance() || QThread::currentThread() != QCoreApplication::instance()->thread()) return false;
    return impl_->server.start();
}
QString Bridge::errorString() const { return impl_->server.errorString(); }
bool Bridge::registerControlAdapter(std::shared_ptr<ControlAdapter> adapter) {
    if (!QCoreApplication::instance() || QThread::currentThread() != QCoreApplication::instance()->thread() || thread() != QThread::currentThread()) return false;
    return impl_->server.addControlAdapter(std::move(adapter));
}
}
