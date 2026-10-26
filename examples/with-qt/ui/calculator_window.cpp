// SPDX-License-Identifier: MIT
#include <cmath>
#include <QJsonDocument>
#include <QJsonObject>
#include "calculator_window.h"
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QFile>
#include <QFormLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QTimer>
#include <QVBoxLayout>
#include <QWidget>

namespace example {
CalculatorWindow::CalculatorWindow(bool deliberateDefect) : badCalculation_(deliberateDefect) {
    this->setObjectName("calculator-window");
    this->setWindowTitle("C++ project calculator");
    this->resize(580, 480);
    auto* layout = new QVBoxLayout(this);
    auto* title = new QLabel("Import a project, calculate its total, and export the result.");
    title->setWordWrap(true);
    layout->addWidget(title);
    auto* fields = new QFormLayout;
    auto* path = new QLineEdit;
    path->setObjectName("input-path");
    path->setAccessibleName("Input file");
    path->setPlaceholderText("Path to a CSV containing quantity,price");
    fields->addRow("Input file", path);
    auto* quantity = new QLineEdit("3");
    quantity->setObjectName("quantity");
    quantity->setAccessibleName("Quantity");
    fields->addRow("Quantity", quantity);
    auto* price = new QLineEdit("12.5");
    price->setObjectName("unit-price");
    price->setAccessibleName("Unit price");
    fields->addRow("Unit price", price);
    auto* currency = new QComboBox;
    currency->setObjectName("currency");
    currency->setAccessibleName("Currency");
    currency->addItem("USD", "USD");
    currency->addItem("EUR", "EUR");
    fields->addRow("Currency", currency);
    auto* password = new QLineEdit;
    password->setObjectName("password");
    password->setAccessibleName("Project password");
    password->setEchoMode(QLineEdit::Password);
    fields->addRow("Project password", password);
    layout->addLayout(fields);
    auto* import = new QPushButton("Import CSV");
    import->setObjectName("import");
    layout->addWidget(import);
    auto* tax = new QCheckBox("Include 10% tax");
    tax->setObjectName("tax");
    layout->addWidget(tax);
    auto* calculate = new QPushButton("Calculate");
    calculate->setObjectName("calculate");
    layout->addWidget(calculate);
    auto* result = new QLabel("Total: pending");
    result->setObjectName("result");
    layout->addWidget(result);
    auto* output = new QLineEdit;
    output->setObjectName("output-path");
    output->setAccessibleName("Output file");
    output->setPlaceholderText("Path for exported JSON");
    layout->addWidget(output);
    auto* exportButton = new QPushButton("Export JSON");
    exportButton->setObjectName("export");
    layout->addWidget(exportButton);
    auto* status = new QLabel("Ready");
    status->setObjectName("status");
    layout->addWidget(status);
    const auto invalidate = [this, result, status] {
        ++inputRevision_;
        calculation_.reset();
        result->setText("Total: pending");
        status->setText("Ready");
    };
    QObject::connect(quantity, &QLineEdit::textChanged, this, invalidate);
    QObject::connect(price, &QLineEdit::textChanged, this, invalidate);
    QObject::connect(tax, &QCheckBox::toggled, this, invalidate);
    QObject::connect(currency, &QComboBox::currentIndexChanged, this, invalidate);
    QObject::connect(import, &QPushButton::clicked, this, [=] {
        QFile file(path->text());
        if (!file.open(QIODevice::ReadOnly)) { status->setText("Import failed"); return; }
        QList<QByteArray> lines = file.readAll().trimmed().split('\n');
        const QList<QByteArray> values = lines.constLast().trimmed().split(',');
        if (values.size() != 2) { status->setText("Invalid CSV"); return; }
        bool validQuantity = false, validPrice = false;
        const double importedQuantity = values.at(0).toDouble(&validQuantity);
        const double importedPrice = values.at(1).toDouble(&validPrice);
        if (!validQuantity || !validPrice || !std::isfinite(importedQuantity) || !std::isfinite(importedPrice)) { status->setText("Invalid CSV"); return; }
        quantity->setText(QString::fromUtf8(values.at(0)));
        price->setText(QString::fromUtf8(values.at(1)));
        status->setText("Imported");
    });
    QObject::connect(calculate, &QPushButton::clicked, this, [=] {
        calculation_.reset();
        result->setText("Total: pending");
        bool quantityOk = false, priceOk = false;
        const double amount = quantity->text().toDouble(&quantityOk);
        const double unit = price->text().toDouble(&priceOk);
        if (!quantityOk || !priceOk || !std::isfinite(amount) || !std::isfinite(unit) || amount < 0 || unit < 0) { status->setText("Invalid numbers"); return; }
        calculate->setEnabled(false);
        status->setText("Calculating");
        const quint64 revision = inputRevision_;
        const bool includeTax = tax->isChecked();
        const QString selectedCurrency = currency->currentText();
        QTimer::singleShot(80, this, [=] {
            calculate->setEnabled(true);
            if (revision != inputRevision_) { status->setText("Inputs changed; calculate again"); return; }
            const double total = amount * unit * (includeTax ? 1.1 : 1.0) + (badCalculation_ ? 1.0 : 0.0);
            if (!std::isfinite(total)) { status->setText("Invalid numbers"); return; }
            calculation_ = Calculation{total, selectedCurrency};
            result->setText(QString("Total: %1 %2").arg(total, 0, 'f', 2).arg(selectedCurrency));
            status->setText("Calculated");
        });
    });
    QObject::connect(exportButton, &QPushButton::clicked, this, [=] {
        if (!calculation_) { status->setText("No valid calculation"); return; }
        QFile file(output->text());
        if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) { status->setText("Export failed"); return; }
        const QByteArray json = QJsonDocument(QJsonObject{{"total", calculation_->total}, {"currency", calculation_->currency}}).toJson(QJsonDocument::Compact) + '\n';
        if (file.write(json) != json.size()) { status->setText("Export failed"); return; }
        file.close();
        status->setText("Exported");
    });
}
}
