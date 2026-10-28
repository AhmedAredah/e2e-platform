---
"@e2e-platform/core": patch
---

Invalidate an earlier local installation kit before rebuilding or packing. Publish
its manifest atomically only after all seven package tarballs and installer
checksums are complete, so a failed attempt cannot retain a stale installable kit.
