//! Application-owned accessibility extensions with visible native AppKit behavior.
//! The external driver still uses only the public AX protocol across processes.
use super::{
    Id, Rect, Sel, class, control, init_frame, objc_allocateClassPair, objc_registerClassPair,
    rect, selector, send0, set_bool, set_id, set_int, text,
};
use std::ffi::{CString, c_char, c_void};

unsafe extern "C" {
    #[link_name = "class_addMethod"]
    fn add_method(
        class: Id,
        selector: Sel,
        implementation: *const c_void,
        types: *const c_char,
    ) -> bool;
    #[link_name = "objc_msgSend"]
    fn array(object: Id, selector: Sel, objects: *const Id, count: usize) -> Id;
    #[link_name = "objc_msgSend"]
    fn length(object: Id, selector: Sel) -> usize;
    #[link_name = "objc_msgSend"]
    fn at(object: Id, selector: Sel, index: usize) -> Id;
    #[link_name = "objc_msgSend"]
    fn equal(object: Id, selector: Sel, other: Id) -> i8;
    #[link_name = "objc_msgSend"]
    fn scroll(object: Id, selector: Sel, rect: Rect) -> i8;
    fn NSAccessibilityFrameInView(view: Id, rect: Rect) -> Rect;
}

static mut ALPHA: Id = std::ptr::null_mut();
static mut BETA: Id = std::ptr::null_mut();
static mut SELECTED: Id = std::ptr::null_mut();
static mut OUTPUT: Id = std::ptr::null_mut();
static mut SCROLL: Id = std::ptr::null_mut();
static mut LATE: Id = std::ptr::null_mut();
static mut SCROLLED: bool = false;

unsafe fn items(values: &[Id]) -> Id {
    unsafe {
        array(
            class("NSArray"),
            selector("arrayWithObjects:count:"),
            values.as_ptr(),
            values.len(),
        )
    }
}
unsafe fn method(class: Id, name: &str, implementation: *const c_void, encoding: &str) {
    let encoding = CString::new(encoding).unwrap();
    assert!(unsafe { add_method(class, selector(name), implementation, encoding.as_ptr()) });
}
unsafe extern "C" fn selected(_: Id, _: Sel) -> Id {
    unsafe { items(&[SELECTED]) }
}
unsafe extern "C" fn select(_: Id, _: Sel, children: Id) {
    unsafe {
        if children.is_null() || length(children, selector("count")) != 1 {
            return;
        }
        let candidate = at(children, selector("objectAtIndex:"), 0);
        if candidate != ALPHA && candidate != BETA {
            return;
        }
        SELECTED = candidate;
        set_int(
            ALPHA,
            selector("setState:"),
            isize::from(candidate == ALPHA),
        );
        set_int(BETA, selector("setState:"), isize::from(candidate == BETA));
        set_id(
            OUTPUT,
            selector("setStringValue:"),
            text(if candidate == ALPHA {
                "Alpha selected"
            } else {
                "Beta selected"
            }),
        );
    }
}
unsafe extern "C" fn action_names(_: Id, _: Sel) -> Id {
    unsafe { items(&[text("AXScrollToVisible")]) }
}
unsafe extern "C" fn not_ignored(_: Id, _: Sel) -> i8 {
    0
}
unsafe extern "C" fn frame(_: Id, _: Sel) -> Rect {
    unsafe { NSAccessibilityFrameInView(LATE, rect(0., 0., 180., 28.)) }
}
unsafe extern "C" fn scroll_value(_: Id, _: Sel) -> Id {
    unsafe { text(if SCROLLED { "performed" } else { "pending" }) }
}
unsafe extern "C" fn action_description(_: Id, _: Sel, _: Id) -> Id {
    unsafe { text("Scroll to visible") }
}
unsafe extern "C" fn perform_action(_: Id, _: Sel, action: Id) {
    unsafe {
        if equal(
            action,
            selector("isEqualToString:"),
            text("AXScrollToVisible"),
        ) != 0
        {
            scroll(
                LATE,
                selector("scrollRectToVisible:"),
                rect(0., 0., 180., 28.),
            );
            SCROLLED = true;
        }
    }
}

