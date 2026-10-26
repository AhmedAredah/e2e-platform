// SPDX-License-Identifier: MIT
#include "../ui/calculator_window.h"
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QTemporaryDir>
#include <QTest>

class CalculatorTests final : public QObject {
    Q_OBJECT
private slots:
    void rejectsUncomputedAndInvalidResults_data() {
        QTest::addColumn<QString>("input");
        QTest::addColumn<bool>("calculate");
        QTest::newRow("before-calculation") << QString("3") << false;
        for (const char* input : {"nan", "inf", "not-a-number", "-1"})
            QTest::newRow(input) << QString::fromLatin1(input) << true;
    }
    void rejectsUncomputedAndInvalidResults() {
        QFETCH(QString, input); QFETCH(bool, calculate);
        example::CalculatorWindow window(false);
        QTemporaryDir directory;
        QVERIFY(directory.isValid());
        const QString output = directory.filePath("result.json");
        window.findChild<QLineEdit*>("output-path")->setText(output);
        window.findChild<QLineEdit*>("quantity")->setText(input);
        if (calculate) {
            window.findChild<QPushButton*>("calculate")->click();
            QCOMPARE(window.findChild<QLabel*>("status")->text(), QString("Invalid numbers"));
        }
        window.findChild<QPushButton*>("export")->click();
        QCOMPARE(window.findChild<QLabel*>("status")->text(), QString("No valid calculation"));
        QVERIFY(!QFile::exists(output));
        QFile existing(output);
        QVERIFY(existing.open(QIODevice::WriteOnly));
        QCOMPARE(existing.write("keep-existing-output"), qint64(20));
        existing.close();
        window.findChild<QPushButton*>("export")->click();
        QVERIFY(existing.open(QIODevice::ReadOnly));
        QCOMPARE(existing.readAll(), QByteArray("keep-existing-output"));
    }
    void editsInvalidateCompletedResults_data() {
        QTest::addColumn<QString>("field");
        QTest::addColumn<double>("expected");
        QTest::addColumn<QString>("currency");
        QTest::newRow("quantity") << QString("quantity") << 87.5 << QString("USD");
        QTest::newRow("price") << QString("unit-price") << 6.0 << QString("USD");
        QTest::newRow("tax") << QString("tax") << 41.25 << QString("USD");
        QTest::newRow("currency") << QString("currency") << 37.5 << QString("EUR");
    }
    void editsInvalidateCompletedResults() {
        QFETCH(QString, field); QFETCH(double, expected); QFETCH(QString, currency);
        example::CalculatorWindow window(false);
        QTemporaryDir directory;
        const QString output = directory.filePath("result.json");
        auto* status = window.findChild<QLabel*>("status");
        auto* calculate = window.findChild<QPushButton*>("calculate");
        auto* exportButton = window.findChild<QPushButton*>("export");
        window.findChild<QLineEdit*>("output-path")->setText(output);
        calculate->click();
        QTRY_COMPARE(status->text(), QString("Calculated"));
        if (field == "tax") window.findChild<QCheckBox*>("tax")->setChecked(true);
        else if (field == "currency") window.findChild<QComboBox*>("currency")->setCurrentIndex(1);
        else window.findChild<QLineEdit*>(field)->setText(field == "quantity" ? "7" : "2");
        exportButton->click();
        QCOMPARE(status->text(), QString("No valid calculation"));
        QVERIFY(!QFile::exists(output));
        calculate->click();
        QTRY_COMPARE(status->text(), QString("Calculated"));
        exportButton->click();
        QCOMPARE(status->text(), QString("Exported"));
        QFile result(output);
        QVERIFY(result.open(QIODevice::ReadOnly));
        const QJsonObject json = QJsonDocument::fromJson(result.readAll()).object();
        QCOMPARE(json.value("total").toDouble(), expected);
        QCOMPARE(json.value("currency").toString(), currency);
    }
    void pendingEditsAndOverflowCannotExport() {
        example::CalculatorWindow window(false);
        QTemporaryDir directory;
        const QString output = directory.filePath("result.json");
        auto* quantity = window.findChild<QLineEdit*>("quantity");
        auto* price = window.findChild<QLineEdit*>("unit-price");
        auto* status = window.findChild<QLabel*>("status");
        auto* calculate = window.findChild<QPushButton*>("calculate");
        auto* exportButton = window.findChild<QPushButton*>("export");
        window.findChild<QLineEdit*>("output-path")->setText(output);
        calculate->click();
        quantity->setText("6");
        exportButton->click();
        QCOMPARE(status->text(), QString("No valid calculation"));
        QTRY_COMPARE(status->text(), QString("Inputs changed; calculate again"));
        exportButton->click();
        QCOMPARE(status->text(), QString("No valid calculation"));
        QVERIFY(!QFile::exists(output));
        quantity->setText("1e308"); price->setText("1e308");
        calculate->click();
        QTRY_COMPARE(status->text(), QString("Invalid numbers"));
        exportButton->click();
        QCOMPARE(status->text(), QString("No valid calculation"));
        QVERIFY(!QFile::exists(output));
    }
};

QTEST_MAIN(CalculatorTests)
#include "calculator_tests.moc"
