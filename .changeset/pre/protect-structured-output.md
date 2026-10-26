---
"@e2e-platform/core": patch
"@e2e-platform/native": patch
---

Preserve worker verdicts and public protocol grammar while redacting confidential data, and deliver complete MCP responses independently of console buffering. Keep report/event identities coherent, validate worker control messages, and redact before clipping diagnostic text. Native observations now omit oversized fields whole rather than exposing partial secret values.
