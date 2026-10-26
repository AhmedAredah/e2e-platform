// SPDX-License-Identifier: MIT
#include <e2e/qt/bridge.h>
#include "ui/calculator_window.h"
#include <QApplication>
int main(int argc, char** argv) {
    QApplication app(argc, argv);
    example::CalculatorWindow window(app.arguments().contains("--bad-calculation"));
    window.show();
    e2e::qt::Bridge bridge;
    if (!qEnvironmentVariableIsEmpty("E2E_NATIVE_TOKEN") && !bridge.start()) return 2;
    return app.exec();
}
