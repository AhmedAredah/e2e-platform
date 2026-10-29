---
"@e2e-platform/native": patch
---

Stop Qt bridge socket callbacks before member destruction to prevent shutdown heap corruption. Drain the shutdown reply through an orderly socket close before quitting. Add connected-client application-exit and repeated Quick capture/shutdown regressions.
