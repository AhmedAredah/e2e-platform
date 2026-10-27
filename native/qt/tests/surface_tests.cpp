// SPDX-License-Identifier: MIT
#include "../src/surface.h"
#include "../src/capture_guard.h"
#include <QApplication>
#include <QImage>
#include <QJsonArray>
#include <QLineEdit>
#include <QLabel>
#include <QPainter>
#include <QTest>
#include <functional>
#include <new>
#ifdef E2E_QT_HAS_QUICK
#include <QQmlComponent>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickWindow>
#endif

using namespace e2e::qt::detail;

/** A normal declared application property, rather than a dynamic QObject property. */
class SecretEdit final : public QLineEdit {
    Q_OBJECT
    Q_PROPERTY(bool e2eSecure READ secure WRITE setSecure NOTIFY secureChanged)
public:
    using QLineEdit::QLineEdit;
    bool secure() const { return secure_; }
    void setSecure(bool value) { secure_ = value; emit secureChanged(); }
signals:
    void secureChanged();
private:
    bool secure_ = false;
};

/** Non-notifying mutable markers must stay masked because transient changes are unobservable. */
class QuietSecretEdit final : public QLineEdit {
    Q_OBJECT
    Q_PROPERTY(bool e2eSecure MEMBER secure_)
public:
    using QLineEdit::QLineEdit;
    bool transientDuringPaint = false;
    int transientPaints = 0;
protected:
    void paintEvent(QPaintEvent* event) override {
        if (transientDuringPaint) { secure_ = true; ++transientPaints; }
        QLineEdit::paintEvent(event);
        if (transientDuringPaint) secure_ = false;
    }
private:
    bool secure_ = false;
};

class ConstantPublicEdit final : public QLineEdit {
    Q_OBJECT
    Q_PROPERTY(bool e2eSecure READ secure CONSTANT)
public:
    using QLineEdit::QLineEdit;
    bool secure() const { return false; }
};

class ReadOnlyPublicEdit final : public QLineEdit {
    Q_OBJECT
    Q_PROPERTY(bool e2eSecure READ secure NOTIFY secureChanged)
public:
    using QLineEdit::QLineEdit;
    bool secure() const { return false; }
signals:
    void secureChanged();
};

class RejectingPublicEdit final : public QLineEdit {
    Q_OBJECT
    Q_PROPERTY(bool e2eSecure READ secure WRITE setSecure NOTIFY secureChanged)
public:
    using QLineEdit::QLineEdit;
    bool secure() const { return false; }
    void setSecure(bool) {}
signals:
    void secureChanged();
};

class PaintWindow final : public QWidget {
public:
    std::function<void()> duringPaint;
protected:
    void paintEvent(QPaintEvent* event) override {
        QWidget::paintEvent(event);
        if (duringPaint) duringPaint();
    }
};

namespace {
/** Finds only the test control; secure descendants remain deliberately absent. */
QJsonObject find(const QJsonObject& node, const QString& id) {
    if (node.value("testId") == id) return node;
    for (const QJsonValue& child : node.value("children").toArray()) {
        const QJsonObject result = find(child.toObject(), id);
        if (!result.isEmpty()) return result;
    }
    return {};
}

/** Checks the whole visible mask rectangle, not one conveniently covered pixel. */
bool blackRegion(const QJsonObject& screenshot, const QRectF& region) {
    const QImage image = QImage::fromData(QByteArray::fromBase64(screenshot.value("base64").toString().toLatin1()));
    if (image.isNull() || !screenshot.value("masked").toBool()) return false;
    const qreal scale = screenshot.value("scale").toDouble();
    const QRect bounds = QRectF(region.x() * scale, region.y() * scale,
        region.width() * scale, region.height() * scale).toAlignedRect().intersected(image.rect());
    if (bounds.isEmpty()) return false;
    for (int y = bounds.top(); y <= bounds.bottom(); ++y)
        for (int x = bounds.left(); x <= bounds.right(); ++x)
            if (image.pixelColor(x, y) != QColor(Qt::black)) return false;
    return true;
}

#ifdef E2E_QT_HAS_QUICK
class PolishHook final : public QQuickItem {
public:
    using QQuickItem::QQuickItem;
    std::function<void()> duringPolish;
protected:
    void updatePolish() override { if (duringPolish) duringPolish(); }
};

class ClickItem final : public QQuickItem {
public:
    explicit ClickItem(QQuickItem* parent) : QQuickItem(parent) { setAcceptedMouseButtons(Qt::AllButtons); }
    int presses = 0;
protected:
    void mousePressEvent(QMouseEvent* event) override { ++presses; event->accept(); }
    void mouseReleaseEvent(QMouseEvent* event) override { event->accept(); }
};
#endif
}

