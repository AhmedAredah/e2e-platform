---
"@e2e-cpp/core": minor
"@e2e-cpp/process": minor
"@e2e-cpp/checks": minor
"@e2e-cpp/protocol": minor
"@e2e-cpp/native": minor
"@e2e-cpp/terminal": minor
"@e2e-cpp/playwright": patch
"@e2e-cpp/agent-device": patch
"@e2e-cpp/github": patch
"@e2e-cpp/oauth": patch
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
