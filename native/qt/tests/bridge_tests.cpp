// SPDX-License-Identifier: MIT
#include <e2e/qt/bridge.h>
#include <QApplication>
#include <QCheckBox>
#include <QComboBox>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QEvent>
#include <QDialog>
#include <QLineEdit>
#include <QProcess>
#include <QPushButton>
#include <QTcpSocket>
#include <QTest>
#include <QVBoxLayout>
#include <QTimer>
#include <QPaintEvent>
#ifdef E2E_QT_HAS_QUICK
#include <QQuickWindow>
#include <QQuickItem>
#endif

namespace {
const QString Token = "test-token-0123456789-abcdef";
class CountKeyPresses final : public QObject {
public:
    explicit CountKeyPresses(QLabel* label, QObject* parent) : QObject(parent), label_(label) {}
    bool eventFilter(QObject*, QEvent* event) override {
        if (event->type() == QEvent::KeyPress) label_->setText(QString::number(++count_));
        return false;
    }
private:
    QLabel* label_;
    int count_ = 0;
};
QJsonObject find(const QJsonObject& node, const QString& id) {
    if (node.value("testId") == id) return node;
    for (const QJsonValue& child : node.value("children").toArray()) {
        const QJsonObject value = find(child.toObject(), id);
        if (!value.isEmpty()) return value;
    }
    return {};
}

void blockingDialog(QWidget* parent) {
    QDialog dialog(parent); dialog.setObjectName("modal-dialog"); dialog.setWindowTitle("Blocking modal");
    QVBoxLayout dialogLayout(&dialog);
    QPushButton close("Close"); close.setObjectName("close-modal"); dialogLayout.addWidget(&close);
    QObject::connect(&close, &QPushButton::clicked, &dialog, &QDialog::accept);
    dialog.exec();
}

class PaintRevealWindow final : public QWidget {
public:
    QLineEdit secret{"synthetic-secret-during-grab", this};
    bool armed = false;
    PaintRevealWindow() {
        secret.setProperty("e2eSecure", true);
        secret.setGeometry(20, 20, 300, 30);
        secret.hide();
    }
protected:
    void paintEvent(QPaintEvent* event) override {
        QWidget::paintEvent(event);
        if (armed && secret.isHidden()) { armed = false; secret.show(); }
    }
};
int fixture(QApplication& app) {
    PaintRevealWindow window;
    window.setWindowTitle("Bridge fixture");
    window.setObjectName("fixture");
    window.resize(420, 380);
    QVBoxLayout layout(&window);
    QLineEdit input("initial"); input.setObjectName("input"); input.setAccessibleName("Input"); layout.addWidget(&input);
    QLineEdit secret("never-observe-this-value"); secret.setObjectName("secret"); secret.setAccessibleName("Password"); secret.setEchoMode(QLineEdit::Password); layout.addWidget(&secret);
    QLineEdit readOnly("fixed"); readOnly.setObjectName("readonly"); readOnly.setReadOnly(true); layout.addWidget(&readOnly);
    QCheckBox checkbox("Include tax"); checkbox.setObjectName("check"); layout.addWidget(&checkbox);
    QComboBox combo; combo.setObjectName("combo"); combo.addItem("One", "one"); combo.addItem("Two", "two"); layout.addWidget(&combo);
    QPushButton disabled("Disabled"); disabled.setObjectName("disabled"); disabled.setEnabled(false); layout.addWidget(&disabled);
    auto* victim = new QPushButton("Victim"); victim->setObjectName("victim"); layout.addWidget(victim);
    QPushButton remove("Remove"); remove.setObjectName("remove"); layout.addWidget(&remove);
    QObject::connect(&remove, &QPushButton::clicked, &window, [victim] { victim->deleteLater(); });
    auto* doomed = new QLineEdit("doomed"); doomed->setObjectName("destroy-on-focus"); layout.addWidget(doomed);
    QObject::connect(&app, &QApplication::focusChanged, &window, [doomed](QWidget*, QWidget* now) { if (now == doomed) doomed->deleteLater(); });
    auto* doomedCombo = new QComboBox; doomedCombo->setObjectName("destroy-on-select"); doomedCombo->addItems({"One", "Two"}); layout.addWidget(doomedCombo);
    QObject::connect(doomedCombo, &QComboBox::currentIndexChanged, &window, [doomedCombo] { doomedCombo->deleteLater(); });
    QLabel counter("0"); counter.setObjectName("key-counter"); layout.addWidget(&counter);
    input.installEventFilter(new CountKeyPresses(&counter, &window));
    QPushButton modal("Open modal"); modal.setObjectName("open-modal"); modal.setDefault(true); layout.addWidget(&modal);
    QObject::connect(&modal, &QPushButton::clicked, &window, [&window] { blockingDialog(&window); });
    QPushButton lateFailure("Late failure"); lateFailure.setObjectName("late-failure"); lateFailure.setCheckable(true); layout.addWidget(&lateFailure);
    QObject::connect(&lateFailure, &QPushButton::clicked, &window, [&window, &lateFailure] { blockingDialog(&window); lateFailure.setChecked(false); });
    QLabel clicks("0"); clicks.setObjectName("click-count"); layout.addWidget(&clicks);
    QPushButton count("Count"); count.setObjectName("count"); layout.addWidget(&count);
    int clickCount = 0;
    QObject::connect(&count, &QPushButton::clicked, &window, [&] { clicks.setText(QString::number(++clickCount)); });
    QPushButton arm("Arm capture"); arm.setObjectName("arm-capture"); layout.addWidget(&arm);
    QObject::connect(&arm, &QPushButton::clicked, &window, [&] { window.armed = true; });
#ifdef E2E_QT_HAS_QUICK
    QQuickWindow quick;
    quick.setObjectName("quick-modal"); quick.resize(300, 200); quick.setModality(Qt::ApplicationModal);
    QPushButton showQuick("Quick modal"); showQuick.setObjectName("show-quick"); layout.addWidget(&showQuick);
    QObject::connect(&showQuick, &QPushButton::clicked, &window, [&] { quick.show(); quick.requestActivate(); });
#endif
    window.show();
    e2e::qt::Bridge bridge;
    if (!bridge.start()) return 3;
    return app.exec();
}
}