class SurfaceTests final : public QObject {
    Q_OBJECT
private slots:
    void securityPropertiesChangedDuringPaint_data() {
        QTest::addColumn<QString>("kind");
        for (const char* kind : {"declared", "declared-no-notify", "echo-mode"})
            QTest::newRow(kind) << QString::fromLatin1(kind);
    }
    void securityPropertiesChangedDuringPaint() {
        QFETCH(QString, kind);
        PaintWindow window;
        window.resize(600, 220);
        QLineEdit* field = kind == "declared" ? static_cast<QLineEdit*>(new SecretEdit(&window))
            : kind == "declared-no-notify" ? static_cast<QLineEdit*>(new QuietSecretEdit(&window)) : new QLineEdit(&window);
        field->setObjectName("secret");
        field->setGeometry(20, 70, 500, 40);
        field->setText("synthetic-capture-secret");
        window.show();
        QApplication::processEvents();
        Surface surface;
        surface.snapshot(false);
        bool armed = true;
        window.duringPaint = [&] {
            if (!armed) return;
            armed = false;
            if (kind == "echo-mode") field->setEchoMode(QLineEdit::Password);
            else field->setProperty("e2eSecure", true);
        };
        const QJsonObject result = surface.snapshot(true);
        QVERIFY(!armed);
        const QJsonObject node = find(result.value("root").toObject(), "secret");
        QVERIFY(node.value("states").toObject().value("secure").toBool());
        QVERIFY(!node.contains("value"));
        QVERIFY(blackRegion(result.value("screenshot").toObject(), QRectF(field->geometry())));
    }
    void revealingPasswordCannotRemoveRedaction() {
        QWidget window;
        window.resize(600, 220);
        QLineEdit field(&window);
        field.setObjectName("secret"); field.setGeometry(20, 70, 500, 40);
        field.setText("synthetic-revealed-secret"); field.setEchoMode(QLineEdit::Password);
        window.show(); QApplication::processEvents();
        Surface surface;
        QVERIFY(find(surface.snapshot(false).value("root").toObject(), "secret").value("states").toObject().value("secure").toBool());
        field.setEchoMode(QLineEdit::Normal);
        const auto result = surface.snapshot(true);
        const auto node = find(result.value("root").toObject(), "secret");
        QVERIFY(node.value("states").toObject().value("secure").toBool());
        QVERIFY(!node.contains("value"));
        QVERIFY(!QJsonDocument(node).toJson().contains("synthetic-revealed-secret"));
        QVERIFY(blackRegion(result.value("screenshot").toObject(), QRectF(field.geometry())));
    }
    void repeatedSecurityChangesFailClosed() {
        PaintWindow window;
        window.resize(600, 220);
        SecretEdit field(&window);
        field.setGeometry(20, 70, 500, 40);
        field.setText("synthetic-capture-secret");
        window.show();
        QApplication::processEvents();
        Surface surface;
        surface.snapshot(false);
        window.duringPaint = [&] { field.setSecure(!field.secure()); };
        try { surface.screenshot(); QFAIL("unstable masking inputs were accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("POLICY_DENIED")); }
    }
    void unobservableSecurityChangesStayMasked() {
        QWidget window;
        window.resize(600, 220);
        QuietSecretEdit field(&window);
        field.setObjectName("secret");
        field.setGeometry(20, 70, 500, 40);
        field.setText("synthetic-capture-secret");
        window.show();
        QApplication::processEvents();
        field.transientDuringPaint = true;
        Surface surface;
        const QJsonObject result = surface.snapshot(true);
        QVERIFY(field.transientPaints > 0);
        QVERIFY(!field.property("e2eSecure").toBool());
        const QJsonObject node = find(result.value("root").toObject(), "secret");
        QVERIFY(node.value("states").toObject().value("secure").toBool());
        QVERIFY(!node.contains("value"));
        QVERIFY(blackRegion(result.value("screenshot").toObject(), QRectF(field.geometry())));
    }
    void constantPublicMarkerRetainsValueSemantics() {
        ConstantPublicEdit field;
        QVERIFY(!secureObject(&field));
    }
    void sensitiveFillIgnoresApplicationMarkerRestrictions_data() {
        QTest::addColumn<QString>("kind");
        for (const char* kind : {"dynamic", "constant", "read-only", "rejecting-setter", "writable"})
            QTest::newRow(kind) << QString::fromLatin1(kind);
    }
    void sensitiveFillIgnoresApplicationMarkerRestrictions() {
        QFETCH(QString, kind);
        QWidget window;
        window.resize(600, 220);
        QLineEdit* field = kind == "constant" ? static_cast<QLineEdit*>(new ConstantPublicEdit(&window))
            : kind == "read-only" ? static_cast<QLineEdit*>(new ReadOnlyPublicEdit(&window))
            : kind == "rejecting-setter" ? static_cast<QLineEdit*>(new RejectingPublicEdit(&window))
            : kind == "writable" ? static_cast<QLineEdit*>(new SecretEdit(&window)) : new QLineEdit(&window);
        field->setObjectName("secret");
        field->setGeometry(20, 70, 500, 40);
        window.show();
        QApplication::processEvents();
        Surface surface;
        const QJsonObject before = find(surface.snapshot(false).value("root").toObject(), "secret");
        QVERIFY(!before.value("states").toObject().value("secure").toBool());
        const QJsonObject ref = before.value("ref").toObject();
        surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "fill"}, {"value", "sensitive-marker-regression"}, {"sensitive", true}}}});
        QCOMPARE(field->text(), QString("sensitive-marker-regression"));
        // An application can change or remove its own marker, but cannot undo
        // the helper's lifetime policy, even after a clear and ordinary refill.
        field->setProperty("e2eSecure", false);
        if (kind == "dynamic") field->setProperty("e2eSecure", QVariant());
        surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "clear"}}}});
        surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "fill"}, {"value", "sensitive-marker-regression"}, {"sensitive", false}}}});
        const QJsonObject result = surface.snapshot(true);
        const QJsonObject node = find(result.value("root").toObject(), "secret");
        QVERIFY(node.value("states").toObject().value("secure").toBool());
        QVERIFY(!node.contains("value"));
        QVERIFY(!node.contains("attributes"));
        QVERIFY(!QJsonDocument(result).toJson().contains("sensitive-marker-regression"));
        QVERIFY(blackRegion(result.value("screenshot").toObject(), QRectF(field->geometry())));
    }
    void sensitiveLifetimeEndsAtObjectDestruction() {
        alignas(QLineEdit) unsigned char storage[sizeof(QLineEdit)];
        auto* first = new (storage) QLineEdit;
        markSensitiveObject(first);
        QVERIFY(secureObject(first));
        first->~QLineEdit();
        auto* replacement = new (storage) QLineEdit;
        QVERIFY(!secureObject(replacement));
        replacement->~QLineEdit();
    }
    void oversizedPublicTextOmitsWholeFields() {
        QWidget window;
        window.resize(600, 220);
        QLabel label(&window);
        label.setObjectName("bounded-label");
        label.setGeometry(20, 70, 500, 40);
        const QString secret = QStringLiteral("STRADDLING-SECRET-NEVER-CLIP");
        label.setAccessibleName(QString(250, 'n') + secret);
        label.setText(QString(MaxText - 8, 't') + secret);
        window.show();
        QApplication::processEvents();
        Surface surface;
        const QJsonObject node = find(surface.snapshot(false).value("root").toObject(), "bounded-label");
        QCOMPARE(node.value("name").toString(), QString("[omitted: text exceeds limit]"));
        QCOMPARE(node.value("text").toString(), QString("[omitted: text exceeds limit]"));
        QVERIFY(!QJsonDocument(node).toJson().contains("STRADDL"));
        label.setAccessibleName("");
        label.setText(QString(250, 'n') + secret);
        const QJsonObject derived = find(surface.snapshot(false).value("root").toObject(), "bounded-label");
        QCOMPARE(derived.value("name").toString(), QString("[omitted: text exceeds limit]"));
        QCOMPARE(derived.value("text").toString(), label.text());
        label.setText(QStringLiteral("SECRET") + QChar::Null + QStringLiteral("SUFFIX"));
        const QJsonObject embeddedNull = find(surface.snapshot(false).value("root").toObject(), "bounded-label");
        QCOMPARE(embeddedNull.value("text").toString(), QString("[omitted: text contains NUL]"));
        QVERIFY(!QJsonDocument(embeddedNull).toJson().contains("SECRET"));
    }
    void portableModifiers_data() {
        QTest::addColumn<bool>("macos");
        QTest::addColumn<bool>("dontSwap");
        QTest::addColumn<QString>("key");
        QTest::addColumn<int>("expected");
        for (int mode = 0; mode < 3; ++mode) {
            const bool macos = mode != 0, dontSwap = mode == 2;
            const auto command = mode == 1 ? Qt::ControlModifier : Qt::MetaModifier;
            const auto control = mode == 1 ? Qt::MetaModifier : Qt::ControlModifier;
            const QString prefix = QString::number(mode) + '-';
            QTest::newRow((prefix + "portable").toLatin1()) << macos << dontSwap << QString("ControlOrMeta+A") << int(macos ? command : control);
            QTest::newRow((prefix + "control").toLatin1()) << macos << dontSwap << QString("Control+A") << int(control);
            QTest::newRow((prefix + "command").toLatin1()) << macos << dontSwap << QString("Command+A") << int(command);
        }
    }
    void portableModifiers() {
        QFETCH(bool, macos); QFETCH(bool, dontSwap); QFETCH(QString, key); QFETCH(int, expected);
        const ParsedKey parsed = parseKey(key, {macos, dontSwap});
        QCOMPARE(int(parsed.modifiers), expected);
        QCOMPARE(parsed.key, Qt::Key_A);
    }
