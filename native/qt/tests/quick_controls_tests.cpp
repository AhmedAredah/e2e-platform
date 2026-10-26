// SPDX-License-Identifier: MIT
#include "../src/surface.h"
#include <QApplication>
#include <QComboBox>
#include <QJsonArray>
#include <QQmlComponent>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickWindow>
#include <QSignalSpy>
#include <QTest>

using namespace e2e::qt::detail;

namespace {
QJsonObject find(const QJsonObject& node, const QString& testId) {
    if (node.value("testId") == testId) return node;
    for (const auto& child : node.value("children").toArray()) {
        const auto result = find(child.toObject(), testId);
        if (!result.isEmpty()) return result;
    }
    return {};
}

/** Real Qt Quick Controls fixture, using the installed QML runtime. */
class QuickFixture final {
public:
    explicit QuickFixture(const QByteArray& properties = {}) : component(&engine) {
        window.resize(480, 240);
        component.setData("import QtQuick\nimport QtQuick.Controls\nComboBox { objectName: 'combo'; x: 20; y: 20; width: 220; height: 40; " + properties + " }", QUrl());
        control = qobject_cast<QQuickItem*>(component.create());
        if (!control) return;
        control->setParent(window.contentItem());
        control->setParentItem(window.contentItem());
        window.show();
        window.requestActivate();
        QApplication::processEvents();
        refresh();
    }
    void refresh() { ref = find(surface.snapshot(false).value("root").toObject(), "combo").value("ref").toObject(); }
    void select(const QJsonValue& option) { surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "selectOption"}, {"value", option}}}}); }
    QQmlEngine engine;
    QQuickWindow window;
    QQmlComponent component;
    QPointer<QQuickItem> control;
    Surface surface;
    QJsonObject ref;
};
}

