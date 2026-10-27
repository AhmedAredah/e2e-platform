//! macOS Accessibility implementation. All retained Core Foundation values are RAII owned.
use crate::{
    budget::ObservationBudget,
    error::{DriverError, Result},
    provider::{AccessibleProvider, Action, SelectionChoice},
    semantics::{self, Rect, Visibility},
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
    fn AXUIElementCopyActionNames(element: AxRef, names: *mut CfRef) -> AxError;
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
    fn CFArrayCreate(
        allocator: CfRef,
        values: *const CfRef,
        count: isize,
        callbacks: CfRef,
    ) -> CfRef;
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
    fn text(&self) -> Option<(String, bool)> {
        if unsafe { CFGetTypeID(self.0) != CFStringGetTypeID() } {
            return None;
        }
        let length = unsafe { CFStringGetLength(self.0) };
        if !(0..=65_536).contains(&length) {
            return Some((String::new(), true));
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
        let Ok(text) = String::from_utf16(&buffer) else {
            return Some((String::new(), true));
        };
        if text.len() > 65_536 {
            return Some((String::new(), true));
        }
        Some((text, false))
    }
    fn number(&self) -> Option<f64> {
        if unsafe { CFGetTypeID(self.0) != CFNumberGetTypeID() } {
            return None;
        }
        let mut number: f64 = 0.0;
        (unsafe { CFNumberGetValue(self.0, 13, (&mut number as *mut f64).cast()) } != 0
            && number.is_finite())
        .then_some(number)
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
    visibility: HashMap<usize, Visibility>,
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
            visibility: HashMap::new(),
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
        match self.get(object, name)?.and_then(|value| value.text()) {
            Some((_, true)) => Err(DriverError::new(
                "ENGINE_FAILURE",
                "platform metadata is invalid or exceeds its limit",
            )),
            value => Ok(value.map(|(text, _)| text)),
        }
    }
    fn observed_text(&mut self, object: AxRef, name: &str) -> Result<Option<String>> {
        let value = self.get(object, name)?.and_then(|value| value.text());
        Ok(value.and_then(|(text, omitted)| {
            if omitted {
                self.text_budget.omit();
                None
            } else {
                self.text_budget.accept(text)
            }
        }))
    }
    fn observed_value(&mut self, object: AxRef) -> Result<Option<String>> {
        let Some(value) = self.get(object, "AXValue")? else {
            return Ok(None);
        };
        if let Some((text, omitted)) = value.text() {
            if omitted {
                self.text_budget.omit();
                return Ok(None);
            }
            return Ok(self.text_budget.accept(text));
        }
        Ok(value
            .number()
            .and_then(|number| self.text_budget.accept(number.to_string())))
    }
    fn label_name(&mut self, object: AxRef) -> Result<Option<String>> {
        let Some(label) = self.get(object, "AXTitleUIElement")? else {
            return Ok(None);
        };
        if unsafe { CFGetTypeID(label.0) != AXUIElementGetTypeID() } {
            return Ok(None);
        }
        let mut pid = 0;
        ax_result(unsafe { AXUIElementGetPid(label.0, &mut pid) })?;
        if pid != self.pid {
            return Ok(None);
        }
        let identity = self.registry.id(label.0)?;
        if self.sensitive.contains(&identity)
            || self.text(label.0, "AXSubrole")?.as_deref() == Some("AXSecureTextField")
        {
            return Ok(None);
        }
        let title = self.observed_text(label.0, "AXTitle")?;
        if title.as_ref().is_some_and(|title| !title.is_empty()) {
            return Ok(title);
        }
        if self.text(label.0, "AXRole")?.as_deref() == Some("AXStaticText") {
            return self.observed_text(label.0, "AXValue");
        }
        Ok(None)
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
        if (size as usize) < take {
            *truncated = true;
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
        clip: Option<Rect>,
        parent_hidden: bool,
        parent_minimized: Option<bool>,
        parent_role: &str,
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
        let enabled = self.boolean(object, "AXEnabled")?;
        let disabled = enabled != Some(true);
        let rect = self.rect(object)?;
        let minimized = if role == "AXWindow" {
            self.boolean(object, "AXMinimized")?
        } else {
            parent_minimized
        };
        let clip = if role == "AXWindow" { rect } else { clip };
        let visibility = semantics::visibility(
            self.boolean(object, "AXHidden")?,
            self.boolean(self.application.0, "AXHidden")?,
            minimized,
            parent_hidden,
            rect,
            clip,
        );
        self.visibility.insert(id, visibility);
        let canonical_role = if role == "AXRow" && parent_role == "AXList" {
            "option"
        } else if role == "AXRow" && parent_role == "AXOutline" {
            "treeitem"
        } else {
            semantics::role(&role)
        };
        let focused = self.boolean(object, "AXFocused")?;
        let mut node = json!({"ref":{"id":format!("ax-{id}"),"revision":""},"role":canonical_role,"states":{"disabled":disabled,"enabledKnown":enabled.is_some(),"focusedKnown":focused.is_some(),"hidden":visibility.hidden(),"visibilityKnown":visibility != Visibility::Unknown,"secure":secure}});
        if let Some(focused) = focused {
            node["states"]["focused"] = json!(focused);
        }
        if secure {
            node["inputPurpose"] = json!(if self.sensitive.contains(&id) {
                "generic-secret"
            } else {
                "password"
            });
            return Ok(Some(node));
        }
        node["attributes"] = json!({"visibility":visibility.label()});
        if let Some(placeholder) = self.observed_text(object, "AXPlaceholderValue")? {
            if placeholder.len() <= 4096 {
                node["attributes"]["placeholder"] = json!(placeholder);
            } else {
                self.text_budget.omit();
            }
        }
        let title = self.observed_text(object, "AXTitle")?;
        let description = self.observed_text(object, "AXDescription")?;
        let direct_name = title
            .filter(|text| !text.is_empty())
            .or(description.filter(|text| !text.is_empty()));
        let name = match direct_name {
            Some(name) => Some(name),
            None => self.label_name(object)?,
        };
        if let Some(name) = name {
            node["name"] = json!(name);
        }
        if let Some(test_id) = self.observed_text(object, "AXIdentifier")? {
            if test_id.len() <= 1024 {
                node["testId"] = json!(test_id);
            } else {
                self.text_budget.omit();
            }
        }
        if let Some(value) = self.observed_value(object)? {
            node["value"] = json!(&value);
            if role == "AXStaticText" {
                node["text"] = json!(value);
            }
        }
        if ["AXCheckBox", "AXSwitch", "AXRadioButton"].contains(&role.as_str()) {
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
            let child_clip = semantics::child_clip(&role, clip, rect);
            if let Some(value) = self.node(
                child.0,
                depth + 1,
                seen,
                truncated,
                child_clip,
                visibility == Visibility::Hidden,
                minimized,
                &role,
            )? {
                nodes.push(value);
            }
        }
        if !nodes.is_empty() {
            node["children"] = json!(nodes);
        }
        Ok(Some(node))
    }
    fn rect(&self, object: AxRef) -> Result<Option<Rect>> {
        #[repr(C)]
        struct Pair {
            first: f64,
            second: f64,
        }
        let read = |name: &str, kind: u32| -> Result<Option<Pair>> {
            let Some(value) = self.get(object, name)? else {
                return Ok(None);
            };
            if unsafe {
                CFGetTypeID(value.0) != AXValueGetTypeID() || AXValueGetType(value.0) != kind
            } {
                return Ok(None);
            }
            let mut pair = Pair {
                first: 0.0,
                second: 0.0,
            };
            if unsafe { AXValueGetValue(value.0, kind, (&mut pair as *mut Pair).cast()) } == 0 {
                return Ok(None);
            }
            Ok(Some(pair))
        };
        let (Some(position), Some(size)) = (read("AXPosition", 1)?, read("AXSize", 2)?) else {
            return Ok(None);
        };
        let rect = Rect {
            x: position.first,
            y: position.second,
            width: size.first,
            height: size.second,
        };
        Ok(rect.valid().then_some(rect))
    }
    fn supported_action(&self, object: AxRef, name: &str) -> Result<Cf> {
        self.guard()?;
        let mut names = ptr::null();
        ax_result(unsafe { AXUIElementCopyActionNames(object, &mut names) })?;
        let names = Cf::owned(names)?;
        if unsafe { CFGetTypeID(names.0) != CFArrayGetTypeID() } {
            return Err(DriverError::unsupported());
        }
        let count = unsafe { CFArrayGetCount(names.0) };
        if !(0..=128).contains(&count) {
            return Err(DriverError::unsupported());
        }
        for index in 0..count {
            let candidate = Cf::retain(unsafe { CFArrayGetValueAtIndex(names.0, index) })?;
            if candidate
                .text()
                .is_some_and(|(text, omitted)| !omitted && text == name)
            {
                return Cf::string(name);
            }
        }
        Err(DriverError::unsupported())
    }
    fn selection_candidate(&mut self, object: AxRef, choice: &SelectionChoice) -> Result<Cf> {
        self.require_settable(object, "AXSelectedChildren")?;
        let mut truncated = false;
        let candidates = self.children(object, 10000, &mut truncated)?;
        if truncated {
            return Err(DriverError::unsupported());
        }
        let mut matches = Vec::new();
        for (index, candidate) in candidates.into_iter().enumerate() {
            let mut pid = 0;
            ax_result(unsafe { AXUIElementGetPid(candidate.0, &mut pid) })?;
            if pid != self.pid {
                return Err(DriverError::stale());
            }
            let identity = self.registry.id(candidate.0)?;
            if self.sensitive.contains(&identity)
                || self.text(candidate.0, "AXSubrole")?.as_deref() == Some("AXSecureTextField")
            {
                continue;
            }
            let selected = match choice {
                SelectionChoice::Index(expected) => index == *expected,
                SelectionChoice::Value(expected) => {
                    self.text(candidate.0, "AXIdentifier")?.as_ref() == Some(expected)
                }
                SelectionChoice::Label(expected) => {
                    let title = self
                        .text(candidate.0, "AXTitle")?
                        .filter(|text| !text.is_empty());
                    let description = self
                        .text(candidate.0, "AXDescription")?
                        .filter(|text| !text.is_empty());
                    title.or(description).as_ref() == Some(expected)
                }
            };
            if selected {
                matches.push(candidate);
            }
        }
        if matches.len() != 1 {
            return Err(DriverError::new(
                "NOT_ACTIONABLE",
                "option is absent or ambiguous",
            ));
        }
        let candidate = matches.pop().expect("exactly one option");
        if self.boolean(candidate.0, "AXEnabled")? != Some(true) {
            return Err(DriverError::new(
                "NOT_ACTIONABLE",
                "option enabled state is false or unknown",
            ));
        }
        Ok(candidate)
    }
    fn resolve_action(&mut self, id: &str, action: &Action) -> Result<(AxRef, String)> {
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
        if !matches!(action, Action::ScrollIntoView)
            && self
                .boolean(object, "AXEnabled")?
                .is_none_or(|value| !value)
        {
            return Err(DriverError::new(
                "NOT_ACTIONABLE",
                "accessible control is disabled",
            ));
        }
        if !matches!(action, Action::ScrollIntoView)
            && self
                .visibility
                .get(&index)
                .is_none_or(|value| value.hidden())
        {
            return Err(DriverError::new(
                "NOT_ACTIONABLE",
                "control visibility is hidden or unverified",
            ));
        }
        if !matches!(action, Action::ScrollIntoView) {
            if self.boolean(object, "AXHidden")? == Some(true)
                || self.boolean(self.application.0, "AXHidden")? != Some(false)
            {
                return Err(DriverError::new(
                    "NOT_ACTIONABLE",
                    "control or application is hidden or unverified",
                ));
            }
            if let Some(window) = self.get(object, "AXWindow")? {
                if unsafe { CFGetTypeID(window.0) != AXUIElementGetTypeID() }
                    || self.boolean(window.0, "AXMinimized")? != Some(false)
                {
                    return Err(DriverError::new(
                        "NOT_ACTIONABLE",
                        "window visibility is hidden or unverified",
                    ));
                }
            }
        }
        Ok((object, role))
    }
    fn require_settable(&self, object: AxRef, name: &str) -> Result<()> {
        self.guard()?;
        let key = Cf::string(name)?;
        let mut settable = 0;
        ax_result(unsafe { AXUIElementIsAttributeSettable(object, key.0, &mut settable) })?;
        if settable == 0 {
            Err(DriverError::unsupported())
        } else {
            Ok(())
        }
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
        self.visibility.clear();
        self.text_budget = ObservationBudget::new(4 * 1024 * 1024);
        let mut seen = HashSet::new();
        let mut truncated = false;
        let application = Cf::retain(self.application.0)?;
        let child = self.node(
            application.0,
            0,
            &mut seen,
            &mut truncated,
            None,
            false,
            None,
            "",
        )?;
        truncated |= self.text_budget.exhausted();
        self.current_ids = seen;
        Ok(
            json!({"root":{"ref":{"id":"desktop-root","revision":""},"role":"application","children":child.into_iter().collect::<Vec<_>>()},"viewport":{"width":self.viewport.0,"height":self.viewport.1},"truncated":truncated}),
        )
    }
    fn supports_actionability(&self) -> bool {
        true
    }
    fn preflight(&mut self, id: &str, action: &Action) -> Result<()> {
        let (object, role) = self.resolve_action(id, action)?;
        match action {
            Action::SelectOption(choice) => {
                self.selection_candidate(object, choice)?;
            }
            Action::Tap => {
                self.supported_action(object, "AXPress")?;
            }
            Action::ScrollIntoView => {
                self.supported_action(object, "AXScrollToVisible")?;
            }
            Action::Fill { .. } | Action::Clear => {
                if !["AXTextField", "AXTextArea", "AXComboBox"].contains(&role.as_str()) {
                    return Err(DriverError::unsupported());
                }
                self.require_settable(object, "AXValue")?;
            }
            Action::Focus => self.require_settable(object, "AXFocused")?,
            Action::Check | Action::Uncheck => {
                if !["AXCheckBox", "AXSwitch", "AXRadioButton"].contains(&role.as_str()) {
                    return Err(DriverError::unsupported());
                }
                let desired = matches!(action, Action::Check);
                let checked = self
                    .boolean(object, "AXValue")?
                    .ok_or_else(DriverError::unsupported)?;
                if checked != desired {
                    if role == "AXRadioButton" && !desired {
                        return Err(DriverError::unsupported());
                    }
                    self.supported_action(object, "AXPress")?;
                }
            }
        }
        Ok(())
    }
    fn perform(&mut self, id: &str, action: &Action) -> Result<()> {
        let (object, role) = self.resolve_action(id, action)?;
        match action {
            Action::SelectOption(choice) => {
                let candidate = self.selection_candidate(object, choice)?;
                let values = [candidate.0];
                // The retained candidate outlives this synchronous AX call; the array never owns it.
                let array = Cf::owned(unsafe {
                    CFArrayCreate(ptr::null(), values.as_ptr(), 1, ptr::null())
                })?;
                self.set(object, "AXSelectedChildren", array.0)
            }
            Action::ScrollIntoView => {
                let scroll = self.supported_action(object, "AXScrollToVisible")?;
                ax_mutation_result(unsafe { AXUIElementPerformAction(object, scroll.0) })
            }
            Action::Tap => {
                let press = self.supported_action(object, "AXPress")?;
                ax_mutation_result(unsafe { AXUIElementPerformAction(object, press.0) })
            }
            Action::Fill { value, sensitive } => {
                if !["AXTextField", "AXTextArea", "AXComboBox"].contains(&role.as_str()) {
                    return Err(DriverError::unsupported());
                }
                if *sensitive {
                    let identity = self.registry.id(object)?;
                    self.sensitive.insert(identity);
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
                if !["AXCheckBox", "AXSwitch", "AXRadioButton"].contains(&role.as_str()) {
                    return Err(DriverError::unsupported());
                }
                let checked = self
                    .boolean(object, "AXValue")?
                    .ok_or_else(DriverError::unsupported)?;
                let desired = matches!(action, Action::Check);
                if checked == desired {
                    return Ok(());
                }
                if role == "AXRadioButton" && !desired {
                    return Err(DriverError::unsupported());
                }
                let press = self.supported_action(object, "AXPress")?;
                ax_mutation_result(unsafe { AXUIElementPerformAction(object, press.0) })?;
                // Never repeat a toggle whose state transition has not been observed.
                let deadline = Instant::now() + Duration::from_millis(500);
                loop {
                    if self.boolean(object, "AXValue").ok().flatten() == Some(desired) {
                        return Ok(());
                    }
                    if Instant::now() >= deadline {
                        return Err(DriverError::new(
                            "ACTION_MAY_HAVE_COMMITTED",
                            "checked state was not confirmed after mutation",
                        ));
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
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