#ifdef E2E_QT_HAS_QUICK
    void secureQuickWindowHidesTitleChildrenAndPixels() {
        QQuickWindow window; window.resize(400, 200);
        window.setTitle("synthetic-window-secret"); window.setProperty("e2eSecure", true);
        QQuickItem label(window.contentItem()); label.setObjectName("private-child"); label.setSize({200,40});
        label.setProperty("text", "synthetic-child-secret");
        window.show(); window.requestActivate(); QApplication::processEvents();
        QVERIFY(QTest::qWaitForWindowExposed(&window)); QTRY_VERIFY(window.isSceneGraphInitialized());
        Surface surface; const auto snapshot = surface.snapshot(true);
        const auto root = snapshot.value("root").toObject();
        QVERIFY(root.value("states").toObject().value("secure").toBool());
        QVERIFY(!root.contains("name")); QVERIFY(!root.contains("children"));
        QVERIFY(!QJsonDocument(snapshot).toJson().contains("synthetic-"));
        QVERIFY(!QJsonDocument(surface.windows()).toJson().contains("synthetic-"));
        QVERIFY(blackRegion(snapshot.value("screenshot").toObject(), QRectF(0,0,400,200)));
    }
    void quickTextBoundsOmitWholeFields() {
        QQuickWindow window;
        window.resize(600, 220);
        QQuickItem label(window.contentItem());
        label.setObjectName("bounded-label"); label.setSize({500, 40});
        const QString secret = QStringLiteral("STRADDLING-SECRET-NEVER-CLIP");
        const QString text = QString(250, 'n') + secret;
        label.setProperty("text", text);
        window.show();
        QApplication::processEvents();
        Surface surface;
        const QJsonObject node = find(surface.snapshot(false).value("root").toObject(), "bounded-label");
        QCOMPARE(node.value("name").toString(), QString("[omitted: text exceeds limit]"));
        QCOMPARE(node.value("text").toString(), text);
        label.setProperty("text", QString(MaxText - 8, 't') + secret);
        const QJsonObject oversized = find(surface.snapshot(false).value("root").toObject(), "bounded-label");
        QCOMPARE(oversized.value("text").toString(), QString("[omitted: text exceeds limit]"));
        QVERIFY(!QJsonDocument(oversized).toJson().contains("STRADDL"));
    }
    void coveredQuickTargetRejectsPointerInput_data() {
        QTest::addColumn<QString>("kind");
        for (const char* kind : {"tap", "doubleTap", "secondaryTap", "hover"})
            QTest::newRow(kind) << QString::fromLatin1(kind);
    }
    void coveredQuickTargetRejectsPointerInput() {
        QFETCH(QString, kind);
        QQuickWindow window;
        window.resize(300, 250);
        ClickItem target(window.contentItem()), covering(window.contentItem());
        target.setObjectName("target");
        for (QQuickItem* item : {&target, &covering}) {
            item->setPosition({40, 40}); item->setSize({180, 80});
        }
        covering.setZ(10);
        window.show();
        QApplication::processEvents();
        Surface surface;
        const QJsonObject ref = find(surface.snapshot(false).value("root").toObject(), "target").value("ref").toObject();
        QVERIFY(!ref.isEmpty());
        try { surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", kind}}}}); QFAIL("covered target accepted pointer input"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        QCOMPARE(target.presses, 0);
        QCOMPARE(covering.presses, 0);
        covering.setVisible(false);
        QQuickItem decoration(&target);
        decoration.setSize(target.size());
        surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "tap"}}}});
        QCOMPARE(target.presses, 1);
        QCOMPARE(covering.presses, 0);
    }
    void quickPointerGrabRejectsAnotherTarget() {
        QQuickWindow window;
        window.resize(300, 250);
        ClickItem target(window.contentItem()), grabber(window.contentItem());
        target.setObjectName("target"); target.setPosition({20, 20}); target.setSize({100, 50});
        grabber.setPosition({160, 20}); grabber.setSize({100, 50});
        window.show();
        QApplication::processEvents();
        Surface surface;
        const QJsonObject ref = find(surface.snapshot(false).value("root").toObject(), "target").value("ref").toObject();
        QTest::mousePress(&window, Qt::LeftButton, Qt::NoModifier, {210, 45});
        QCOMPARE(window.mouseGrabberItem(), &grabber);
        try { surface.perform({{"ref", ref}, {"action", QJsonObject{{"kind", "tap"}}}}); QFAIL("unrelated pointer grab was accepted"); }
        catch (const Failure& failure) { QCOMPARE(failure.code, QString("NOT_ACTIONABLE")); }
        QCOMPARE(target.presses, 0); QCOMPARE(grabber.presses, 1);
        QTest::mouseRelease(&window, Qt::LeftButton, Qt::NoModifier, {210, 45});
    }
    void transformedSecretDuringPolish_data() {
        QTest::addColumn<bool>("transformList");
        QTest::newRow("transform-origin") << false;
        QTest::newRow("transform-list") << true;
    }
    void transformedSecretDuringPolish() {
        QFETCH(bool, transformList);
        QQmlEngine engine;
        QQuickWindow window;
        window.resize(600, 400);
        QQmlComponent component(&engine);
        component.setData(R"(import QtQuick
Item {
    objectName: "secret"; property bool e2eSecure: true
    x: 150; y: 100; width: 250; height: 40; rotation: 30; transformOrigin: Item.TopLeft
    transform: Translate { objectName: "translation"; x: 0 }
    Rectangle { anchors.fill: parent; color: "white" }
    Text { anchors.centerIn: parent; text: "synthetic-capture-secret"; color: "black" }
})", QUrl());
        QQuickItem* secret = qobject_cast<QQuickItem*>(component.create());
        QVERIFY2(secret, qPrintable(component.errorString()));
        secret->setParentItem(window.contentItem());
        secret->setParent(window.contentItem());
        PolishHook hook(window.contentItem());
        window.show();
        QApplication::processEvents();
        Surface surface;
        surface.snapshot(false);
        bool armed = true;
        hook.duringPolish = [&] {
            if (!armed) return;
            armed = false;
            if (transformList) secret->findChild<QObject*>("translation")->setProperty("x", 180);
            else secret->setTransformOrigin(QQuickItem::BottomRight);
        };
        hook.polish();
        const QJsonObject result = surface.snapshot(true);
        QVERIFY(!armed);
        QVERIFY(find(result.value("root").toObject(), "secret").value("states").toObject().value("secure").toBool());
        QVERIFY(blackRegion(result.value("screenshot").toObject(), secret->mapRectToScene(secret->boundingRect())));
    }
    void transientTransformChangesInvalidateCapture() {
        QQuickWindow window;
        QQuickItem item(window.contentItem());
        CaptureGuard guard(&window);
        item.setTransformOrigin(QQuickItem::TopLeft);
        item.setTransformOrigin(QQuickItem::Center);
        QVERIFY(guard.changed());
    }
#endif
};

QTEST_MAIN(SurfaceTests)
#include "surface_tests.moc"
