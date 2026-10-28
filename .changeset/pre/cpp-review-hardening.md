---
"@e2e-platform/cpp": minor
"@e2e-platform/core": patch
"@e2e-platform/checks": patch
"@e2e-platform/protocol": patch
"@e2e-platform/native": patch
"@e2e-platform/terminal": patch
---

Harden C++ assertions and completion using authoring protocol 2; rebuild C++ SDK clients with the matching host. Preserve numeric fidelity, reject silent JSON coercion, add locator assertion labels, retain failed-cleanup ownership, bound terminal metadata, and merge Windows environment overrides case-insensitively. Native Qt fixes and stricter installation/qualification checks accompany this prerelease. Platform qualification remains an explicit release gate.
