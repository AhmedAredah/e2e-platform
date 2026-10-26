// SPDX-License-Identifier: MIT
#include "../src/surface.h"
#include <QApplication>
#include <QComboBox>
#include <QJsonArray>
#include <QSignalSpy>
#include <QStandardItemModel>
#include <QTest>

using namespace e2e::qt::detail;
namespace {
QJsonObject find(const QJsonObject& node, const QString& id) {
    if (node.value("testId") == id) return node;
    for (const auto& child : node.value("children").toArray()) {
        const auto result = find(child.toObject(), id);
        if (!result.isEmpty()) return result;
    }
    return {};
}
class WidgetFixture final {
public:
    WidgetFixture() : combo(&window) {
        window.resize(480, 240);
        combo.setObjectName("combo"); combo.setGeometry(20, 20, 220, 40);
        combo.addItem("One", "one"); combo.addItem("Two", "two"); combo.addItem("Three", "three");
        window.show(); window.activateWindow(); QApplication::processEvents();
        ref = find(surface.snapshot(false).value("root").toObject(), "combo").value("ref").toObject();
    }
    void select(const QJsonValue& value) { surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "selectOption"}, {"value", value}}}}); }
    QWidget window;
    QComboBox combo;
    Surface surface;
    QJsonObject ref;
};
}
class WidgetsControlsTests final : public QObject {
    Q_OBJECT
private slots:
    void selectsExactOptionsThroughInput_data() {
        QTest::addColumn<QJsonValue>("option");
        QTest::newRow("string") << QJsonValue("Three");
        QTest::newRow("label") << QJsonValue(QJsonObject{{"label", "Three"}});
        QTest::newRow("value") << QJsonValue(QJsonObject{{"value", "three"}});
        QTest::newRow("index") << QJsonValue(QJsonObject{{"index", 2}});
    }
    void selectsExactOptionsThroughInput() {
        QFETCH(QJsonValue, option);
        WidgetFixture fixture;
        QSignalSpy activated(&fixture.combo, &QComboBox::activated);
        fixture.select(option);
        QCOMPARE(fixture.combo.currentIndex(), 2);
        QVERIFY(activated.count() >= 1);
        QCOMPARE(activated.last().at(0).toInt(), 2);
        const auto before = activated.count();
        fixture.select(option);
        QCOMPARE(activated.count(), before);
    }
    void rejectsInvalidOptionsBeforeMutation_data() {
        QTest::addColumn<QJsonValue>("option");
        for (const auto& pair : QList<QPair<const char*, QJsonValue>>{
            {"missing", "Missing"}, {"negative", QJsonObject{{"index", -1}}},
            {"fraction", QJsonObject{{"index", 0.5}}}, {"bounds", QJsonObject{{"index", 3}}},
            {"wrong-type", QJsonObject{{"index", "1"}}}, {"numeric-value", QJsonObject{{"value", 1}}},
            {"extra-selector", QJsonObject{{"index", 0}, {"label", "Two"}}}, {"null", QJsonValue()}})
            QTest::newRow(pair.first) << pair.second;
    }
    void rejectsInvalidOptionsBeforeMutation() {
        QFETCH(QJsonValue, option);
        WidgetFixture fixture;
        QSignalSpy activated(&fixture.combo, &QComboBox::activated);
        try { fixture.select(option); QFAIL("invalid selection accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        QCOMPARE(activated.count(), 0);
    }
    void rejectsAmbiguousOptions_data() {
        QTest::addColumn<bool>("value");
        QTest::newRow("label") << false;
        QTest::newRow("value") << true;
    }
    void rejectsAmbiguousOptions() {
        QFETCH(bool, value);
        WidgetFixture fixture;
        fixture.combo.addItem("Two", "two");
        try { fixture.select(value ? QJsonValue(QJsonObject{{"value", "two"}}) : QJsonValue("Two")); QFAIL("ambiguous selection accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        fixture.select(QJsonObject{{"index", 3}});
        QCOMPARE(fixture.combo.currentIndex(), 3);
    }
    void disabledOptionsAreNotSelectedOrCountedAsNavigationSteps() {
        WidgetFixture fixture;
        auto* model = qobject_cast<QStandardItemModel*>(fixture.combo.model());
        QVERIFY(model);
        model->item(1)->setEnabled(false);
        QSignalSpy activated(&fixture.combo, &QComboBox::activated);
        try { fixture.select("Two"); QFAIL("disabled option accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        QCOMPARE(activated.count(), 0);
        fixture.select("Three");
        QCOMPARE(fixture.combo.currentIndex(), 2);
    }
    void editableControlIsRefused() {
        WidgetFixture fixture;
        fixture.combo.setEditable(true);
        try { fixture.select("Two"); QFAIL("editable control accepted unsupported navigation"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("UNSUPPORTED_CAPABILITY")); }
        QCOMPARE(fixture.combo.currentIndex(), 0);
    }
    void changedModelDoesNotReportWrongOptionAsSuccess() {
        WidgetFixture fixture;
        QObject::connect(&fixture.combo, &QComboBox::activated, &fixture.combo, [&](int row) {
            if (row == 1) fixture.combo.setItemText(2, "Changed");
        });
        try { fixture.select("Three"); QFAIL("changed option accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("ACTION_MAY_HAVE_COMMITTED")); }
        QCOMPARE(fixture.combo.currentIndex(), 1);
    }
    void rejectedNavigationStopsBeforeAnotherInput() {
        WidgetFixture fixture;
        QObject::connect(&fixture.combo, &QComboBox::activated, &fixture.combo, [&](int row) {
            if (row == 1) fixture.combo.setCurrentIndex(0);
        });
        try { fixture.select("Three"); QFAIL("rejected navigation accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("ACTION_MAY_HAVE_COMMITTED")); }
        QCOMPARE(fixture.combo.currentIndex(), 0);
    }
};
QTEST_MAIN(WidgetsControlsTests)
#include "widgets_controls_tests.moc"
