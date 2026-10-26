---
"@e2e-platform/core": patch
---

Stop repeated assertion and locator-wait observations at their deadline, preserving a known mismatch instead of issuing an expired backend request. Keep immediate initial observations and short negation grace windows, while propagating genuine backend failures unchanged.
