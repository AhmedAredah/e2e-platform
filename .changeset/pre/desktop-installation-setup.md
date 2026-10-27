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

Add an explicit macOS terminal setup command for the node-pty 1.1.0 helper
permission defect, preserving shared package-store copies and private file modes.
Terminal startup checks the active helper without changing installed files.
Verify installation and direct Node execution in paths containing spaces and
ampersands, then qualify npm's installed commands from a conventional path.
Document the Windows npm command-shim limitation and direct Node fallback.
