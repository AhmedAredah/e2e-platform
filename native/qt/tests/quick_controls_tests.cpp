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
#include <QKeyEvent>

using namespace e2e::qt::detail;

namespace {
class KeyReleaseCapture final : public QObject {
public:
    QString text;
    bool eventFilter(QObject*, QEvent* event) override {
        if (event->type()==QEvent::KeyRelease) text += static_cast<QKeyEvent*>(event)->text();
        return false;
    }
};
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
    void optionPreflightWaitsWithoutChangingSelection() {
        QuickFixture fixture("model: ['One']"); QVERIFY(fixture.control);
        const auto params=QJsonObject{{"ref",fixture.ref},{"action",QJsonObject{{"kind","selectOption"},{"value","Later"}}}};
        try { fixture.surface.actionability(params); QFAIL("missing Quick option ready"); }
        catch(const Failure& failure) { QCOMPARE(failure.code,QString("NOT_ACTIONABLE")); }
        fixture.control->setProperty("model",QStringList{"One","Later"});
        try { fixture.surface.actionability(params); } catch(const Failure& failure) { QCOMPARE(failure.code,QString("NOT_ACTIONABLE")); }
        QTest::qWait(60); fixture.surface.actionability(params); QCOMPARE(fixture.control->property("currentIndex").toInt(),0);
        fixture.surface.perform(params); QCOMPARE(fixture.control->property("currentIndex").toInt(),1);
    }
    void accessibleRolesAndFlickableScrollingUsePublicQtInterfaces() {
        QQmlEngine engine; QQuickWindow window; window.resize(400,200); QQmlComponent component(&engine);
        component.setData("import QtQuick\nimport QtQuick.Controls\nFlickable { objectName: 'scroller'; width:400; height:200; contentWidth:400; contentHeight:900; clip:true; Rectangle { objectName:'semantic'; width:80; height:40; Accessible.role: Accessible.Slider; Accessible.name:'Volume' } Button { objectName:'late'; x:10; y:700; width:120; height:40; text:'Late' } }",QUrl());
        auto* root=qobject_cast<QQuickItem*>(component.create()); QVERIFY2(root,qPrintable(component.errorString()));
        root->setParent(window.contentItem()); root->setParentItem(window.contentItem()); window.show(); window.requestActivate(); QApplication::processEvents();
        QVERIFY(QTest::qWaitForWindowExposed(&window));
        QTRY_VERIFY(window.isSceneGraphInitialized());
        Surface surface; auto tree=surface.snapshot(false).value("root").toObject();
        QCOMPARE(find(tree,"semantic").value("role").toString(),QString("slider"));
        const auto late=find(tree,"late").value("ref");
        try { surface.perform({{"ref",late},{"action",QJsonObject{{"kind","tap"}}}}); QFAIL("clipped Quick control clicked"); }
        catch(const Failure& failure) { QCOMPARE(failure.code,QString("NOT_ACTIONABLE")); }
        surface.perform({{"ref",late},{"action",QJsonObject{{"kind","scrollIntoView"}}}});
        QVERIFY(root->property("contentY").toDouble()>500); surface.perform({{"ref",late},{"action",QJsonObject{{"kind","tap"}}}});
        const double before=root->property("contentY").toDouble();
        surface.perform({{"ref",find(tree,"scroller").value("ref")},{"action",QJsonObject{{"kind","swipe"},{"direction","up"}}}});
        QTRY_VERIFY(root->property("contentY").toDouble()<before);
    }
    void redirectedFocusCannotReceiveSensitiveInput_data() {
        QTest::addColumn<bool>("duringInput");
        QTest::addColumn<QString>("text");
        QTest::newRow("during-focus") << false << QString("synthetic-secret");
        QTest::newRow("during-typing") << true << QString("synthetic-secret");
        QTest::newRow("unicode-after-focus") << false << QString::fromUtf8("秘密");
        QTest::newRow("unicode-after-ascii") << true << QString::fromUtf8("a秘密");
        QTest::newRow("ascii-after-unicode") << true << QString::fromUtf8("ésecret");
    }
    void redirectedFocusCannotReceiveSensitiveInput() {
        QFETCH(bool, duringInput);
        QFETCH(QString, text);
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
        KeyReleaseCapture releases; root->findChild<QObject*>("other")->installEventFilter(&releases);
        Surface surface;
        const auto ref = find(surface.snapshot(false).value("root").toObject(), "target").value("ref").toObject();
        try { surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "fill"}, {"value", text}, {"sensitive", true}}}}); QFAIL("redirected focus accepted sensitive input"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("ACTION_MAY_HAVE_COMMITTED")); }
        QCOMPARE(root->findChild<QObject*>("other")->property("text").toString(), QString());
        QCOMPARE(releases.text, QString());
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
