---
"@e2e-platform/native": patch
---

Raise inactive Qt Widgets windows before requesting keyboard activation, including
when another application owns foreground focus on Cocoa. Confirm activation before
typing and preserve terminal failure when the operating system denies the request.
