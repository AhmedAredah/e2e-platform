---
"@e2e-cpp/native": patch
---

Keep Qt sensitive-fill masking in helper-owned object lifetime state, reject covered Qt Quick pointer targets before dispatch, and omit whole oversized or NUL-containing source text fields so later secret redaction cannot receive partial values. Add native regression coverage for security-marker restrictions, lifetime reuse, screenshot masking, visual overlays and pointer grabs.
