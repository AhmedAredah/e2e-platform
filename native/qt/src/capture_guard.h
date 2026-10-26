// SPDX-License-Identifier: MIT
#pragma once
#include <QObject>
#include <QPointer>
#include <QSet>

namespace e2e::qt::detail {
/** Refuses pixels if capture reentrancy changes the tree or its masking geometry. */
class CaptureGuard final : public QObject {
    Q_OBJECT
public:
    explicit CaptureGuard(QObject* root);
    ~CaptureGuard() override;
    bool changed() const { return changed_; }
protected:
    bool eventFilter(QObject* object, QEvent* event) override;
private:
    QSet<QObject*> objects_;
    bool changed_ = false;
    void watch(QObject* object, int depth = 0);
    void watchProperty(QObject* object, const char* name);
private slots:
    void invalidate() { changed_ = true; }
};
}
