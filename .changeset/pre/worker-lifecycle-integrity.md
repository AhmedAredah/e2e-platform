---
"@e2e-cpp/core": patch
---

Require acknowledged engine disposal within the configured cleanup budget,
quarantine failed attempt cleanup before more work or setup publication, and
represent cleanup and shared-session failures in JUnit. Session storage keys
now distinguish target/name tuples containing separators.
