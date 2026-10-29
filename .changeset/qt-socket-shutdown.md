---
"@e2e-platform/native": patch
---

Stop Qt bridge socket callbacks before member destruction to prevent shutdown heap corruption. Add connected-client and repeated Quick capture/shutdown regressions.
