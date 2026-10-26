// SPDX-License-Identifier: MIT
#include <e2e/qt/bridge.h>
#include <QCoreApplication>
int main(int argc, char** argv) {
    QCoreApplication app(argc, argv);
    qunsetenv("E2E_NATIVE_TOKEN");
    e2e::qt::Bridge bridge;
    return bridge.start() ? 1 : 0;
}
