//! macOS Accessibility implementation. All retained Core Foundation values are RAII owned.
use crate::{
    budget::ObservationBudget,
    error::{DriverError, Result},
    provider::{AccessibleProvider, Action},
};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    ffi::c_void,
    ptr,
    time::{Duration, Instant},
};

type CfRef = *const c_void;
type AxRef = CfRef;
type AxError = i32;
const UTF8: u32 = 0x0800_0100;
const MAX_NODES: usize = 20_000;
const MAX_IDENTITIES: usize = 100_000;
const MAX_DEPTH: usize = 60;

#[cfg_attr(
    target_os = "macos",
    link(name = "ApplicationServices", kind = "framework")
)]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXUIElementCreateApplication(pid: i32) -> AxRef;
    fn AXUIElementCopyAttributeValue(
        element: AxRef,
        attribute: CfRef,
        value: *mut CfRef,
    ) -> AxError;
    fn AXUIElementCopyAttributeValues(
        element: AxRef,
        attribute: CfRef,
        index: isize,
        max_values: isize,
        values: *mut CfRef,
    ) -> AxError;
    fn AXUIElementGetAttributeValueCount(
        element: AxRef,
        attribute: CfRef,
        count: *mut isize,
    ) -> AxError;
    fn AXUIElementIsAttributeSettable(
        element: AxRef,
        attribute: CfRef,
        settable: *mut u8,
    ) -> AxError;
    fn AXUIElementSetAttributeValue(element: AxRef, attribute: CfRef, value: CfRef) -> AxError;
    fn AXUIElementPerformAction(element: AxRef, action: CfRef) -> AxError;
    fn AXUIElementSetMessagingTimeout(element: AxRef, timeout: f32) -> AxError;
    fn AXUIElementGetPid(element: AxRef, pid: *mut i32) -> AxError;
    fn AXUIElementGetTypeID() -> usize;
    fn AXValueGetTypeID() -> usize;
    fn AXValueGetType(value: CfRef) -> u32;
    fn AXValueGetValue(value: CfRef, kind: u32, output: *mut c_void) -> u8;
}
#[cfg_attr(target_os = "macos", link(name = "CoreFoundation", kind = "framework"))]
unsafe extern "C" {
    fn CFRetain(value: CfRef) -> CfRef;
    fn CFRelease(value: CfRef);
    fn CFGetTypeID(value: CfRef) -> usize;
    fn CFEqual(a: CfRef, b: CfRef) -> u8;
    fn CFHash(value: CfRef) -> usize;
    fn CFStringCreateWithBytes(
        allocator: CfRef,
        bytes: *const u8,
        count: isize,
        encoding: u32,
        external: u8,
    ) -> CfRef;
    fn CFStringGetTypeID() -> usize;
    fn CFStringGetLength(value: CfRef) -> isize;
    fn CFStringGetCharacters(value: CfRef, range: CfRange, buffer: *mut u16);
    fn CFBooleanGetTypeID() -> usize;
    fn CFBooleanGetValue(value: CfRef) -> u8;
    fn CFNumberGetTypeID() -> usize;
    fn CFNumberGetValue(value: CfRef, kind: i32, output: *mut c_void) -> u8;
    fn CFArrayGetTypeID() -> usize;
    fn CFArrayGetCount(value: CfRef) -> isize;
    fn CFArrayGetValueAtIndex(value: CfRef, index: isize) -> CfRef;
    static kCFBooleanTrue: CfRef;
}

