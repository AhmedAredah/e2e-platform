// SPDX-License-Identifier: MIT
#include <e2e/qt/tracked_tabs.h>
#include "../src/surface.h"
#include <QApplication>
#include <QComboBox>
#include <QJsonArray>
#include <QSignalSpy>
#include <QStandardItemModel>
#include <QTest>
#include <QKeyEvent>
#include <QLineEdit>
#include <QTableView>
#include <QHeaderView>
#include <QListView>
#include <QTreeView>
#include <QMenu>
#include <QMenuBar>
#include <QTabBar>
#include <QSlider>
#include <QScrollArea>
#include <QScrollBar>
#include <QDialog>
#include <QWidgetAction>
#include <QJsonDocument>
#include <QThread>
#include <QProcess>
#include <QScopeGuard>
#include <QTimer>
#include <iostream>
#include <stdexcept>

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
QJsonObject find(const QJsonObject& node, const QString& id) {
    if (node.value("testId") == id) return node;
    for (const auto& child : node.value("children").toArray()) {
        const auto result = find(child.toObject(), id);
        if (!result.isEmpty()) return result;
    }
    return {};
}
QJsonObject findText(const QJsonObject& node, const QString& text, const QString& role = {}) {
    if (node.value("name") == text && (role.isEmpty() || node.value("role") == role)) return node;
    for (const auto& child : node.value("children").toArray()) {
        const auto result = findText(child.toObject(), text, role);
        if (!result.isEmpty()) return result;
    }
    return {};
}
QJsonObject action(const QJsonObject& node, QJsonObject command) { return {{"ref", node.value("ref")}, {"action", command}}; }
void expose(QWidget& window) {
    window.show(); window.activateWindow();
    QVERIFY(QTest::qWaitForWindowActive(&window));
}
class ApplicationControlAdapter : public e2e::qt::ControlAdapter {
public:
    QString name() const override { return "application-control"; }
    bool accepts(const QObject& object) const override { return object.objectName()=="custom"; }
    e2e::qt::ControlSnapshot snapshot(const QObject&) const override {
        e2e::qt::ControlSnapshot result; result.role="slider"; result.name="Custom volume"; result.value="42";
        result.text="synthetic-custom-secret"; result.secure=secret; return result;
    }
    QStringList actions() const override { return {"fill","tap"}; }
    bool ready(const QObject&, const QJsonObject&) const override { return available; }
    void perform(QObject& object,const QJsonObject& action) override {
        ++dispatches; onGuiThread=QThread::currentThread()==qApp->thread();
        object.setProperty("received", action.value("value").toString());
        if (fail) throw std::runtime_error("application action failed");
    }
    bool secret=false,available=true,fail=false,onGuiThread=false;
    int dispatches=0;
};
class FutureControlAdapter final : public ApplicationControlAdapter {
public: unsigned int interfaceVersion() const noexcept override { return 2; }
};
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
    void fillingReactivatesBackgroundApplication() {
        if (QGuiApplication::platformName() != "cocoa") QSKIP("Requires a real Cocoa application session");
        QWidget window; window.resize(300, 160);
        QLineEdit input(&window); input.setObjectName("reactivated-input");
        input.setGeometry(20, 20, 240, 30); input.setText("before");
        expose(window);
        QProcess foreground;
        const auto cleanup = qScopeGuard([&] {
            if (foreground.state() != QProcess::NotRunning) {
                foreground.kill(); foreground.waitForFinished(5000);
            }
        });
        foreground.start(QCoreApplication::applicationFilePath(), {"--foreground-fixture"});
        QVERIFY(foreground.waitForStarted(5000));
        QByteArray output;
        QTRY_VERIFY_WITH_TIMEOUT((output += foreground.readAllStandardOutput()).contains("ready\n"), 5000);
        QTRY_VERIFY_WITH_TIMEOUT(QGuiApplication::applicationState() != Qt::ApplicationActive, 5000);
        QVERIFY(!window.isActiveWindow());
        QCOMPARE(foreground.state(), QProcess::Running);
        Surface surface;
        const auto node = find(surface.snapshot(false).value("root").toObject(), "reactivated-input");
        QVERIFY(!node.isEmpty());
        surface.perform(action(node, {{"kind", "fill"}, {"value", "after"}}));
        QCOMPARE(input.text(), QString("after"));
        QVERIFY(window.isActiveWindow());
        QVERIFY(input.hasFocus());
        foreground.kill();
        QVERIFY(foreground.waitForFinished(5000));
    }
    void ordinaryClippingCannotReportSuccessfulScrolling() {
        QWidget window; window.resize(300, 160);
        QWidget clip(&window); clip.setGeometry(0, 0, 100, 80);
        QLineEdit input(&clip); input.setObjectName("clipped-input"); input.setGeometry(0, 200, 80, 30);
        expose(window);
        Surface surface;
        auto node = find(surface.snapshot(false).value("root").toObject(), "clipped-input");
        const auto command = action(node, {{"kind", "scrollIntoView"}});
        for (bool preflight : {true, false}) {
            try { if (preflight) surface.actionability(command); else surface.perform(command); QFAIL("unsupported clipped widget acknowledged"); }
            catch (const Failure& error) { QCOMPARE(error.code, QString("UNSUPPORTED_CAPABILITY")); }
            QCOMPARE(input.y(), 200);
        }
        input.move(0, 0);
        node = find(surface.snapshot(false).value("root").toObject(), "clipped-input");
        surface.perform(action(node, {{"kind", "scrollIntoView"}}));
        QCOMPARE(input.pos(), QPoint(0, 0));
    }
    void publicAdaptersAreVersionedRetainedAndDispatchedOnce() {
        QWidget window; window.resize(320,180); QWidget custom(&window); custom.setObjectName("custom"); custom.setGeometry(10,10,180,50);
        QLineEdit child(&custom); child.setText("private-child"); expose(window);
        std::weak_ptr<ApplicationControlAdapter> lifetime;
        {
            Surface surface; QString error;
            QVERIFY(!surface.addControlAdapter(std::make_shared<FutureControlAdapter>(),error));
            auto adapter=std::make_shared<ApplicationControlAdapter>(); lifetime=adapter;
            QVERIFY(surface.addControlAdapter(adapter,error)); QVERIFY(!surface.addControlAdapter(adapter,error));
            auto node=find(surface.snapshot(false).value("root").toObject(),"custom");
            QCOMPARE(node.value("role").toString(),QString("slider")); QCOMPARE(node.value("name").toString(),QString("Custom volume")); QVERIFY(!node.contains("children"));
            adapter->available=false;
            try { surface.perform(action(node,{{"kind","fill"},{"value","7"}})); QFAIL("unready adapter executed"); } catch(const Failure& failure) { QCOMPARE(failure.code,QString("NOT_ACTIONABLE")); }
            QCOMPARE(adapter->dispatches,0); adapter->available=true;
            surface.perform(action(node,{{"kind","fill"},{"value","7"}})); QCOMPARE(custom.property("received").toString(),QString("7")); QVERIFY(adapter->onGuiThread);
            try { surface.perform(action(node,{{"kind","press"},{"key","Space"}})); QFAIL("undeclared action executed"); } catch(const Failure& failure) { QCOMPARE(failure.code,QString("UNSUPPORTED_CAPABILITY")); }
            QCOMPARE(adapter->dispatches,1); adapter->fail=true;
            try { surface.perform(action(node,{{"kind","tap"}})); QFAIL("partial adapter failure accepted"); } catch(const Failure& failure) { QCOMPARE(failure.code,QString("ACTION_MAY_HAVE_COMMITTED")); }
            QCOMPARE(adapter->dispatches,2); adapter->secret=true;
            const auto tree=surface.snapshot(false).value("root").toObject();
            QVERIFY(!QJsonDocument(tree).toJson().contains("synthetic-custom-secret")); QVERIFY(find(tree,"custom").value("states").toObject().value("secure").toBool());
            try { surface.screenshot(); QFAIL("custom adapter screenshot masking assumed"); } catch(const Failure& failure) { QCOMPARE(failure.code,QString("UNSUPPORTED_CAPABILITY")); }
            adapter.reset(); QVERIFY(!lifetime.expired());
        }
        QVERIFY(lifetime.expired());
    }
    void redirectedFocusStopsBeforeFurtherInput_data() {
        QTest::addColumn<bool>("duringInput"); QTest::addColumn<QString>("text");
        QTest::newRow("focus-ascii") << false << QString("secret");
        QTest::newRow("focus-unicode") << false << QString::fromUtf8("秘密");
        QTest::newRow("ascii-next") << true << QString("secret");
        QTest::newRow("unicode-next") << true << QString::fromUtf8("a秘密");
        QTest::newRow("unicode-first") << true << QString::fromUtf8("ésecret");
    }
    void redirectedFocusStopsBeforeFurtherInput() {
        QFETCH(bool, duringInput); QFETCH(QString, text);
        QWidget window; window.resize(400, 150);
        QLineEdit target(&window), other(&window);
        target.setObjectName("target"); target.setGeometry(10,10,180,40); other.setGeometry(10,60,180,40);
        expose(window); other.setFocus();
        if (duringInput) QObject::connect(&target, &QLineEdit::textChanged, &window, [&](const QString& value) { if (!value.isEmpty()) other.setFocus(); });
        else QObject::connect(qApp, &QApplication::focusChanged, &window, [&](QWidget*, QWidget* now) { if (now == &target) other.setFocus(); });
        KeyReleaseCapture releases; other.installEventFilter(&releases);
        Surface surface;
        const auto node = find(surface.snapshot(false).value("root").toObject(), "target");
        try { surface.perform(action(node, {{"kind", "fill"}, {"value", text}, {"sensitive", true}})); QFAIL("redirect accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("ACTION_MAY_HAVE_COMMITTED")); }
        QCOMPARE(other.text(), QString());
        QCOMPARE(releases.text, QString());
    }
    void modelItemsAreActionableAndKeepIdentityWhenRowsMove() {
        QTableView table; table.resize(420, 230);
        QStandardItemModel model(2,2); model.setItem(0,0,new QStandardItem("Alpha")); model.setItem(0,1,new QStandardItem("Beta"));
        table.setModel(&model); expose(table); Surface surface;
        auto node = findText(surface.snapshot(false).value("root").toObject(), "Alpha", "cell"); QVERIFY(!node.isEmpty());
        const auto ref = node.value("ref");
        surface.perform(action(node, {{"kind", "tap"}})); QCOMPARE(table.currentIndex(), model.index(0,0));
        model.insertRow(0, {new QStandardItem("Before"), new QStandardItem("Before-two")});
        node = findText(surface.snapshot(false).value("root").toObject(), "Alpha", "cell"); QCOMPARE(node.value("ref"), ref);
        surface.perform(action(node, {{"kind", "tap"}})); QCOMPARE(table.currentIndex(), model.index(1,0));
        model.removeRow(1);
        try { surface.perform(action(node, {{"kind", "tap"}})); QFAIL("removed index acted on"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NODE_STALE")); }
    }
    void modelCheckUsesTheDelegateInputPathAndDisabledItemsRefuseInput() {
        QListView list; list.resize(400,180); QStandardItemModel model;
        auto* item = new QStandardItem("Choice"); item->setCheckable(true); model.appendRow(item); list.setModel(&model); expose(list);
        Surface surface; auto node = findText(surface.snapshot(false).value("root").toObject(), "Choice", "option");
        surface.perform(action(node, {{"kind","check"}})); QCOMPARE(item->checkState(), Qt::Checked);
        surface.perform(action(node, {{"kind","uncheck"}})); QCOMPARE(item->checkState(), Qt::Unchecked);
        item->setEnabled(false);
        try { surface.perform(action(node, {{"kind","tap"}})); QFAIL("disabled item clicked"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
    }
    void treeExpansionAndOffscreenModelScrolling() {
        QTreeView tree; tree.resize(400,180); QStandardItemModel model;
        auto* parent = new QStandardItem("Parent"); parent->appendRow(new QStandardItem("Nested")); model.appendRow(parent);
        for (int row=0; row<40; ++row) model.appendRow(new QStandardItem(QString("Row-%1").arg(row)));
        tree.setModel(&model); expose(tree); Surface surface;
        auto snapshot = surface.snapshot(false).value("root").toObject();
        auto parentNode = findText(snapshot,"Parent","treeitem");
        QVERIFY(findText(snapshot,"Nested","treeitem").value("states").toObject().value("hidden").toBool());
        surface.perform(action(parentNode, {{"kind","press"},{"key","ArrowRight"}})); QVERIFY(tree.isExpanded(model.index(0,0)));
        auto last = findText(surface.snapshot(false).value("root").toObject(),"Row-39","treeitem");
        try { surface.perform(action(last,{{"kind","tap"}})); QFAIL("offscreen item clicked"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        surface.perform(action(last,{{"kind","scrollIntoView"}})); surface.perform(action(last,{{"kind","tap"}}));
        QCOMPARE(tree.currentIndex().data().toString(),QString("Row-39"));
    }
    void wheelScrollingUsesTheViewportEventPath() {
        QListView list; list.resize(320,180); QStandardItemModel model;
        for (int row=0; row<100; ++row) model.appendRow(new QStandardItem(QString::number(row)));
        list.setModel(&model); expose(list); Surface surface;
        const auto root=surface.snapshot(false).value("root").toObject();
        surface.perform(action(root,{{"kind","swipe"},{"direction","down"}})); QVERIFY(list.verticalScrollBar()->value()>0);
        try { surface.perform(action(root,{{"kind","swipe"},{"direction","down"},{"momentum","high"}})); QFAIL("momentum silently accepted"); }
        catch(const Failure& failure) { QCOMPARE(failure.code,QString("UNSUPPORTED_CAPABILITY")); }
    }
    void tabsMenusAndAccessibleValues() {
        QWidget window; window.resize(440,240); e2e::qt::TrackedTabBar tabs(&window); tabs.setGeometry(10,10,350,35); tabs.addTab("First"); tabs.addTab("Second");
        QSlider slider(Qt::Horizontal,&window); slider.setGeometry(10,65,300,30); slider.setObjectName("volume"); slider.setValue(37);
        expose(window); Surface surface; auto snapshot = surface.snapshot(false).value("root").toObject();
        auto second = findText(snapshot,"Second","tab"); QVERIFY(!second.isEmpty());
        surface.perform(action(second,{{"kind","tap"}})); QCOMPARE(tabs.currentIndex(),1);
        QCOMPARE(find(snapshot,"volume").value("role").toString(),QString("slider"));
        QCOMPARE(find(snapshot,"volume").value("value").toString(),QString("37"));
        tabs.insertTab(0,"Inserted");
        try { surface.perform(action(second,{{"kind","tap"}})); QFAIL("changed tabs kept old identity"); }
        catch (const Failure& failure) { QCOMPARE(failure.code,QString("NODE_STALE")); }
        QMenu menu; auto* choice = menu.addAction("Menu choice"); choice->setCheckable(true);
        menu.popup(window.mapToGlobal(QPoint(30,100))); QApplication::processEvents();
        auto menuNode = findText(surface.snapshot(false).value("root").toObject(),"Menu choice","menuitemcheckbox"); QVERIFY(!menuNode.isEmpty());
        surface.perform(action(menuNode,{{"kind","check"}})); QVERIFY(choice->isChecked());
    }
    void removedAndRecreatedTabCannotReuseAnOldReference() {
        e2e::qt::TrackedTabBar tabs; tabs.resize(350,40); tabs.addTab("First"); tabs.addTab("Second"); expose(tabs);
        Surface surface; auto old = findText(surface.snapshot(false).value("root").toObject(),"Second","tab");
        tabs.removeTab(1); tabs.addTab("Second");
        try { surface.perform(action(old,{{"kind","tap"}})); QFAIL("replacement accepted old reference"); }
        catch(const Failure& failure) { QCOMPARE(failure.code,QString("NODE_STALE")); }
        auto current = findText(surface.snapshot(false).value("root").toObject(),"Second","tab");
        QVERIFY(current.value("ref") != old.value("ref")); surface.perform(action(current,{{"kind","tap"}})); QCOMPARE(tabs.currentIndex(),1);
    }
    void untrackedTabsRefuseMutationWithAnExplicitCapabilityError() {
        QTabBar tabs; tabs.resize(350,40); tabs.addTab("First"); tabs.addTab("Second"); expose(tabs);
        Surface surface; const auto tab = findText(surface.snapshot(false).value("root").toObject(),"Second","tab");
        try { surface.perform(action(tab,{{"kind","tap"}})); QFAIL("untracked tab mutation accepted"); }
        catch(const Failure& failure) { QCOMPARE(failure.code,QString("UNSUPPORTED_CAPABILITY")); }
        QCOMPARE(tabs.currentIndex(),0);
    }
    void offscreenHeaderScrollingDoesNotAcknowledgeANoOp() {
        QTableView table; QStandardItemModel model(2,10); model.setHeaderData(9,Qt::Horizontal,"Last header");
        table.setModel(&model); table.resize(300,150); expose(table); Surface surface;
        auto header = findText(surface.snapshot(false).value("root").toObject(),"Last header","columnheader"); QVERIFY(!header.isEmpty());
        const auto before=table.horizontalScrollBar()->value();
        try { surface.perform(action(header,{{"kind","scrollIntoView"}})); QFAIL("unsupported header scrolling acknowledged"); }
        catch(const Failure& failure) { QCOMPARE(failure.code,QString("UNSUPPORTED_CAPABILITY")); }
        QCOMPARE(table.horizontalScrollBar()->value(),before);
    }
    void preflightWaitsForTheRequestedOptionWithoutInput() {
        WidgetFixture fixture; QSignalSpy selected(&fixture.combo,&QComboBox::currentIndexChanged);
        const auto params=QJsonObject{{"ref",fixture.ref},{"action",QJsonObject{{"kind","selectOption"},{"value","Later"}}}};
        try { fixture.surface.actionability(params); QFAIL("missing option ready"); }
        catch(const Failure& failure) { QCOMPARE(failure.code,QString("NOT_ACTIONABLE")); }
        fixture.combo.addItem("Later");
        try { fixture.surface.actionability(params); } catch(const Failure& failure) { QCOMPARE(failure.code,QString("NOT_ACTIONABLE")); }
        QTest::qWait(60); fixture.surface.actionability(params); QCOMPARE(selected.count(),0);
        fixture.surface.perform(params); QCOMPARE(fixture.combo.currentText(),QString("Later")); QCOMPARE(selected.count(),3);
    }
    void preflightWaitsForStableGeometryAndNeverMutates() {
        WidgetFixture fixture; auto params = action(find(fixture.surface.snapshot(false).value("root").toObject(),"combo"),{{"kind","tap"}});
        const auto pending = [&] { try { fixture.surface.actionability(params); return false; } catch (const Failure& error) { return error.code == "NOT_ACTIONABLE"; } };
        QVERIFY(pending()); QTest::qWait(60); fixture.surface.actionability(params);
        fixture.combo.move(30,30); QVERIFY(pending()); fixture.combo.setEnabled(false); QTest::qWait(60); QVERIFY(pending());
        fixture.combo.setEnabled(true); fixture.surface.actionability(params); QCOMPARE(fixture.combo.currentIndex(),0);
    }
    void windowHandlesAreStableAndModalActivationIsGuarded() {
        QWidget first, second; first.resize(200,120); second.resize(200,120); first.setWindowTitle("First"); second.setWindowTitle("Second");
        expose(first); Surface surface; const auto firstRoot = surface.snapshot(false).value("root").toObject().value("ref"); expose(second);
        QString firstId; for(const auto& entry:surface.windows()) if(entry.toObject().value("title")=="First") firstId=entry.toObject().value("id").toString();
        QVERIFY(!firstId.isEmpty()); surface.activateWindow(firstId);
        QCOMPARE(QApplication::activeWindow(), &first);
        QCOMPARE(surface.snapshot(false).value("root").toObject().value("ref"),firstRoot);
        expose(second); QVERIFY(surface.snapshot(false).value("root").toObject().value("ref") != firstRoot);
        QDialog modal(&second); modal.setWindowModality(Qt::ApplicationModal); expose(modal);
        try { surface.activateWindow(firstId); QFAIL("activated blocked window"); } catch(const Failure& failure) { QCOMPARE(failure.code,QString("NOT_ACTIONABLE")); }
    }
    void secureMenuActionsDoNotLeakTreeOrPixels() {
        QMenu menu; auto* secret=menu.addAction("synthetic-menu-secret"); secret->setProperty("e2eSecure",true);
        auto* customAction=new QWidgetAction(&menu); auto* editor=new QLineEdit("synthetic-custom-action-secret");
        customAction->setDefaultWidget(editor); customAction->setProperty("e2eSecure",true); menu.addAction(customAction);
        menu.popup(QPoint(40,40)); QApplication::processEvents(); Surface surface;
        const auto snapshot=surface.snapshot(true); QVERIFY(!QJsonDocument(snapshot.value("root").toObject()).toJson().contains("synthetic-menu-secret"));
        QVERIFY(!QJsonDocument(snapshot.value("root").toObject()).toJson().contains("synthetic-custom-action-secret"));
        QVERIFY(snapshot.value("screenshot").toObject().value("maskedRegionCount").toInt()>0);
    }
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
int main(int argc, char** argv) {
    QApplication app(argc, argv);
    app.setAttribute(Qt::AA_Use96Dpi, true);
    if (app.arguments().contains("--foreground-fixture")) {
        QWidget window; window.resize(200, 120); window.show(); window.raise(); window.activateWindow();
        QTimer ready;
        QObject::connect(&ready, &QTimer::timeout, &app, [&] {
            if (window.isActiveWindow() && QGuiApplication::applicationState() == Qt::ApplicationActive) {
                std::cout << "ready\n" << std::flush; ready.stop();
            }
        });
        ready.start(10);
        QTimer::singleShot(15000, &app, &QApplication::quit);
        return app.exec();
    }
    WidgetsControlsTests tests;
    return QTest::qExec(&tests, argc, argv);
}
#include "widgets_controls_tests.moc"
