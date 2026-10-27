---
"@e2e-platform/native": patch
---

Check Windows UIA controls against current window and scroll-container geometry
before acknowledging actionability, preserving unknown visibility explicitly.
Exercise actual WPF ScrollItem providers and AppKit selectable/scrollable control
extensions. Correct the AX verifier's required fill fields and wait for the
asynchronous native Cocoa dialog-close result in the Qt protocol regression.