class QuickControlsTests final : public QObject {
    Q_OBJECT
private slots:
    void redirectedFocusCannotReceiveSensitiveInput_data() {
        QTest::addColumn<bool>("duringInput");
        QTest::newRow("during-focus") << false;
        QTest::newRow("during-typing") << true;
    }
    void redirectedFocusCannotReceiveSensitiveInput() {
        QFETCH(bool, duringInput);
        QQmlEngine engine;
        QQuickWindow window;
        window.resize(480, 240);
        QQmlComponent component(&engine);
        const QByteArray redirect = duringInput
            ? "onTextChanged: if (text.length === 1) other.forceActiveFocus()"
            : "onActiveFocusChanged: if (activeFocus) other.forceActiveFocus()";
        component.setData("import QtQuick\nimport QtQuick.Controls\nItem { width: 480; height: 240; TextField { objectName: 'target'; width: 200; height: 40; " + redirect + " } TextField { id: other; objectName: 'other'; y: 60; width: 200; height: 40 } }", QUrl());
        auto* root = qobject_cast<QQuickItem*>(component.create());
        QVERIFY2(root, qPrintable(component.errorString()));
        root->setParent(window.contentItem()); root->setParentItem(window.contentItem());
        window.show(); window.requestActivate(); QApplication::processEvents();
        Surface surface;
        const auto ref = find(surface.snapshot(false).value("root").toObject(), "target").value("ref").toObject();
        try { surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "fill"}, {"value", "synthetic-secret"}, {"sensitive", true}}}}); QFAIL("redirected focus accepted sensitive input"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("ACTION_MAY_HAVE_COMMITTED")); }
        QCOMPARE(root->findChild<QObject*>("other")->property("text").toString(), QString());
    }
    void selectsPublicModelOptions_data() {
        QTest::addColumn<QJsonValue>("option");
        QTest::newRow("label-string") << QJsonValue("Three");
        QTest::newRow("label-object") << QJsonValue(QJsonObject{{"label", "Three"}});
        QTest::newRow("value-role") << QJsonValue(QJsonObject{{"value", "three"}});
        QTest::newRow("index") << QJsonValue(QJsonObject{{"index", 2}});
    }
    void selectsPublicModelOptions() {
        QFETCH(QJsonValue, option);
        QuickFixture fixture("textRole: 'label'; valueRole: 'key'; model: [{label: 'One', key: 'one'}, {label: 'Two', key: 'two'}, {label: 'Three', key: 'three'}]");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        QSignalSpy activated(fixture.control, SIGNAL(activated(int)));
        QVERIFY(activated.isValid());
        fixture.select(option);
        QCOMPARE(fixture.control->property("currentIndex").toInt(), 2);
        QCOMPARE(fixture.control->property("currentText").toString(), QString("Three"));
        QCOMPARE(fixture.control->property("currentValue").toString(), QString("three"));
        QVERIFY(activated.count() >= 1);
        QCOMPARE(activated.last().at(0).toInt(), 2);
        const auto node = find(fixture.surface.snapshot(false).value("root").toObject(), "combo");
        QCOMPARE(node.value("role").toString(), QString("combobox"));
        QCOMPARE(node.value("value").toString(), QString("Three"));
        const int signalCount = activated.count();
        fixture.select(option);
        QCOMPARE(activated.count(), signalCount);
        fixture.select(QJsonObject{{"index", 0}});
        QCOMPARE(fixture.control->property("currentIndex").toInt(), 0);
    }
    void rejectsInvalidSelectionBeforeInput_data() {
        QTest::addColumn<QJsonValue>("option");
        for (const auto& pair : QList<QPair<const char*, QJsonValue>>{
            {"absent", "Missing"}, {"negative", QJsonObject{{"index", -1}}},
            {"fractional", QJsonObject{{"index", 0.5}}}, {"out-of-bounds", QJsonObject{{"index", 2}}},
            {"wrong-type", QJsonObject{{"index", "1"}}}, {"number-value", QJsonObject{{"value", 1}}},
            {"extra-selector", QJsonObject{{"index", 0}, {"label", "Two"}}}, {"null", QJsonValue()}})
            QTest::newRow(pair.first) << pair.second;
    }
    void rejectsInvalidSelectionBeforeInput() {
        QFETCH(QJsonValue, option);
        QuickFixture fixture("model: ['One', 'Two']");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        QSignalSpy activated(fixture.control, SIGNAL(activated(int)));
        try { fixture.select(option); QFAIL("invalid selector accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        QCOMPARE(activated.count(), 0);
        QCOMPARE(fixture.control->property("currentIndex").toInt(), 0);
    }
    void rejectsAmbiguousLabel() {
        QuickFixture fixture("model: ['Same', 'Same']");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        try { fixture.select("Same"); QFAIL("ambiguous label accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        fixture.select(QJsonObject{{"index", 1}});
        QCOMPARE(fixture.control->property("currentIndex").toInt(), 1);
    }
    void rejectsDisabledHiddenAndDeletedControl_data() {
        QTest::addColumn<QString>("state");
        QTest::newRow("disabled") << QString("enabled");
        QTest::newRow("hidden") << QString("visible");
        QTest::newRow("deleted") << QString("deleted");
    }
    void rejectsDisabledHiddenAndDeletedControl() {
        QFETCH(QString, state);
        QuickFixture fixture("model: ['One', 'Two']");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        if (state == "deleted") delete fixture.control.data();
        else fixture.control->setProperty(state.toLatin1(), false);
        try { fixture.select("Two"); QFAIL("unavailable control accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, state == "deleted" ? QString("NODE_STALE") : QString("NOT_ACTIONABLE")); }
    }
    void secureComboDoesNotDiscloseSelection() {
        QuickFixture fixture("property bool e2eSecure: true; model: ['public', 'synthetic-secret-selection']");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        fixture.select(QJsonObject{{"index", 1}});
        const auto node = find(fixture.surface.snapshot(false).value("root").toObject(), "combo");
        QVERIFY(node.value("states").toObject().value("secure").toBool());
        QVERIFY(!node.contains("value"));
        QVERIFY(!node.contains("text"));
        QVERIFY(!node.contains("children"));
        QVERIFY(!QJsonDocument(node).toJson().contains("synthetic-secret"));
    }
    void reportsMutationUncertaintyWhenApplicationRejectsSelection() {
        QuickFixture fixture("model: ['One', 'Two']; onActivated: function(index) { if (index === 1) currentIndex = 0 }");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        try { fixture.select("Two"); QFAIL("application rejected selection was reported successful"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("ACTION_MAY_HAVE_COMMITTED")); }
    }
    void rejectsEditableControls() {
        QuickFixture fixture("model: ['One', 'Two']; editable: true");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        try { fixture.select("Two"); QFAIL("editable combobox silently accepted unsupported navigation"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("UNSUPPORTED_CAPABILITY")); }
    }
    void rejectsOpenPopupBeforeInput() {
        QuickFixture fixture("model: ['One', 'Two']");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        QObject* popup = fixture.control->property("popup").value<QObject*>();
        QVERIFY(popup);
        QVERIFY(QMetaObject::invokeMethod(popup, "open", Qt::DirectConnection));
        QApplication::processEvents();
        QVERIFY(popup->property("visible").toBool());
        QSignalSpy activated(fixture.control, SIGNAL(activated(int)));
        try { fixture.select("Two"); QFAIL("open popup accepted closed-popup navigation"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        QCOMPARE(activated.count(), 0);
    }
    void modelReplacementCannotReportWrongOptionAsSuccess() {
        QuickFixture fixture("model: ['One', 'Two']; onActivated: function(index) { if (index === 1) { model = ['Other', 'Changed']; currentIndex = 1 } }");
        QVERIFY2(fixture.control, qPrintable(fixture.component.errorString()));
        try { fixture.select("Two"); QFAIL("changed model was reported as requested option"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("ACTION_MAY_HAVE_COMMITTED")); }
    }
    void widgetSelectionRetainsSignalsAndDisabledGuard() {
        QWidget window;
        window.resize(480, 240);
        QComboBox combo(&window);
        combo.setObjectName("combo"); combo.setGeometry(20, 20, 220, 40);
        combo.addItem("One", "one"); combo.addItem("Two", "two");
        window.show(); window.activateWindow(); QApplication::processEvents();
        Surface surface;
        const auto ref = find(surface.snapshot(false).value("root").toObject(), "combo").value("ref").toObject();
        QSignalSpy activated(&combo, &QComboBox::activated);
        surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "selectOption"}, {"value", QJsonObject{{"value", "two"}}}}}});
        QCOMPARE(combo.currentIndex(), 1); QVERIFY(activated.count() > 0);
        combo.setEnabled(false);
        try { surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "selectOption"}, {"value", "One"}}}}); QFAIL("disabled widget accepted input"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        QCOMPARE(combo.currentIndex(), 1);
    }
};

QTEST_MAIN(QuickControlsTests)
#include "quick_controls_tests.moc"
