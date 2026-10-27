// SPDX-License-Identifier: MIT
#include "widget_targets.h"
#include <QApplication>
#include <QHeaderView>
#include <QJsonArray>
#include <QListView>
#include <QMenu>
#include <QMenuBar>
#include <QTableView>
#include <QTreeView>
#include <QStyleOptionViewItem>
#include <QStyledItemDelegate>
#include <QTest>
#include <QWindow>
#include <algorithm>

namespace e2e::qt::detail {
WidgetTarget::WidgetTarget(QWidget* owner, const QModelIndex& index) : kind_(Kind::ModelItem), owner_(owner), index_(index) {}
WidgetTarget::WidgetTarget(QWidget* owner, QAction* action) : kind_(Kind::Action), owner_(owner), action_(action) {}
WidgetTarget::WidgetTarget(QTabBar* owner, int tab) : kind_(Kind::Tab), owner_(owner), number_(tab), count_(owner->count()), tabText_(owner->tabText(tab)), tabData_(owner->tabData(tab)) {
    QObject::connect(owner, &QTabBar::tabMoved, this, [this](int from, int to) {
        if (number_ == from) number_ = to;
        else if (from < number_ && number_ <= to) --number_;
        else if (to <= number_ && number_ < from) ++number_;
    });
}
WidgetTarget::WidgetTarget(QHeaderView* owner, int section) : kind_(Kind::Header), owner_(owner), number_(section), count_(owner->count()) {}
bool WidgetTarget::valid() const {
    if (!owner_) return false;
    if (kind_ == Kind::ModelItem) return index_.isValid() && qobject_cast<QAbstractItemView*>(owner_)->model() == index_.model();
    if (kind_ == Kind::Action) return action_ && owner_->actions().contains(action_);
    if (kind_ == Kind::Tab) {
        auto* tabs = static_cast<QTabBar*>(owner_.data());
        return tabs->count() == count_ && number_ >= 0 && number_ < count_ && tabs->tabText(number_) == tabText_ && tabs->tabData(number_) == tabData_;
    }
    return static_cast<QHeaderView*>(owner_.data())->count() == count_ && number_ >= 0 && number_ < count_;
}
QWidget* WidgetTarget::owner() const {
    if (!valid()) throw Failure("NODE_STALE", "Qt virtual control no longer exists");
    return owner_;
}
QString WidgetTarget::identity() const {
    QString key = QString::number(quintptr(owner_.data()), 16) + '/' + QString::number(int(kind_)) + '/';
    if (kind_ == Kind::Action) return key + QString::number(quintptr(action_.data()), 16);
    if (kind_ != Kind::ModelItem) return key + QString::number(number_);
    QStringList path;
    for (QModelIndex current(index_); current.isValid(); current = current.parent()) path.prepend(QString::number(current.row()) + ':' + QString::number(current.column()));
    return key + path.join('/');
}
QRect WidgetTarget::rectangle() const {
    QWidget* widget = owner();
    if (kind_ == Kind::ModelItem) {
        auto* view = static_cast<QAbstractItemView*>(widget);
        const QRect rect = view->visualRect(index_);
        return QRect(view->viewport()->mapTo(widget, rect.topLeft()), rect.size());
    }
    if (kind_ == Kind::Action) {
        if (auto* menu = qobject_cast<QMenu*>(widget)) return menu->actionGeometry(action_);
        if (auto* menu = qobject_cast<QMenuBar*>(widget)) return menu->actionGeometry(action_);
    }
    if (kind_ == Kind::Tab) return static_cast<QTabBar*>(widget)->tabRect(number_);
    if (kind_ == Kind::Header) {
        auto* header = static_cast<QHeaderView*>(widget);
        const QRect rect = header->orientation() == Qt::Horizontal
            ? QRect(header->sectionViewportPosition(number_), 0, header->sectionSize(number_), header->viewport()->height())
            : QRect(0, header->sectionViewportPosition(number_), header->viewport()->width(), header->sectionSize(number_));
        return QRect(header->viewport()->mapTo(widget, rect.topLeft()), rect.size());
    }
    return {};
}
bool WidgetTarget::hidden() const {
    QWidget* widget = owner();
    if (!widget->isVisible()) return true;
    if (kind_ == Kind::Action) return !action_->isVisible();
    if (kind_ == Kind::Tab) return !static_cast<QTabBar*>(widget)->isTabVisible(number_);
    if (kind_ == Kind::Header) return static_cast<QHeaderView*>(widget)->isSectionHidden(number_);
    if (auto* table = qobject_cast<QTableView*>(widget)) return table->isRowHidden(index_.row()) || table->isColumnHidden(index_.column());
    if (auto* list = qobject_cast<QListView*>(widget)) return list->isRowHidden(index_.row());
    if (auto* tree = qobject_cast<QTreeView*>(widget)) {
        if (tree->isRowHidden(index_.row(), index_.parent()) || tree->isColumnHidden(index_.column())) return true;
        for (auto parent = index_.parent(); parent.isValid() && parent != tree->rootIndex(); parent = parent.parent())
            if (!tree->isExpanded(parent)) return true;
    }
    return false;
}
bool WidgetTarget::checkable() const {
    owner();
    if (kind_ == Kind::Action) return action_->isCheckable();
    return kind_ == Kind::ModelItem && index_.flags().testFlag(Qt::ItemIsUserCheckable) && index_.data(Qt::CheckStateRole).isValid();
}
bool WidgetTarget::checked() const {
    if (!checkable()) return false;
    return kind_ == Kind::Action ? action_->isChecked() : index_.data(Qt::CheckStateRole).toInt() == Qt::Checked;
}
QJsonObject WidgetTarget::snapshot(ObjectRegistry& registry, QWidget* root) const {
    QWidget* widget = owner();
    QJsonObject node = registry.node(const_cast<WidgetTarget*>(this), false);
    const bool secure = secureObject(widget) || (kind_ == Kind::Action && secureObject(action_));
    QJsonObject states{{"hidden", hidden()}, {"disabled", !widget->isEnabled()}};
    QString text;
    QJsonObject attributes;
    if (kind_ == Kind::ModelItem) {
        auto* view = static_cast<QAbstractItemView*>(widget);
        node["role"] = qobject_cast<QTreeView*>(widget) ? "treeitem" : qobject_cast<QListView*>(widget) ? "option" : "cell";
        text = index_.data(Qt::DisplayRole).toString();
        states["disabled"] = !widget->isEnabled() || !index_.flags().testFlag(Qt::ItemIsEnabled);
        states["selected"] = view->selectionModel() && view->selectionModel()->isSelected(index_);
        states["focused"] = view->hasFocus() && view->currentIndex() == index_;
        if (auto* tree = qobject_cast<QTreeView*>(widget); tree && index_.model()->hasChildren(index_)) states["expanded"] = tree->isExpanded(index_);
        attributes = {{"rowindex", QString::number(index_.row())}, {"columnindex", QString::number(index_.column())}, {"editable", index_.flags().testFlag(Qt::ItemIsEditable) ? "true" : "false"}};
    } else if (kind_ == Kind::Action) {
        node["role"] = action_->isSeparator() ? "separator" : action_->isCheckable() ? "menuitemcheckbox" : "menuitem";
        text = action_->text();
        states["disabled"] = !widget->isEnabled() || !action_->isEnabled();
        if (action_->menu()) states["expanded"] = action_->menu()->isVisible();
    } else if (kind_ == Kind::Tab) {
        auto* tabs = static_cast<QTabBar*>(widget);
        node["role"] = "tab"; text = tabs->tabText(number_);
        states["disabled"] = !widget->isEnabled() || !tabs->isTabEnabled(number_);
        states["selected"] = tabs->currentIndex() == number_;
        states["focused"] = tabs->hasFocus() && tabs->currentIndex() == number_;
        attributes["index"] = QString::number(number_);
    } else {
        auto* header = static_cast<QHeaderView*>(widget);
        node["role"] = header->orientation() == Qt::Horizontal ? "columnheader" : "rowheader";
        text = header->model()->headerData(number_, header->orientation()).toString();
        attributes["index"] = QString::number(number_);
    }
    if (!valid()) throw Failure("NODE_STALE", "Qt model changed during observation");
    if (checkable()) states["checked"] = checked();
    if (secure) { states["secure"] = true; node["inputPurpose"] = "generic-secret"; }
    else {
        node["name"] = clean(text, 256); node["text"] = clean(text);
        if (!attributes.isEmpty()) node["attributes"] = attributes;
        if (kind_ == Kind::ModelItem) node["value"] = clean(index_.data(Qt::EditRole).toString());
    }
    node["states"] = states;
    const QRect rect = rectangle();
    node["rect"] = rectJson(QRect(widget->mapTo(root, rect.topLeft()), rect.size()));
    return node;
}
void WidgetTarget::ready(QWidget* root, bool allowOffscreen) const {
    QWidget* widget = owner();
    if (widget->window() != root || hidden() || !widget->isEnabled()) throw Failure("NOT_ACTIONABLE", "Qt virtual control is not available in the active window");
    if (kind_ == Kind::ModelItem && !index_.flags().testFlag(Qt::ItemIsEnabled)) throw Failure("NOT_ACTIONABLE", "Qt model item is disabled");
    if (kind_ == Kind::Action && (!action_->isEnabled() || action_->isSeparator())) throw Failure("NOT_ACTIONABLE", "Qt menu action is disabled or a separator");
    if (kind_ == Kind::Tab && !static_cast<QTabBar*>(widget)->isTabEnabled(number_)) throw Failure("NOT_ACTIONABLE", "Qt tab is disabled");
    if (allowOffscreen) return;
    const QRect rect = rectangle();
    QWidget* viewport = widget;
    if (kind_ == Kind::ModelItem || kind_ == Kind::Header) viewport = static_cast<QAbstractItemView*>(widget)->viewport();
    if (rect.isEmpty() || !viewport->visibleRegion().contains(viewport->mapFrom(widget, rect.center())))
        throw Failure("NOT_ACTIONABLE", "Qt virtual control is outside the visible viewport");
    const QPoint center = widget->mapTo(root, rect.center());
    QWidget* hit = root->childAt(center);
    if (hit && hit != widget && !widget->isAncestorOf(hit)) throw Failure("NOT_ACTIONABLE", "Qt virtual control is covered");
}
void WidgetTarget::click(Qt::MouseButton button, bool twice, bool hover) {
    QWidget* widget = owner();
    QPointer<QWindow> window(widget->window()->windowHandle());
    if (!window) throw Failure("NOT_ACTIONABLE", "Qt virtual control window is not exposed");
    const QPoint point = widget->mapTo(widget->window(), rectangle().center());
    if (hover) QTest::mouseMove(window, point);
    else if (twice) QTest::mouseDClick(window, button, Qt::NoModifier, point);
    else {
        QTest::mousePress(window, button, Qt::NoModifier, point);
        if (!window) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt window was destroyed during virtual control input");
        QTest::mouseRelease(window, button, Qt::NoModifier, point);
    }
}
void WidgetTarget::focus() {
    QWidget* widget = owner();
    QPointer<QWidget> guard(widget);
    if (kind_ == Kind::ModelItem) static_cast<QAbstractItemView*>(widget)->setCurrentIndex(index_);
    else if (kind_ == Kind::Action) {
        if (auto* menu = qobject_cast<QMenu*>(widget)) menu->setActiveAction(action_);
        else if (auto* menu = qobject_cast<QMenuBar*>(widget)) menu->setActiveAction(action_);
    } else if (kind_ == Kind::Tab) static_cast<QTabBar*>(widget)->setCurrentIndex(number_);
    if (!guard || !valid()) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt virtual control changed during focus");
    widget->setFocus(Qt::OtherFocusReason);
    if (!guard || QApplication::focusWidget() != widget) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt virtual control focus was redirected");
}
void WidgetTarget::scrollIntoView() {
    QWidget* widget = owner();
    if (kind_ == Kind::ModelItem) static_cast<QAbstractItemView*>(widget)->scrollTo(index_, QAbstractItemView::EnsureVisible);
    else if (kind_ == Kind::Tab) throw Failure("UNSUPPORTED_CAPABILITY", "scrolling a tab strip requires its navigation controls");
}
void WidgetTarget::setChecked(bool value) {
    if (!checkable()) throw Failure("UNSUPPORTED_CAPABILITY", "Qt virtual control is not checkable");
    if (checked() == value) return;
    if (kind_ == Kind::Action) { click(Qt::LeftButton, false, false); return; }
    auto* view = static_cast<QAbstractItemView*>(owner());
    auto* delegate = view->itemDelegateForIndex(index_);
    if (!delegate || QString::fromLatin1(delegate->metaObject()->className()) != "QStyledItemDelegate")
        throw Failure("UNSUPPORTED_CAPABILITY", "custom model delegates need an application control adapter for checkbox input");
    QStyleOptionViewItem option;
    option.initFrom(view); option.rect = view->visualRect(index_); option.features = QStyleOptionViewItem::HasCheckIndicator;
    option.checkState = static_cast<Qt::CheckState>(index_.data(Qt::CheckStateRole).toInt());
    const QRect indicator = view->style()->subElementRect(QStyle::SE_ItemViewItemCheckIndicator, &option, view);
    if (indicator.isEmpty()) throw Failure("NOT_ACTIONABLE", "Qt item checkbox has no input rectangle");
    QPointer<QWindow> window(view->window()->windowHandle());
    if (!window) throw Failure("NOT_ACTIONABLE", "Qt model window is not exposed");
    const QPoint point = view->viewport()->mapTo(view->window(), indicator.center());
    QTest::mousePress(window, Qt::LeftButton, Qt::NoModifier, point);
    if (!window) throw Failure("ACTION_MAY_HAVE_COMMITTED", "Qt model window was destroyed during checkbox input");
    QTest::mouseRelease(window, Qt::LeftButton, Qt::NoModifier, point);
}
void WidgetTargets::begin() {
    available_.clear();
    targets_.erase(std::remove_if(targets_.begin(), targets_.end(), [](const auto& item) { return !item->valid(); }), targets_.end());
    for (const auto& item : targets_) { item->seen = false; available_.insert(item->identity(), item.get()); }
}
void WidgetTargets::finish() {
    targets_.erase(std::remove_if(targets_.begin(), targets_.end(), [](const auto& item) { return !item->seen; }), targets_.end());
    available_.clear();
}
WidgetTarget* WidgetTargets::retain(std::unique_ptr<WidgetTarget> candidate) {
    const QString key = candidate->identity();
    WidgetTarget* target = available_.value(key);
    if (!target) {
        target = candidate.get(); targets_.push_back(std::move(candidate)); available_.insert(key, target);
    }
    target->seen = true;
    return target;
}
QJsonArray WidgetTargets::modelChildren(QAbstractItemView* view, const QModelIndex& parent, QWidget* root, ObjectRegistry& registry, int depth) {
    QJsonArray result;
    QPointer<QAbstractItemView> guard(view);
    QPointer<QAbstractItemModel> model(view->model());
    if (!model) return result;
    const bool tree = qobject_cast<QTreeView*>(view);
    auto* list = qobject_cast<QListView*>(view);
    const int columns = list ? 1 : model->columnCount(parent);
    const int rows = model->rowCount(parent);
    for (int row = 0; row < rows && !registry.truncated; ++row) {
        for (int column = 0; column < columns && !registry.truncated; ++column) {
            if (!registry.visit(depth)) break;
            if (!guard || !model || view->model() != model) throw Failure("NODE_STALE", "Qt item model changed during observation");
            const QPersistentModelIndex index(model->index(row, list ? list->modelColumn() : column, parent));
            if (!index.isValid()) continue;
            auto* target = retain(std::make_unique<WidgetTarget>(view, index));
            QJsonObject node = target->snapshot(registry, root);
            if (!registry.reserveNode(node)) break;
            if (tree && column == 0 && !node.value("states").toObject().value("secure").toBool() && model->hasChildren(index)) {
                const auto children = modelChildren(view, index, root, registry, depth + 1);
                if (!children.isEmpty()) node["children"] = children;
            }
            result.append(node);
        }
    }
    return result;
}
QJsonArray WidgetTargets::children(QWidget* owner, QWidget* root, ObjectRegistry& registry, int depth) {
    if (auto* view = qobject_cast<QAbstractItemView*>(owner); view && !qobject_cast<QHeaderView*>(owner))
        return modelChildren(view, view->rootIndex(), root, registry, depth);
    QJsonArray result;
    const auto append = [&](std::unique_ptr<WidgetTarget> candidate) {
        if (!registry.visit(depth)) return;
        const auto node = retain(std::move(candidate))->snapshot(registry, root);
        if (registry.reserveNode(node)) result.append(node);
    };
    if (qobject_cast<QMenu*>(owner) || qobject_cast<QMenuBar*>(owner)) {
        for (QAction* action : owner->actions()) { if (registry.truncated) break; append(std::make_unique<WidgetTarget>(owner, action)); }
    } else if (auto* tabs = qobject_cast<QTabBar*>(owner)) {
        for (int tab = 0; tab < tabs->count() && !registry.truncated; ++tab) append(std::make_unique<WidgetTarget>(tabs, tab));
    } else if (auto* header = qobject_cast<QHeaderView*>(owner)) {
        for (int section = 0; section < header->count() && !registry.truncated; ++section) append(std::make_unique<WidgetTarget>(header, section));
    }
    return result;
}
}
