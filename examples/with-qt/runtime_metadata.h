// SPDX-License-Identifier: MIT
#pragma once
#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSysInfo>
#include <iostream>

/** Reports the QPA plugin actually loaded, rather than inferring it from configuration. */
inline bool printRuntimeMetadataIfRequested(const QGuiApplication& app) {
    if (!app.arguments().contains("--describe-runtime")) return false;
    const QJsonObject runtime{{"qt", qVersion()}, {"compiledQt", QT_VERSION_STR},
                             {"platform", QGuiApplication::platformName()},
                             {"architecture", QSysInfo::currentCpuArchitecture()}};
    std::cout << QJsonDocument(runtime).toJson(QJsonDocument::Compact).constData() << std::endl;
    return true;
}
