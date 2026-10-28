---
"@e2e-platform/native": patch
---

Drain a timed-out read under its original request ID before dispatching later operations. This preserves failure collection when a polling assertion exhausts its budget. Queued calls remain bounded; cancellation, malformed replies and uncertain mutations retain fail-closed behavior.
