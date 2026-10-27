#![allow(clashing_extern_declarations, dead_code)]
mod accessible_controls;
use std::ffi::{CString, c_char, c_void};
use std::sync::atomic::{AtomicBool, Ordering};
type Id = *mut c_void;
type Sel = *const c_void;
#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Rect {
    origin: Point,
    size: Size,
}
#[cfg_attr(target_os = "macos", link(name = "AppKit", kind = "framework"))]
unsafe extern "C" {}
#[cfg_attr(target_os = "macos", link(name = "objc"))]
unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_allocateClassPair(parent: Id, name: *const c_char, extra: usize) -> Id;
    fn objc_registerClassPair(class: Id);
    fn class_addMethod(
        class: Id,
        selector: Sel,
        implementation: unsafe extern "C" fn(Id, Sel, Id),
        types: *const c_char,
    ) -> bool;
    #[link_name = "objc_msgSend"]
    fn send0(object: Id, selector: Sel) -> Id;
    #[link_name = "objc_msgSend"]
    fn send1(object: Id, selector: Sel, arg: Id) -> Id;
    #[link_name = "objc_msgSend"]
    fn set_id(object: Id, selector: Sel, arg: Id);
    #[link_name = "objc_msgSend"]
    fn set_sel(object: Id, selector: Sel, arg: Sel);
    #[link_name = "objc_msgSend"]
    fn set_bool(object: Id, selector: Sel, arg: i8);
    #[link_name = "objc_msgSend"]
    fn set_int(object: Id, selector: Sel, arg: isize);
    #[link_name = "objc_msgSend"]
    fn set_point(object: Id, selector: Sel, point: Point);
    #[link_name = "objc_msgSend"]
    fn init_frame(object: Id, selector: Sel, frame: Rect) -> Id;
    #[link_name = "objc_msgSend"]
    fn init_window(
        object: Id,
        selector: Sel,
        frame: Rect,
        style: usize,
        backing: usize,
        defer: i8,
    ) -> Id;
    #[link_name = "objc_msgSend"]
    fn string_utf8(object: Id, selector: Sel, text: *const c_char) -> Id;
}
static mut MOVING: Id = std::ptr::null_mut();
static mut INPUT: Id = std::ptr::null_mut();
static mut OUTPUT: Id = std::ptr::null_mut();
static mut REVEALABLE: Id = std::ptr::null_mut();
static WRONG_OUTPUT: AtomicBool = AtomicBool::new(false);
unsafe fn selector(name: &str) -> Sel {
    let name = CString::new(name).unwrap();
    unsafe { sel_registerName(name.as_ptr()) }
}
unsafe fn class(name: &str) -> Id {
    let name = CString::new(name).unwrap();
    unsafe { objc_getClass(name.as_ptr()) }
}
unsafe fn text(value: &str) -> Id {
    let value = CString::new(value).unwrap();
    unsafe {
        string_utf8(
            class("NSString"),
            selector("stringWithUTF8String:"),
            value.as_ptr(),
        )
    }
}
fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        origin: Point { x, y },
        size: Size { width, height },
    }
}
unsafe fn control(kind: &str, frame: Rect, label: &str, id: &str) -> Id {
    unsafe {
        let object = init_frame(
            send0(class(kind), selector("alloc")),
            selector("initWithFrame:"),
            frame,
        );
        set_id(object, selector("setAccessibilityLabel:"), text(label));
        set_id(object, selector("setAccessibilityIdentifier:"), text(id));
        object
    }
}
unsafe extern "C" fn move_control(_: Id, _: Sel, _: Id) {
    unsafe {
        set_point(
            MOVING,
            selector("setFrameOrigin:"),
            Point { x: 1000., y: 10. },
        );
    }
}
unsafe extern "C" fn apply(_: Id, _: Sel, _: Id) {
    unsafe {
        let value = if WRONG_OUTPUT.load(Ordering::Relaxed) {
            text("planted wrong result")
        } else {
            send0(INPUT, selector("stringValue"))
        };
        set_id(OUTPUT, selector("setStringValue:"), value);
    }
}
unsafe extern "C" fn reveal_password(_: Id, _: Sel, _: Id) {
    unsafe {
        set_id(
            REVEALABLE,
            selector("setAccessibilitySubrole:"),
            std::ptr::null_mut(),
        );
    }
}
/// Must run on the GUI/main thread. The owning driver closes the process after the test.
pub unsafe fn run() {
    WRONG_OUTPUT.store(
        std::env::args_os().any(|arg| arg == "--wrong"),
        Ordering::Relaxed,
    );
    unsafe {
        let _pool = send0(
            send0(class("NSAutoreleasePool"), selector("alloc")),
            selector("init"),
        );
        let app = send0(class("NSApplication"), selector("sharedApplication"));
        set_int(app, selector("setActivationPolicy:"), 0);
        let window = init_window(
            send0(class("NSWindow"), selector("alloc")),
            selector("initWithContentRect:styleMask:backing:defer:"),
            rect(80., 80., 780., 300.),
            15,
            2,
            0,
        );
        set_id(
            window,
            selector("setTitle:"),
            text("e2e-platform Rust AppKit fixture"),
        );
        let content = send0(window, selector("contentView"));
        INPUT = control(
            "NSTextField",
            rect(24., 230., 280., 28.),
            "Test input",
            "input",
        );
        set_id(INPUT, selector("setStringValue:"), text("initial"));
        set_id(content, selector("addSubview:"), INPUT);
        OUTPUT = control("NSTextField", rect(24., 174., 400., 28.), "Echo", "echo");
        set_bool(OUTPUT, selector("setEditable:"), 0);
        set_bool(OUTPUT, selector("setBezeled:"), 0);
        set_id(OUTPUT, selector("setStringValue:"), text("waiting"));
        set_id(content, selector("addSubview:"), OUTPUT);
        let name = CString::new("E2EPlatformDemoActions").unwrap();
        let actions_class = objc_allocateClassPair(class("NSObject"), name.as_ptr(), 0);
        let signature = CString::new("v@:@").unwrap();
        assert!(class_addMethod(
            actions_class,
            selector("apply:"),
            apply,
            signature.as_ptr()
        ));
        assert!(class_addMethod(
            actions_class,
            selector("moveControl:"),
            move_control,
            signature.as_ptr()
        ));
        assert!(class_addMethod(
            actions_class,
            selector("revealPassword:"),
            reveal_password,
            signature.as_ptr()
        ));
        objc_registerClassPair(actions_class);
        let actions = send0(send0(actions_class, selector("alloc")), selector("init"));
        let button = control("NSButton", rect(324., 228., 120., 32.), "Apply", "apply");
        set_id(button, selector("setTitle:"), text("Apply"));
        set_id(button, selector("setTarget:"), actions);
        set_sel(button, selector("setAction:"), selector("apply:"));
        set_id(content, selector("addSubview:"), button);
        let checkbox = control(
            "NSButton",
            rect(24., 118., 220., 28.),
            "Enabled option",
            "option",
        );
        set_int(checkbox, selector("setButtonType:"), 3);
        set_id(checkbox, selector("setTitle:"), text("Enabled option"));
        set_id(content, selector("addSubview:"), checkbox);
        MOVING = control(
            "NSButton",
            rect(24., 10., 180., 28.),
            "Moving control",
            "moving",
        );
        set_id(MOVING, selector("setTitle:"), text("Moving control"));
        set_id(content, selector("addSubview:"), MOVING);
        let mover = control(
            "NSButton",
            rect(220., 10., 180., 28.),
            "Move control",
            "move-control",
        );
        set_id(mover, selector("setTitle:"), text("Move control"));
        set_id(mover, selector("setTarget:"), actions);
        set_sel(mover, selector("setAction:"), selector("moveControl:"));
        set_id(content, selector("addSubview:"), mover);
        let password = control(
            "NSSecureTextField",
            rect(24., 62., 280., 28.),
            "Password",
            "password",
        );
        set_id(
            password,
            selector("setStringValue:"),
            text("fixture-password"),
        );
        set_id(content, selector("addSubview:"), password);
        REVEALABLE = control(
            "NSTextField",
            rect(24., 92., 280., 24.),
            "Revealed password",
            "revealable",
        );
        set_id(
            REVEALABLE,
            selector("setAccessibilitySubrole:"),
            text("AXSecureTextField"),
        );
        set_id(
            REVEALABLE,
            selector("setStringValue:"),
            text("fixture-password-reveal"),
        );
        set_id(content, selector("addSubview:"), REVEALABLE);
        let reveal = control(
            "NSButton",
            rect(314., 92., 130., 24.),
            "Reveal password",
            "reveal-password",
        );
        set_id(reveal, selector("setTitle:"), text("Reveal password"));
        set_id(reveal, selector("setTarget:"), actions);
        set_sel(reveal, selector("setAction:"), selector("revealPassword:"));
        set_id(content, selector("addSubview:"), reveal);
        accessible_controls::install(content);
        set_id(
            window,
            selector("makeKeyAndOrderFront:"),
            std::ptr::null_mut(),
        );
        accessible_controls::reset_scroll();
        set_bool(app, selector("activateIgnoringOtherApps:"), 1);
        send0(app, selector("run"));
    }
}
