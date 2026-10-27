// SPDX-License-Identifier: MIT
#include <e2e/qt/bridge.h>
#include <e2e/qt/control_adapter.h>
#include <QApplication>
#include <e2e/qt/tracked_tabs.h>
#include <memory>
#include <thread>

class ConsumerAdapter final : public e2e::qt::ControlAdapter {
public:
    explicit ConsumerAdapter(QString name = QStringLiteral("external-consumer")) : name_(std::move(name)) {}
    QString name() const override { return name_; }
    bool accepts(const QObject&) const override { return false; }
    e2e::qt::ControlSnapshot snapshot(const QObject&) const override { return {}; }
    QStringList actions() const override { return {"tap"}; }
    bool ready(const QObject&, const QJsonObject&) const override { return true; }
    void perform(QObject&, const QJsonObject&) override {}
private:
    QString name_;
};
int main(int argc, char** argv) {
    QApplication app(argc, argv);
    e2e::qt::TrackedTabWidget tabs; tabs.addTab(new QWidget, "First");
    e2e::qt::TrackedTabBar bar; bar.addTab("First");
    if (bar.generation() == 0) return 6;
    qunsetenv("E2E_NATIVE_TOKEN");
    e2e::qt::Bridge bridge;
    auto adapter = std::make_shared<ConsumerAdapter>();
    if (!bridge.registerControlAdapter(adapter)) return 1;
    if (bridge.registerControlAdapter(adapter)) return 2;
    bool acceptedFromWorker = true;
    auto workerAdapter = std::make_shared<ConsumerAdapter>("worker-adapter");
    std::thread worker([&] { acceptedFromWorker = bridge.registerControlAdapter(workerAdapter); });
    worker.join();
    if (acceptedFromWorker) return 3;
    if (bridge.start()) return 4;
    qputenv("E2E_NATIVE_TOKEN", "consumer-test-token-123456");
    if (!bridge.start()) return 5;
    if (bridge.registerControlAdapter(std::make_shared<ConsumerAdapter>("late-adapter"))) return 6;
    return 0;
}
