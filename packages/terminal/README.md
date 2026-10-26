# @e2e-platform/terminal

Run a CLI/TUI through a real PTY and reconstruct its visible terminal cells with
`@xterm/headless`. Cursor movement, erasure, wrapped lines, alternate screens,
Unicode 11 widths, resize, device-query replies, and xterm keyboard sequences are
handled by a terminal emulator rather than raw output-line matching.

```ts
// e2e.config.ts
import { terminal } from '@e2e-platform/terminal';
export default {
  modelPolicy: 'forbid',
  targets: [{ name: 'menu', engine: terminal({ columns: 80, rows: 24 }),
    app: { appPath: './build/menu', launchArguments: ['--fixture'] } }],
};
```

```ts
import { test } from '@e2e-platform/terminal';
import { expect } from '@e2e-platform/core';
test('accepts a name', async ({ terminal, screen }) => {
  await terminal.waitFor('Name:');
  await terminal.write('Ada');
  await terminal.press('Enter');
  await expect(screen.getByText('Hello, Ada')).toBeVisible();
});
```

Install the optional `node-pty` peer to use the default transport. It is a native
dependency with platform build/prebuilt requirements. A `TerminalTransport`
subclass can supply another actual terminal connection without loading node-pty.
The executable and arguments are launched directly; a shell runs only when you
explicitly choose a shell executable. `appPath` and `cwd` resolve relative to the
config directory. Each attempt launches a new process; files, services and
persisted application state must be isolated through fixtures separately.

`terminal.snapshot()` returns visible `lines`, `text`, cell `cursor`, dimensions,
alternate-screen flag, title and optional process exit. `write`, `press`, `resize`
and `waitFor` are recorded fixture operations; write arguments are omitted from
step labels. `waitFor` checks the reconstructed visible screen, has a deadline,
and stops its polling on cancellation/timeout. The raw bounded `transcript()` is
available explicitly for diagnostics and may contain application secrets.

`TerminalSession`, `TerminalEngine`, abstract `TerminalTransport`, and concrete
`NodePtyTransport` are exported. `TerminalEngine` subclasses can specialize
`createTransport`, `createSession`, and `semanticSnapshot`; the convenience
`terminal()` factory delegates to this controller. Tests exercise this extension
seam with a transport subclass and the default with an actual PTY.

`createTransport(command, dimensions, operation)` and `transportFactory(dimensions, operation)`
receive an optional abort signal and launch budget. Factories must honor cancellation.
Restart rejects overlapping transitions and pre-aborted requests before closing the current
session. Teardown invalidates in-flight launches; any transport delivered later is closed
without entering a later attempt. A non-cooperative factory cannot be forcibly interrupted;
its resources remain that factory's responsibility until it returns an owned transport.
Session cleanup attempts every subscription release, transport close and emulator
disposal even when an earlier hook throws. It reports the collected failures after
those attempts. Repeated close calls share the same result.

The engine also settles latched output-budget and terminal-response transport failures
before the test verdict and after cleanup. A fault after the last terminal operation
still fails the attempt; restarting or closing that session does not erase it.
Standalone `TerminalSession` users can call `assertHealthy()` to check a recorded fault,
including after `close()` has released its resources.

Process exits are observable data, including nonzero exits intentionally tested by a TUI
suite. The engine does not impose an expected exit code. Assert `snapshot().exit` explicitly
when the test's contract includes successful completion or a particular error exit. Writes
after exit and waits for missing screen content fail with `EXITED`; a matching final screen
can still be inspected after exit. Infrastructure faults are failures regardless of exit code.

## Capability limits

The semantic tree contains the terminal and visible text rows. It does not invent
buttons, fields, focusable subcontrols or accessibility roles from screen text.
Agents may use keyboard input and exact text assertions; pointer actions, GUI
screenshots, saved-state restore and generic field replacement are unsupported.
Meta shortcuts and keys without a portable terminal encoding fail explicitly.
Keyboard encoding follows xterm conventions; application-specific terminal
protocols and full grapheme-cluster behavior require separate qualification.

PTY output merges stdout/stderr. Default budgets are 16 MiB total raw output and
4 MiB queued parser data; exceeding either fails and closes the session. Scrollback
defaults to 500 lines. Terminal bytes and displayed text can contain sensitive
data; applications that echo credentials require appropriate test fixtures.
Cancellation stops the controller's wait; it cannot undo input already delivered.
POSIX cleanup targets the owned PTY process group. Windows uses taskkill while
the root is alive. Detached sessions, escaped groups, Windows breakaway children,
and descendants after a Windows root has exited are not guaranteed contained.

Tests: run `vitest run` from this package after building `@e2e-platform/core` and
`@e2e-platform/process`. `tests/pty.test.ts` requires the working optional native peer;
its process-group check is Linux-only. Windows/macOS code paths require actual
OS validation before support can be considered qualified.

Primary dependencies: [xterm.js](https://github.com/xtermjs/xterm.js),
[node-pty](https://github.com/microsoft/node-pty).
