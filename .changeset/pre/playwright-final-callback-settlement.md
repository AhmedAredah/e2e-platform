---
'@e2e-platform/playwright': patch
---

Settle route and dialog callbacks that have already started before the final test verdict and after context cleanup. Preserve their attempt-owned errors when no later browser operation observes them, report each latched error once, and bound the entire settlement by one cancellation-aware cleanup deadline.
