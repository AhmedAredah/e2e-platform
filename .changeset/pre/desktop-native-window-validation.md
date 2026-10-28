---
"@e2e-platform/native": patch
---

Confirm explicit Qt window activation before acknowledging success. Separate
macOS offscreen/Basic and Cocoa/native-style qualification, and add Windows
native-window acceptance. Keep completed UIA subtree aliases from incorrectly
marking a complete snapshot truncated while preserving cycle and size limits.
Handle transient read-only AX startup failures and Linux process-exit races in
the live verification tools.