#[repr(C)]
struct CfRange {
    location: isize,
    length: isize,
}
struct Cf(CfRef);
impl Cf {
    fn owned(value: CfRef) -> Result<Self> {
        if value.is_null() {
            Err(DriverError::new(
                "ENGINE_FAILURE",
                "platform returned an invalid object",
            ))
        } else {
            Ok(Self(value))
        }
    }
    fn retain(value: CfRef) -> Result<Self> {
        if value.is_null() {
            return Err(DriverError::stale());
        }
        Self::owned(unsafe { CFRetain(value) })
    }
    fn string(text: &str) -> Result<Self> {
        Self::owned(unsafe {
            CFStringCreateWithBytes(ptr::null(), text.as_ptr(), text.len() as isize, UTF8, 0)
        })
    }
    fn text(&self) -> Option<String> {
        if unsafe { CFGetTypeID(self.0) != CFStringGetTypeID() } {
            return None;
        }
        let length = unsafe { CFStringGetLength(self.0) };
        if !(0..=65_536).contains(&length) {
            return Some("[omitted: text exceeds limit]".to_owned());
        }
        let mut buffer = vec![0u16; length as usize];
        unsafe {
            CFStringGetCharacters(
                self.0,
                CfRange {
                    location: 0,
                    length,
                },
                buffer.as_mut_ptr(),
            );
        }
        let text = String::from_utf16(&buffer).ok()?;
        if text.len() > 65_536 {
            return Some("[omitted: text exceeds limit]".to_owned());
        }
        Some(text)
    }
    fn boolean(&self) -> Option<bool> {
        let type_id = unsafe { CFGetTypeID(self.0) };
        if type_id == unsafe { CFBooleanGetTypeID() } {
            return Some(unsafe { CFBooleanGetValue(self.0) } != 0);
        }
        if type_id == unsafe { CFNumberGetTypeID() } {
            let mut number: i64 = 0;
            if unsafe { CFNumberGetValue(self.0, 4, (&mut number as *mut i64).cast()) } != 0 {
                return match number {
                    0 => Some(false),
                    1 => Some(true),
                    _ => None,
                };
            }
        }
        None
    }
}
impl Drop for Cf {
    fn drop(&mut self) {
        unsafe {
            CFRelease(self.0);
        }
    }
}

struct IdentityRegistry {
    objects: Vec<Cf>,
    buckets: HashMap<usize, Vec<usize>>,
}
impl IdentityRegistry {
    fn new() -> Self {
        Self {
            objects: Vec::new(),
            buckets: HashMap::new(),
        }
    }
    fn id(&mut self, object: AxRef) -> Result<usize> {
        let hash = unsafe { CFHash(object) };
        if let Some(indices) = self.buckets.get(&hash) {
            for index in indices {
                if unsafe { CFEqual(self.objects[*index].0, object) } != 0 {
                    return Ok(*index);
                }
            }
        }
        if self.objects.len() >= MAX_IDENTITIES {
            return Err(DriverError::new(
                "ENGINE_FAILURE",
                "accessible identity budget exhausted; restart the attempt",
            ));
        }
        let index = self.objects.len();
        self.objects.push(Cf::retain(object)?);
        self.buckets.entry(hash).or_default().push(index);
        Ok(index)
    }
}

