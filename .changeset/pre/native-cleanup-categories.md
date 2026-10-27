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

Prepare a coordinated candidate with bounded macOS process-group shutdown
retries and safe recognition of the pnpm 12 Windows launcher. Preserve failures
for persistent permission denial and invoke package managers without a shell.
Identify native cleanup failures by fixed lifecycle stages and recognized
system error codes without exposing arbitrary extension error messages or data.
Synchronize terminal overflow qualification after the final test operation and
record hosted browser/CDP and language evidence separately from unrun GUI gates.
