---
"@e2e-platform/native": patch
---

Recheck the request deadline when a native transport timer fires early. A callback before the declared deadline no longer closes a valid connection or replaces the final observed assertion mismatch with a premature timeout. Read timeouts and uncertain mutation outcomes remain distinct, and mutations are never replayed.