/// Build a selectable native radio group and an explicitly scroll-accessible view.
pub(super) unsafe fn install(content: Id) {
    unsafe {
        let name = CString::new("E2ESelectableView").unwrap();
        let list_class = objc_allocateClassPair(class("NSView"), name.as_ptr(), 0);
        method(
            list_class,
            "accessibilitySelectedChildren",
            selected as *const c_void,
            "@@:",
        );
        method(
            list_class,
            "setAccessibilitySelectedChildren:",
            select as *const c_void,
            "v@:@",
        );
        objc_registerClassPair(list_class);
        let list = control(
            "E2ESelectableView",
            rect(480., 170., 240., 100.),
            "Choices",
            "choices",
        );
        set_bool(list, selector("setAccessibilityElement:"), 1);
        set_bool(list, selector("setAccessibilityEnabled:"), 1);
        set_id(list, selector("setAccessibilityRole:"), text("AXList"));
        ALPHA = control("NSButton", rect(10., 58., 200., 28.), "Alpha", "alpha");
        BETA = control("NSButton", rect(10., 18., 200., 28.), "Beta", "beta");
        for (button, title) in [(ALPHA, "Alpha"), (BETA, "Beta")] {
            set_int(button, selector("setButtonType:"), 4);
            set_id(button, selector("setTitle:"), text(title));
            set_id(list, selector("addSubview:"), button);
        }
        set_id(
            list,
            selector("setAccessibilityChildren:"),
            items(&[ALPHA, BETA]),
        );
        SELECTED = ALPHA;
        set_int(ALPHA, selector("setState:"), 1);
        set_id(content, selector("addSubview:"), list);
        OUTPUT = control(
            "NSTextField",
            rect(480., 140., 240., 24.),
            "Selection result",
            "selection-result",
        );
        set_bool(OUTPUT, selector("setEditable:"), 0);
        set_bool(OUTPUT, selector("setBezeled:"), 0);
        set_id(OUTPUT, selector("setStringValue:"), text("Alpha selected"));
        set_id(content, selector("addSubview:"), OUTPUT);

        let name = CString::new("E2EScrollableElement").unwrap();
        let scroll_class =
            objc_allocateClassPair(class("NSAccessibilityElement"), name.as_ptr(), 0);
        // A separate accessible element represents the actual drawn view and
        // owns its optional semantic action, independent of NSView defaults.
        method(
            scroll_class,
            "accessibilityIsIgnored",
            not_ignored as *const c_void,
            "c@:",
        );
        method(
            scroll_class,
            "accessibilityActionNames",
            action_names as *const c_void,
            "@@:",
        );
        method(
            scroll_class,
            "accessibilityPerformAction:",
            perform_action as *const c_void,
            "v@:@",
        );
        method(
            scroll_class,
            "accessibilityActionDescription:",
            action_description as *const c_void,
            "@@:@",
        );
        method(
            scroll_class,
            "accessibilityFrame",
            frame as *const c_void,
            "{CGRect={CGPoint=dd}{CGSize=dd}}@:",
        );
        method(
            scroll_class,
            "accessibilityValue",
            scroll_value as *const c_void,
            "@@:",
        );
        objc_registerClassPair(scroll_class);
        SCROLL = control(
            "NSScrollView",
            rect(480., 15., 240., 110.),
            "Scrollable controls",
            "scroll-area",
        );
        set_bool(SCROLL, selector("setHasVerticalScroller:"), 1);
        let document = init_frame(
            send0(class("NSView"), selector("alloc")),
            selector("initWithFrame:"),
            rect(0., 0., 220., 900.),
        );
        LATE = control(
            "NSView",
            rect(10., 800., 180., 28.),
            "Late control",
            "late-view",
        );
        set_bool(LATE, selector("setAccessibilityElement:"), 0);
        let caption = control(
            "NSTextField",
            rect(0., 0., 180., 28.),
            "Late control",
            "late-caption",
        );
        set_id(caption, selector("setStringValue:"), text("Late control"));
        set_bool(caption, selector("setEditable:"), 0);
        set_bool(caption, selector("setAccessibilityElement:"), 0);
        set_id(LATE, selector("addSubview:"), caption);
        set_id(document, selector("addSubview:"), LATE);
        set_id(SCROLL, selector("setDocumentView:"), document);
        set_id(content, selector("addSubview:"), SCROLL);
        let accessible = send0(send0(scroll_class, selector("alloc")), selector("init"));
        set_bool(accessible, selector("setAccessibilityElement:"), 1);
        set_bool(accessible, selector("setAccessibilityEnabled:"), 1);
        set_id(
            accessible,
            selector("setAccessibilityRole:"),
            text("AXGroup"),
        );
        set_id(
            accessible,
            selector("setAccessibilityLabel:"),
            text("Late control"),
        );
        set_id(
            accessible,
            selector("setAccessibilityIdentifier:"),
            text("late"),
        );
        set_id(accessible, selector("setAccessibilityParent:"), SCROLL);
        set_id(
            document,
            selector("setAccessibilityChildren:"),
            items(&[accessible]),
        );
    }
}

/// Start with the custom view clipped; the acceptance test must scroll the real viewport.
pub(super) unsafe fn reset_scroll() {
    unsafe {
        send0(SCROLL, selector("layoutSubtreeIfNeeded"));
        let clip = send0(SCROLL, selector("contentView"));
        super::set_point(
            clip,
            selector("scrollToPoint:"),
            super::Point { x: 0., y: 0. },
        );
        set_id(SCROLL, selector("reflectScrolledClipView:"), clip);
    }
}
