---
'@e2e-cpp/core': patch
---

Prevent stale locator references from passing hidden assertions, give one-shot
visibility reads the normal operation budget, and preserve exact whitespace in
input-value and attribute assertions. Keep normalized text and class-list
matching unchanged. Support stateful inherited classes for nested engine hooks
while continuing to reject unknown keys in plain-object manifests.
