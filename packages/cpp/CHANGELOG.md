# @e2e-platform/cpp

## 0.2.0-rc.7

### Minor Changes

- Add a bounded stdio adapter for tests authored with the C++17 SDK. Each compiled case runs as an owned process inside the shared runner, with semantic locators, polling assertions, HTTP operations and command execution through public extension contracts.

### Patch Changes

- Coordinate the C++ and desktop qualification candidate and its seven-package local
  installation kit. Add C++ test authoring, installed GUI consumer checks, C++ HTTP
  fixtures and explicit platform qualification gates. Keep native platform and toolkit
  limitations visible; this candidate does not establish blanket framework support.
