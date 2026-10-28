---
"@e2e-platform/core": patch
"@e2e-platform/native": patch
---

Preserve unavailable desktop visibility, enabled and focused states with optional semantic flags. Reads, filtered queries, waits and positive or negated assertions no longer treat unknown platform state as proof that a control is hidden, absent, disabled or unfocused.
