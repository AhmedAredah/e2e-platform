# @e2e-platform/authoring

Shared bounded host for C++ and Python authored tests. Language registration
packages discover cases, then delegate execution to `AuthoredTestHost` using the
same runner scheduler, lifecycle, reports and engine contracts.

The protocol dispatcher accepts a closed operation allowlist. Its resource
dispatcher owns opaque child handles and calls public process/terminal/native
fixtures. Core never imports this host or an engine implementation. Protocol,
numeric JSON validation, dispatch, resource ownership and registration live in
separate modules for future language clients.

Frames are bounded, operations are ordered, and host failures are latched.
An exit code cannot erase a failed assertion, malformed reply or incomplete case.
No uncertain mutation is automatically replayed. Use `@e2e-platform/cpp` or
`@e2e-platform/python` for application tests. The package does not sandbox test code.
