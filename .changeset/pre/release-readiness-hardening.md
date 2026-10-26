---
'@e2e-platform/core': patch
'@e2e-platform/process': patch
'@e2e-platform/checks': patch
'@e2e-platform/protocol': patch
'@e2e-platform/native': patch
'@e2e-platform/terminal': patch
'@e2e-platform/playwright': patch
'@e2e-platform/agent-device': patch
'@e2e-platform/github': patch
'@e2e-platform/oauth': patch
---

Prepare the independent AhmedAredah/e2e-platform prerelease with canonical package
metadata, corrected CI pins and source-build instructions, and complete inherited
license attribution. Preserve descendant cleanup and serialize MCP session teardown;
omit oversized terminal fields without leaking secret prefixes, and reject malformed
UTF-8 at native and HTTP JSON boundaries. Harden desktop mutation uncertainty,
password lifetime redaction, selection authorization and serialized response budgets.
Native operating-system live qualification remains a release gate.

Also treat missing semantic values as unknown in positive and negated assertions,
serialize startup/disposal cleanup, recognize Android password metadata, and
withhold non-atomic secure mobile screenshots. Browser observations omit oversized
fields whole. GitHub and OAuth failures no longer expose response or parser content.