/// PID-scoped semantic backend. It never inspects the system-wide accessibility root.
pub struct MacOsProvider {
    application: Cf,
    pid: i32,
    registry: IdentityRegistry,
    sensitive: HashSet<usize>,
    current_ids: HashSet<usize>,
    deadline: Instant,
    viewport: (f64, f64),
    text_budget: ObservationBudget,
}
impl MacOsProvider {
    pub fn require_trust() -> Result<()> {
        if unsafe { AXIsProcessTrusted() } != 0 {
            Ok(())
        } else {
            Err(DriverError::new(
                "POLICY_DENIED",
                "grant Accessibility permission to this driver in macOS System Settings, then restart",
            ))
        }
    }
    pub fn new(pid: u32) -> Result<Self> {
        Self::require_trust()?;
        let pid = i32::try_from(pid).map_err(|_| {
            DriverError::new(
                "INVALID_CONFIG",
                "application process identifier is invalid",
            )
        })?;
        let application = Cf::owned(unsafe { AXUIElementCreateApplication(pid) })?;
        ax_result(unsafe { AXUIElementSetMessagingTimeout(application.0, 0.5) })?;
        Ok(Self {
            application,
            pid,
            registry: IdentityRegistry::new(),
            sensitive: HashSet::new(),
            current_ids: HashSet::new(),
            deadline: Instant::now(),
            viewport: (1.0, 1.0),
            text_budget: ObservationBudget::new(4 * 1024 * 1024),
        })
    }
    fn guard(&self) -> Result<()> {
        if Instant::now() >= self.deadline {
            Err(DriverError::new(
                "OPERATION_TIMEOUT",
                "accessibility operation exceeded its budget",
            ))
        } else {
            Ok(())
        }
    }
    fn get(&self, object: AxRef, name: &str) -> Result<Option<Cf>> {
        self.guard()?;
        let key = Cf::string(name)?;
        let mut value = ptr::null();
        let status = unsafe { AXUIElementCopyAttributeValue(object, key.0, &mut value) };
        if status == -25205 || status == -25212 {
            return Ok(None);
        }
        ax_result(status)?;
        Ok(Some(Cf::owned(value)?))
    }
    fn text(&self, object: AxRef, name: &str) -> Result<Option<String>> {
        Ok(self.get(object, name)?.and_then(|value| value.text()))
    }
    fn observed_text(&mut self, object: AxRef, name: &str) -> Result<Option<String>> {
        let value = self.text(object, name)?;
        Ok(value.and_then(|text| self.text_budget.accept(text)))
    }
    fn boolean(&self, object: AxRef, name: &str) -> Result<Option<bool>> {
        Ok(self.get(object, name)?.and_then(|value| value.boolean()))
    }
    fn set(&self, object: AxRef, name: &str, value: CfRef) -> Result<()> {
        self.guard()?;
        let key = Cf::string(name)?;
        let mut settable = 0;
        ax_result(unsafe { AXUIElementIsAttributeSettable(object, key.0, &mut settable) })?;
        if settable == 0 {
            return Err(DriverError::unsupported());
        }
        ax_mutation_result(unsafe { AXUIElementSetAttributeValue(object, key.0, value) })
    }
    fn children(&self, object: AxRef, budget: usize, truncated: &mut bool) -> Result<Vec<Cf>> {
        self.guard()?;
        let key = Cf::string("AXChildren")?;
        let mut count = 0;
        let status = unsafe { AXUIElementGetAttributeValueCount(object, key.0, &mut count) };
        if status == -25205 || status == -25212 {
            return Ok(Vec::new());
        }
        ax_result(status)?;
        if count < 0 {
            return Err(DriverError::new(
                "ENGINE_FAILURE",
                "invalid accessible child count",
            ));
        }
        if count == 0 {
            return Ok(Vec::new());
        }
        let count = usize::try_from(count)
            .map_err(|_| DriverError::new("ENGINE_FAILURE", "invalid accessible child count"))?;
        let take = count.min(budget);
        if count > take {
            *truncated = true;
        }
        if take == 0 {
            return Ok(Vec::new());
        }
        let mut values = ptr::null();
        ax_result(unsafe {
            AXUIElementCopyAttributeValues(object, key.0, 0, take as isize, &mut values)
        })?;
        let array = Cf::owned(values)?;
        if unsafe { CFGetTypeID(array.0) != CFArrayGetTypeID() } {
            return Err(DriverError::new(
                "ENGINE_FAILURE",
                "accessible children are not an array",
            ));
        }
        let size = unsafe { CFArrayGetCount(array.0) };
        if size < 0 || size as usize > take {
            return Err(DriverError::new(
                "ENGINE_FAILURE",
                "accessible child array exceeded its budget",
            ));
        }
        (0..size)
            .map(|index| {
                let value = unsafe { CFArrayGetValueAtIndex(array.0, index) };
                if value.is_null() || unsafe { CFGetTypeID(value) != AXUIElementGetTypeID() } {
                    return Err(DriverError::new(
                        "ENGINE_FAILURE",
                        "accessible child has an invalid type",
                    ));
                }
                Cf::retain(value)
            })
            .collect()
    }
    fn node(
        &mut self,
        object: AxRef,
        depth: usize,
        seen: &mut HashSet<usize>,
        truncated: &mut bool,
    ) -> Result<Option<Value>> {
        self.guard()?;
        if seen.len() >= MAX_NODES - 1 || depth > MAX_DEPTH {
            *truncated = true;
            return Ok(None);
        }
        ax_result(unsafe { AXUIElementSetMessagingTimeout(object, 0.5) })?;
        let mut pid = 0;
        ax_result(unsafe { AXUIElementGetPid(object, &mut pid) })?;
        if pid != self.pid {
            *truncated = true;
            return Ok(None);
        }
        let id = self.registry.id(object)?;
        if !seen.insert(id) {
            *truncated = true;
            return Ok(None);
        }
        let role = self
            .text(object, "AXRole")?
            .ok_or_else(DriverError::stale)?;
        let secure = self.sensitive.contains(&id)
            || self.text(object, "AXSubrole")?.as_deref() == Some("AXSecureTextField");
        let disabled = self
            .boolean(object, "AXEnabled")?
            .is_some_and(|enabled| !enabled);
        let focused = self.boolean(object, "AXFocused")?.unwrap_or(false);
        let mut node = json!({"ref":{"id":format!("ax-{id}"),"revision":""},"role":semantic_role(&role),"states":{"disabled":disabled,"focused":focused,"secure":secure}});
        if secure {
            node["inputPurpose"] = json!(if self.sensitive.contains(&id) {
                "generic-secret"
            } else {
                "password"
            });
            return Ok(Some(node));
        }
        let title = self.observed_text(object, "AXTitle")?;
        let description = self.observed_text(object, "AXDescription")?;
        if let Some(name) = title.filter(|text| !text.is_empty()).or(description) {
            node["name"] = json!(name);
        }
        if let Some(test_id) = self
            .observed_text(object, "AXIdentifier")?
            .filter(|value| value.len() <= 1024)
        {
            node["testId"] = json!(test_id);
        }
        if let Some(value) = self.observed_text(object, "AXValue")? {
            node["value"] = json!(&value);
            if role == "AXStaticText" {
                node["text"] = json!(value);
            }
        }
        if role == "AXCheckBox" || role == "AXSwitch" {
            if let Some(checked) = self.boolean(object, "AXValue")? {
                node["states"]["checked"] = json!(checked);
            }
        }
        for (attribute, state) in [("AXSelected", "selected"), ("AXExpanded", "expanded")] {
            if let Some(value) = self.boolean(object, attribute)? {
                node["states"][state] = json!(value);
            }
        }
        if role == "AXWindow" {
            self.window_size(object)?;
        }
        let children = self.children(object, MAX_NODES - seen.len(), truncated)?;
        let mut nodes = Vec::new();
        for child in children {
            if let Some(value) = self.node(child.0, depth + 1, seen, truncated)? {
                nodes.push(value);
            }
        }
        if !nodes.is_empty() {
            node["children"] = json!(nodes);
        }
        Ok(Some(node))
    }
    fn window_size(&mut self, object: AxRef) -> Result<()> {
        #[repr(C)]
        struct Size {
            width: f64,
            height: f64,
        }
        if let Some(value) = self.get(object, "AXSize")? {
            if unsafe { CFGetTypeID(value.0) == AXValueGetTypeID() && AXValueGetType(value.0) == 2 }
            {
                let mut size = Size {
                    width: 0.0,
                    height: 0.0,
                };
                if unsafe { AXValueGetValue(value.0, 2, (&mut size as *mut Size).cast()) } != 0
                    && size.width.is_finite()
                    && size.height.is_finite()
                    && (1.0..=32768.0).contains(&size.width)
                    && (1.0..=32768.0).contains(&size.height)
                {
                    self.viewport.0 = self.viewport.0.max(size.width);
                    self.viewport.1 = self.viewport.1.max(size.height);
                }
            }
        }
        Ok(())
    }
}
impl AccessibleProvider for MacOsProvider {
    fn snapshot(&mut self) -> Result<Value> {
        self.deadline = Instant::now() + Duration::from_secs(5);
        self.viewport = (1.0, 1.0);
        self.current_ids.clear();
        self.text_budget = ObservationBudget::new(4 * 1024 * 1024);
        let mut seen = HashSet::new();
        let mut truncated = false;
        let application = Cf::retain(self.application.0)?;
        let child = self.node(application.0, 0, &mut seen, &mut truncated)?;
        truncated |= self.text_budget.exhausted();
        self.current_ids = seen;
        Ok(
            json!({"root":{"ref":{"id":"desktop-root","revision":""},"role":"application","children":child.into_iter().collect::<Vec<_>>()},"viewport":{"width":self.viewport.0,"height":self.viewport.1},"truncated":truncated}),
        )
    }
    fn perform(&mut self, id: &str, action: &Action) -> Result<()> {
        self.deadline = Instant::now() + Duration::from_secs(5);
        let index = id
            .strip_prefix("ax-")
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or_else(DriverError::stale)?;
        if !self.current_ids.contains(&index) {
            return Err(DriverError::stale());
        }
        let object = self
            .registry
            .objects
            .get(index)
            .ok_or_else(DriverError::stale)?
            .0;
        ax_result(unsafe { AXUIElementSetMessagingTimeout(object, 0.5) })?;
        let mut pid = 0;
        ax_result(unsafe { AXUIElementGetPid(object, &mut pid) })?;
        if pid != self.pid {
            return Err(DriverError::stale());
        }
        let role = self
            .text(object, "AXRole")?
            .ok_or_else(DriverError::stale)?;
        if self
            .boolean(object, "AXEnabled")?
            .is_some_and(|value| !value)
        {
            return Err(DriverError::new(
                "NOT_ACTIONABLE",
                "accessible control is disabled",
            ));
        }
        match action {
            Action::Tap => {
                let press = Cf::string("AXPress")?;
                ax_mutation_result(unsafe { AXUIElementPerformAction(object, press.0) })
            }
            Action::Fill { value, sensitive } => {
                if !["AXTextField", "AXTextArea", "AXComboBox"].contains(&role.as_str()) {
                    return Err(DriverError::unsupported());
                }
                if *sensitive {
                    self.sensitive.insert(index);
                }
                let value = Cf::string(value)?;
                self.set(object, "AXValue", value.0)
            }
            Action::Clear => {
                if !["AXTextField", "AXTextArea", "AXComboBox"].contains(&role.as_str()) {
                    return Err(DriverError::unsupported());
                }
                let value = Cf::string("")?;
                self.set(object, "AXValue", value.0)
            }
            Action::Focus => self.set(object, "AXFocused", unsafe { kCFBooleanTrue }),
            Action::Check | Action::Uncheck => {
                if role != "AXCheckBox" && role != "AXSwitch" {
                    return Err(DriverError::unsupported());
                }
                let checked = self
                    .boolean(object, "AXValue")?
                    .ok_or_else(DriverError::unsupported)?;
                let desired = matches!(action, Action::Check);
                if checked == desired {
                    return Ok(());
                }
                let press = Cf::string("AXPress")?;
                ax_mutation_result(unsafe { AXUIElementPerformAction(object, press.0) })
            }
        }
    }
}
fn semantic_role(role: &str) -> &str {
    match role {
        "AXApplication" => "application",
        "AXWindow" => "window",
        "AXButton" => "button",
        "AXCheckBox" => "checkbox",
        "AXSwitch" => "switch",
        "AXRadioButton" => "radio",
        "AXTextField" | "AXTextArea" => "textbox",
        "AXStaticText" => "text",
        "AXComboBox" | "AXPopUpButton" => "combobox",
        "AXMenu" => "menu",
        "AXMenuItem" => "menuitem",
        "AXTable" => "table",
        "AXRow" => "row",
        "AXCell" => "cell",
        "AXList" => "list",
        "AXSlider" => "slider",
        "AXLink" => "link",
        "AXImage" => "image",
        "AXTabGroup" => "tablist",
        _ => "group",
    }
}
fn ax_result(status: AxError) -> Result<()> {
    match status {
        0 => Ok(()),
        -25202 => Err(DriverError::stale()),
        -25205 | -25206 | -25208 | -25212 => Err(DriverError::unsupported()),
        -25211 => Err(DriverError::new(
            "POLICY_DENIED",
            "macOS accessibility is disabled",
        )),
        -25204 => Err(DriverError::new(
            "OPERATION_TIMEOUT",
            "accessibility request could not complete",
        )),
        _ => Err(DriverError::new(
            "ENGINE_FAILURE",
            "macOS accessibility operation failed",
        )),
    }
}

fn ax_mutation_result(status: AxError) -> Result<()> {
    match status {
        -25204 | -25200 => Err(DriverError::new(
            "ACTION_MAY_HAVE_COMMITTED",
            "accessibility mutation outcome is unknown; restart the attempt",
        )),
        _ => ax_result(status),
    }
}