class BridgeTests : public QObject {
    Q_OBJECT
    QProcess process;
    QTcpSocket socket;
    int sequence = 0;
    quint16 port_ = 0;
    QByteArray buffer;

    QJsonObject rpc(const QString& method, const QJsonObject& params = {}) {
        QJsonObject request{{"jsonrpc", "2.0"}, {"id", ++sequence}, {"method", method}, {"params", params}};
        socket.write(QJsonDocument(request).toJson(QJsonDocument::Compact) + '\n');
        socket.waitForBytesWritten(3000);
        while (!buffer.contains('\n')) {
            if (!socket.waitForReadyRead(5000)) return {};
            buffer += socket.readAll();
        }
        const qsizetype end = buffer.indexOf('\n');
        const QByteArray line = buffer.left(end);
        buffer.remove(0, end + 1);
        const QJsonObject response = QJsonDocument::fromJson(line).object();
        return response.value("id").toInt(-1) == sequence ? response : QJsonObject{};
    }
    QJsonObject capture() { return rpc("snapshot").value("result").toObject(); }
    QJsonObject action(const QJsonObject& node, const QJsonObject& value) {
        return rpc("perform", {{"ref", node.value("ref")}, {"action", value}});
    }
    bool login() {
        return rpc("initialize", {{"protocolVersion", 1}, {"token", Token}}).value("result").toObject().value("protocolVersion") == 1;
    }
private slots:
    void init() {
        buffer.clear();
        sequence = 0;
        QProcessEnvironment environment = QProcessEnvironment::systemEnvironment();
        environment.insert("E2E_NATIVE_TOKEN", Token);
        environment.insert("E2E_NATIVE_PORT", "0");
        environment.insert("QT_QPA_PLATFORM", "offscreen");
        process.setProcessEnvironment(environment);
        process.start(QCoreApplication::applicationFilePath(), {"--fixture"});
        QVERIFY(process.waitForStarted(5000));
        QByteArray output;
        while (!output.contains('\n')) {
            QVERIFY2(process.waitForReadyRead(5000), process.readAllStandardError().constData());
            output += process.readAllStandardOutput();
        }
        QVERIFY(output.startsWith("E2E_NATIVE_READY "));
        port_ = static_cast<quint16>(QJsonDocument::fromJson(output.mid(17).trimmed()).object().value("port").toInt());
        QVERIFY(port_ != 0);
        socket.connectToHost(QHostAddress::LocalHost, port_);
        QVERIFY(socket.waitForConnected(5000));
    }
    void cleanup() {
        socket.abort();
        process.kill();
        process.waitForFinished(5000);
    }
    void requiresAuthentication() {
        QCOMPARE(rpc("snapshot").value("error").toObject().value("data").toObject().value("code").toString(), QString("POLICY_DENIED"));
        QVERIFY(login());
    }
    void rejectsWrongToken() {
        QCOMPARE(rpc("initialize", {{"protocolVersion", 1}, {"token", "wrong"}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("POLICY_DENIED"));
    }
    void stableIdsAndMaskedPixels() {
        QVERIFY(login());
        QJsonObject first = rpc("snapshot", {{"pixels", true}}).value("result").toObject();
        const QJsonObject root = first.value("root").toObject();
        QCOMPARE(root.value("ref").toObject().value("id").toString(), QString("root"));
        const QJsonObject secret = find(root, "secret");
        QVERIFY(!secret.isEmpty());
        QVERIFY(secret.value("states").toObject().value("secure").toBool());
        QVERIFY(!secret.contains("value")); QVERIFY(!secret.contains("text")); QVERIFY(!secret.contains("attributes"));
        QVERIFY(!QJsonDocument(first).toJson().contains("never-observe-this-value"));
        const QJsonObject pixels = first.value("screenshot").toObject();
        QVERIFY(pixels.value("masked").toBool());
        QVERIFY(pixels.value("maskedRegionCount").toInt() >= 1);
        QImage image = QImage::fromData(QByteArray::fromBase64(pixels.value("base64").toString().toLatin1()), "PNG");
        QVERIFY(!image.isNull());
        const QJsonObject box = secret.value("rect").toObject();
        const qreal scale = pixels.value("scale").toDouble(1);
        const int x = int((box.value("x").toDouble() + box.value("width").toDouble() / 2) * scale);
        const int y = int((box.value("y").toDouble() + box.value("height").toDouble() / 2) * scale);
        QCOMPARE(image.pixelColor(x, y), QColor(Qt::black));
        QCOMPARE(find(capture().value("root").toObject(), "input").value("ref"), find(root, "input").value("ref"));
    }
    void unicodeTypingAndClearing() {
        QVERIFY(login());
        const QJsonObject input = find(capture().value("root").toObject(), "input");
        QVERIFY(action(input, {{"kind", "fill"}, {"value", QString::fromUtf8("مرحبا café")}, {"sensitive", false}}).contains("result"));
        QCOMPARE(find(capture().value("root").toObject(), "input").value("value").toString(), QString::fromUtf8("مرحبا café"));
        QVERIFY(action(input, {{"kind", "clear"}}).contains("result"));
        QCOMPARE(find(capture().value("root").toObject(), "input").value("value").toString(), QString());
        QVERIFY(rpc("keyboard.type", {{"text", "replacement"}, {"replace", true}}).contains("result"));
        QCOMPARE(find(capture().value("root").toObject(), "input").value("value").toString(), QString("replacement"));
    }
    void pressPreservesCharacterAndPortableGrammar() {
        QVERIFY(login());
        const QJsonObject input = find(capture().value("root").toObject(), "input");
        QVERIFY(action(input, {{"kind", "clear"}}).contains("result"));
        for (const QString& key : {QString("a"), QString("z"), QString("~"), QString("+"), QString("Shift++")})
            QVERIFY(rpc("keyboard.press", {{"key", key}}).contains("result"));
        QCOMPARE(find(capture().value("root").toObject(), "input").value("value").toString(), QString("az~++"));
        QVERIFY(rpc("keyboard.press", {{"key", "ControlOrMeta+A"}}).contains("result"));
        QVERIFY(rpc("keyboard.press", {{"key", "Backspace"}}).contains("result"));
        QCOMPARE(find(capture().value("root").toObject(), "input").value("value").toString(), QString());
        QVERIFY(rpc("keyboard.press", {{"key", "Insert"}}).contains("result"));
    }
    void doubleTapIsTwoClicks() {
        QVERIFY(login());
        const QJsonObject button = find(capture().value("root").toObject(), "count");
        QVERIFY(action(button, {{"kind", "doubleTap"}}).contains("result"));
        QCOMPARE(find(capture().value("root").toObject(), "click-count").value("text").toString(), QString("2"));
    }
    void captureRefusesVisibilityMutationDuringPaint() {
        QVERIFY(login());
        QVERIFY(action(find(capture().value("root").toObject(), "arm-capture"), {{"kind", "tap"}}).contains("result"));
        const QJsonObject response = rpc("screenshot");
        // The field may already have been repainted before this request. Either
        // a refusal or a fully masked frame is acceptable; disclosure is not.
        if (response.contains("error")) {
            QCOMPARE(response.value("error").toObject().value("data").toObject().value("code").toString(), QString("POLICY_DENIED"));
        } else {
            const QJsonObject pixels = response.value("result").toObject();
            const QImage image = QImage::fromData(QByteArray::fromBase64(pixels.value("base64").toString().toLatin1()));
            QVERIFY(!image.isNull());
            const qreal scale = pixels.value("scale").toDouble(1);
            QCOMPARE(image.pixelColor(int(100 * scale), int(30 * scale)), QColor(Qt::black));
        }
    }
#ifdef E2E_QT_HAS_QUICK
    void mixedQuickModalTakesPriority() {
        QVERIFY(login());
        const QJsonObject before = capture().value("root").toObject();
        QVERIFY(action(find(before, "show-quick"), {{"kind", "tap"}}).contains("result"));
        QTRY_COMPARE(capture().value("root").toObject().value("testId").toString(), QString("quick-modal"));
        QCOMPARE(action(find(before, "count"), {{"kind", "tap"}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("NODE_STALE"));
    }
#endif
    void sensitiveFillRemainsRedacted() {
        QVERIFY(login());
        const QJsonObject input = find(capture().value("root").toObject(), "input");
        QVERIFY(action(input, {{"kind", "fill"}, {"value", "sensitive-project-value"}, {"sensitive", true}}).contains("result"));
        const QJsonObject after = capture();
        const QJsonObject node = find(after.value("root").toObject(), "input");
        QVERIFY(node.value("states").toObject().value("secure").toBool());
        QVERIFY(!node.contains("value")); QVERIFY(!node.contains("text")); QVERIFY(!node.contains("attributes"));
        QVERIFY(!QJsonDocument(after).toJson().contains("sensitive-project-value"));
    }
    void keyTypingUsesKeyEvents() {
        QVERIFY(login());
        const QJsonObject input = find(capture().value("root").toObject(), "input");
        QVERIFY(action(input, {{"kind", "focus"}}).contains("result"));
        QVERIFY(rpc("keyboard.type", {{"text", "abc"}, {"replace", false}}).contains("result"));
        QCOMPARE(find(capture().value("root").toObject(), "key-counter").value("text").toString(), QString("3"));
    }
    void destroyedDuringFocusAndSelectionDoesNotCrash() {
        QVERIFY(login());
        const QJsonObject tree = capture().value("root").toObject();
        const QJsonObject doomed = find(tree, "destroy-on-focus");
        QVERIFY(action(doomed, {{"kind", "fill"}, {"value", "new"}}).contains("result"));
        QVERIFY(action(find(tree, "destroy-on-select"), {{"kind", "selectOption"}, {"value", "Two"}}).contains("result"));
        QTRY_VERIFY(find(capture().value("root").toObject(), "destroy-on-focus").isEmpty());
        QTRY_VERIFY(find(capture().value("root").toObject(), "destroy-on-select").isEmpty());
        QCOMPARE(action(doomed, {{"kind", "fill"}, {"value", "new"}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("NODE_STALE"));
        QVERIFY(capture().contains("root"));
    }
    void checkAndSelectThroughInput() {
        QVERIFY(login());
        const QJsonObject tree = capture().value("root").toObject();
        const QJsonObject check = find(tree, "check");
        QVERIFY(action(check, {{"kind", "check"}}).contains("result"));
        QVERIFY(action(check, {{"kind", "check"}}).contains("result"));
        QVERIFY(find(capture().value("root").toObject(), "check").value("states").toObject().value("checked").toBool());
        QVERIFY(action(check, {{"kind", "uncheck"}}).contains("result"));
        QVERIFY(!find(capture().value("root").toObject(), "check").value("states").toObject().value("checked").toBool());
        QVERIFY(action(find(tree, "combo"), {{"kind", "selectOption"}, {"value", QJsonObject{{"label", "Two"}}}}).contains("result"));
        QCOMPARE(find(capture().value("root").toObject(), "combo").value("value").toString(), QString("Two"));
    }
    void selectionRejectsUnsafeIndices() {
        QVERIFY(login());
        const QJsonObject combo = find(capture().value("root").toObject(), "combo");
        for (double index : {1e300, -1.0, 0.5}) {
            QCOMPARE(action(combo, {{"kind", "selectOption"}, {"value", QJsonObject{{"index", index}}}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("NOT_ACTIONABLE"));
        }
        QCOMPARE(find(capture().value("root").toObject(), "combo").value("value").toString(), QString("One"));
    }
    void blockingModalRemainsControllable_data() {
        QTest::addColumn<bool>("keyboard");
        QTest::newRow("pointer") << false;
        QTest::newRow("keyboard-enter") << true;
    }
    void blockingModalRemainsControllable() {
        QFETCH(bool, keyboard);
        QVERIFY(login());
        const QJsonObject opener = find(capture().value("root").toObject(), "open-modal");
        if (keyboard) {
            QVERIFY(action(opener, {{"kind", "focus"}}).contains("result"));
            QVERIFY(rpc("keyboard.press", {{"key", "Enter"}}).contains("result"));
        } else QVERIFY(action(opener, {{"kind", "tap"}}).contains("result"));
        QJsonObject dialog;
        QTRY_VERIFY(!(dialog = find(capture().value("root").toObject(), "modal-dialog")).isEmpty());
        QVERIFY(action(find(dialog, "close-modal"), {{"kind", "tap"}}).contains("result"));
        QTRY_COMPARE(capture().value("root").toObject().value("testId").toString(), QString("fixture"));
    }
    void lateAcceptedFailure_data() {
        QTest::addColumn<bool>("reconnectBeforeClosing");
        QTest::newRow("late-failure-aborts-original") << false;
        QTest::newRow("late-failure-does-not-reply-to-new-generation") << true;
    }
    void lateAcceptedFailure() {
        QFETCH(bool, reconnectBeforeClosing);
        QVERIFY(login());
        const QJsonObject target = find(capture().value("root").toObject(), "late-failure");
        QVERIFY(action(target, {{"kind", "check"}}).contains("result"));
        if (reconnectBeforeClosing) {
            socket.abort(); buffer.clear(); QTest::qWait(20);
            socket.connectToHost(QHostAddress::LocalHost, port_);
            QVERIFY(socket.waitForConnected(5000));
            QVERIFY(login());
        }
        QJsonObject dialog;
        QTRY_VERIFY(!(dialog = find(capture().value("root").toObject(), "modal-dialog")).isEmpty());
        const QJsonObject closeReply = action(find(dialog, "close-modal"), {{"kind", "tap"}});
        if (reconnectBeforeClosing) {
            QVERIFY(closeReply.contains("result"));
            QCOMPARE(rpc("snapshot").value("error").toObject().value("data").toObject().value("code").toString(), QString("ACTION_MAY_HAVE_COMMITTED"));
            QCOMPARE(socket.state(), QAbstractSocket::ConnectedState);
        } else {
            if (socket.state() != QAbstractSocket::UnconnectedState) QVERIFY(socket.waitForDisconnected(5000));
            buffer.clear();
            socket.connectToHost(QHostAddress::LocalHost, port_);
            QVERIFY(socket.waitForConnected(5000));
            QCOMPARE(rpc("initialize", {{"protocolVersion", 1}, {"token", Token}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("ACTION_MAY_HAVE_COMMITTED"));
        }
    }
    void rejectsDisabledReadonlyAndUnknownMethods() {
        QVERIFY(login());
        const QJsonObject tree = capture().value("root").toObject();
        QCOMPARE(action(find(tree, "disabled"), {{"kind", "tap"}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("NOT_ACTIONABLE"));
        QCOMPARE(action(find(tree, "readonly"), {{"kind", "fill"}, {"value", "bad"}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("NOT_ACTIONABLE"));
        QCOMPARE(rpc("invoke", {{"method", "deleteAll"}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("UNSUPPORTED_CAPABILITY"));
    }
    void rejectsDestroyedReferences() {
        QVERIFY(login());
        const QJsonObject tree = capture().value("root").toObject();
        const QJsonObject victim = find(tree, "victim");
        QVERIFY(action(find(tree, "remove"), {{"kind", "tap"}}).contains("result"));
        QTest::qWait(20);
        capture();
        QCOMPARE(action(victim, {{"kind", "tap"}}).value("error").toObject().value("data").toObject().value("code").toString(), QString("NODE_STALE"));
    }
    void rejectsOversizedFrames() {
        QVERIFY(login());
        socket.write(QByteArray(1024 * 1024 + 2, 'x'));
        socket.waitForBytesWritten(5000);
        if (socket.state() != QAbstractSocket::UnconnectedState) QVERIFY(socket.waitForDisconnected(5000));
        QCOMPARE(socket.state(), QAbstractSocket::UnconnectedState);
    }
};

int main(int argc, char** argv) {
    if (qEnvironmentVariableIsSet("E2E_QT_TEST_NO_SWAP"))
        QCoreApplication::setAttribute(Qt::AA_MacDontSwapCtrlAndMeta);
    QApplication app(argc, argv);
    if (app.arguments().contains("--fixture")) return fixture(app);
    BridgeTests tests;
    return QTest::qExec(&tests, argc, argv);
}
#include "bridge_tests.moc"
