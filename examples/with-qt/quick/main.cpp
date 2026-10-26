// SPDX-License-Identifier: MIT
#include <e2e/qt/bridge.h>
#include <QApplication>
#include <QCoreApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QUrl>

int main(int argc, char** argv) {
    QApplication app(argc, argv);
    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("badCalculation", app.arguments().contains("--bad-calculation"));
    engine.load(QUrl::fromLocalFile(QCoreApplication::applicationDirPath() + "/Main.qml"));
    if (engine.rootObjects().isEmpty()) return 2;
    e2e::qt::Bridge bridge;
    if (!qEnvironmentVariableIsEmpty("E2E_NATIVE_TOKEN") && !bridge.start()) return 2;
    return app.exec();
}
