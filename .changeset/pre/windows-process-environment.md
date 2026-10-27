---
"@e2e-platform/agent-device": patch
"@e2e-platform/checks": patch
"@e2e-platform/core": patch
"@e2e-platform/github": patch
"@e2e-platform/native": patch
"@e2e-platform/oauth": patch
"@e2e-platform/playwright": patch
"@e2e-platform/process": patch
"@e2e-platform/protocol": patch
"@e2e-platform/terminal": patch
---

Qualify a coordinated candidate with corrected Windows process environment isolation,
GI-qualified Linux AT-SPI text access, sanitized startup diagnostics, portable path
checks, and deterministic planted-defect verification. Retain Windows SystemRoot
for OS initialization unless explicitly overridden or removed.
