---
"@e2e-platform/python": patch
---

Accept Windows checkout line endings in Python version checks, revoke stale distribution manifests on packaging failures, and publish manifests atomically. Refresh the Python 3.15 build frontend, qualify explicit Qt display prerequisites, and record readiness failures in the shared report.

Pin Python GUI reference kits to Qt 6.12.0, whose Quick TextField provides the editable accessibility interface required by Linux AT-SPI. Older Qt Quick versions are not silently treated as supported.
