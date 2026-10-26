---
"@e2e-platform/core": minor
"@e2e-platform/process": minor
"@e2e-platform/checks": minor
"@e2e-platform/protocol": minor
"@e2e-platform/native": minor
"@e2e-platform/terminal": minor
"@e2e-platform/playwright": patch
"@e2e-platform/agent-device": patch
"@e2e-platform/github": patch
"@e2e-platform/oauth": patch
---

Establish the MIT-based fork and local installation kit under independent package
names. Add extensible process supervision, output validators, authenticated native
transport, cooperative Qt integration, terminal sessions and bounded HTTP checks.

Integrate native launch configuration and lifecycle diagnostics with the MIT
runner, explicitly forbid model access when configured, and fail attempts on late
native faults. Protect known secrets in runner-controlled output, restored
sessions and artifacts. Omit untrusted HTTP error causes that could disclose
request contents. Include positive, planted-failure and installed-consumer checks.
Remove the upstream telemetry destination: the fork CLI collects and sends no
usage events, including when a compatibility preference is enabled.
