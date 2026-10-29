# Qt bridge shutdown corruption

## Defect and correction

The C++ Qt bridge had an object-lifetime defect during shutdown with a connected
controller. `BridgeServer` declared its `QTcpServer` before its connection state.
C++ destroys members in reverse declaration order, so the `client` QPointer and
`pending` byte buffer were destroyed before the server and its child sockets.

An open socket can emit `disconnected` as it is destroyed. The bridge's callback
still had a live QObject context at that point: the `QObject` base destructor,
which automatically disconnects receivers, had not run yet. The callback could
therefore read or clear already-destroyed members. This is undefined behavior
and can corrupt the heap. It affects the cooperative C++ helper, independently
of whether its application uses Widgets or Quick.

The correction in
[`5fc0c237fe7182e89ada43a171ab477ed8fa5d75`](https://github.com/AhmedAredah/e2e-platform/commit/5fc0c237fe7182e89ada43a171ab477ed8fa5d75)
adds an explicit `BridgeServer` destructor. It disconnects server and socket
callbacks to the bridge, closes the listener, then aborts and deletes remaining
accepted sockets while all bridge members still exist. Closing the server first
preserves its ownership of unaccepted pending connections and avoids deleting
those sockets twice. Public APIs and the wire protocol are unchanged.

Cross-platform regression testing exposed a second shutdown defect: quitting
immediately after `write()` could discard the acknowledgement before Qt had
drained it, consistently failing the new Windows shutdown cases. The completed
correction at
[`06ea9f8b69d605a8e9b679cee8e51b0c7bfb1a05`](https://github.com/AhmedAredah/e2e-platform/commit/06ea9f8b69d605a8e9b679cee8e51b0c7bfb1a05)
stops accepting work, requests an orderly socket disconnect, and quits once the
connection closes. Qt drains pending writes during that disconnect. A two-second
deadline exits with infrastructure failure if closure cannot complete; there is
no blocking GUI-thread wait and no delay used to disguise a crash.

This follows Qt's documented
[signal delivery during destruction](https://doc.qt.io/qt-6.8/signalsandslots.html#automatic-connection-management).
The relevant Qt 6.8.3 implementations are
[`QAbstractSocket::~QAbstractSocket`](https://github.com/qt/qtbase/blob/v6.8.3/src/network/socket/qabstractsocket.cpp)
and [`QTcpServer::close`](https://github.com/qt/qtbase/blob/v6.8.3/src/network/socket/qtcpserver.cpp).
No third-party implementation was copied into the fix.

## Reproduction and actual crash evidence

The original failure at `0e9ae2d50fb66a9dd53d18473c42766c43dfb905` correctly
rejected a planted Quick calculation error, then aborted during cleanup. That
converted assertion failure (exit 1) into infrastructure failure (exit 3).
The old diagnostic ran a different executable and could not explain this crash.

The new `scripts/native/verify-qt-shutdown.py` launches the actual
`e2e_qt_quick_demo --bad-calculation`, authenticates, taps Calculate, waits for
the semantic result, captures pixels and a screenshot, requests shutdown, and
checks the process's actual exit. It varies client closure between 0, 5 and
50 milliseconds after the shutdown reply. These timings exercise lifecycle
ordering; no failed cycle is retried or counted as a pass.

Three unchanged-runtime macOS Cocoa probes failed on their first cycle:

| Source | Hosted run | Result |
| --- | --- | --- |
| `355334c1de44d0e91d4067b76dc24ecfdbc7a84d` | [40880605529](https://github.com/AhmedAredah/e2e-platform/actions/runs/40880605529) | Actual Quick fixture exited with SIGABRT |
| `92d59dcbed22b974ff7b94a45c1a37ab1d756f5c` | [40881302293](https://github.com/AhmedAredah/e2e-platform/actions/runs/40881302293) | Same abort; initial debugger deadline was insufficient |
| `37d93edc121719bc51d2809e80f04015a2890210` | [40881945571](https://github.com/AhmedAredah/e2e-platform/actions/runs/40881945571) | Same abort; LLDB captured the actual fixture's fatal signal |

The last archive is
[12900877469](https://github.com/AhmedAredah/e2e-platform/actions/runs/40881945571/artifacts/12900877469),
verified SHA-256
`3758cd0f42260316183a1cb31af4cadd2d0a2ab3fc62db3f143b0756cd81d62a`.
Its ordinary qualification records `returnCode: -6`, `forcedCleanup: false`,
and `lastOperation: shutdown`. Its LLDB output reports a shared QObject deletion
warning, an incorrect checksum for freed memory and SIGABRT. The debugger's
wrapper exit was zero; the harness correctly treated the observed fatal signal
as failure anyway.

The allocator detected damage in a QuartzCore fence observer while the main
thread was destroying the Quick window through Cocoa and the QML engine. Those
frames identify where corruption was detected, not where memory was originally
misused. The bridge ownership defect, Qt's destruction behavior and the
before/after reproduction establish the correction; this report does not
attribute a new defect to QuartzCore.

Linux Qt 6.4.2 Release/offscreen also reproduced SIGABRT on cycle 3, with
`corrupted double-linked list`. AddressSanitizer builds did not reproduce the
failure; they are not evidence of either detection or absence of this defect.

## Regression coverage and validation

- Four C++ protocol cases require a normal zero exit after shutdown with the
  controller held open, closed immediately, closed after 5 ms, or after 50 ms.
- A separate application-owned Quit button test keeps the controller connected
  while the bridge is destroyed, independently of the orderly shutdown RPC.
- The repeated Quick lifecycle test requires every requested cycle to complete.
  Timeouts, forced cleanup, RPC failures and abnormal exits fail qualification.
- Both process pipes are drained, diagnostic buffers and protocol frames are
  bounded, and POSIX forced cleanup owns the fixture/debugger process group.
- The focused `qt-lifecycle` workflow runs Cocoa/macOS style with Qt 6.8.3.
  Failure diagnostics run the actual Quick fixture under LLDB.
- The existing native Cocoa job also runs 60 lifecycle cycles. The release
  workflow depends on that native workflow, so this regression gates its kit.

Local validation of the lifetime correction: all 100 Quick lifecycle cycles
passed without forced cleanup; all five CTest suites passed (calculator,
protocol, privacy, Widgets controls, Quick controls). This used Linux x86_64,
Qt 6.4.2, offscreen software rendering and Basic style.
After adding acknowledgement draining, all five suites passed again, including
28 protocol cases, and a further 60 Quick lifecycle cycles exited cleanly.
An isolated copy of the final source with only the explicit bridge destructor
replaced by its old default destructor failed the new application-exit test on
its first attempt: the child reported `CrashExit` instead of `NormalExit`.
The corrected source passed that same test. This confirms the regression
detects the lifetime defect independently of the orderly shutdown RPC.

Hosted macOS 15.7.9 arm64 / Qt 6.8.3 / Cocoa / macOS-style validation at the
initial lifetime correction passed on the first attempt:
[run 40883104817](https://github.com/AhmedAredah/e2e-platform/actions/runs/40883104817/job/123479571636).
All 60 lifecycle cycles exited zero, with no errors or forced cleanup. The
protocol suite passed in both normal and `AA_MacDontSwapCtrlAndMeta` modes;
the Quick controls suite also passed. The downloaded
[artifact 12900953351](https://github.com/AhmedAredah/e2e-platform/actions/runs/40883104817/artifacts/12900953351)
matches SHA-256
`1adce1d07a34dfe808abc8e96125f76d5e3551c6fcf15822a25c974c827e6bf0`.
Its qualification JSON was checked for exact source, required cycle count,
shutdown completion and all 60 clean exits.

The completed correction at `06ea9f8b69d605a8e9b679cee8e51b0c7bfb1a05`
also passed all 60 cycles, both protocol variants (including application-owned
exit) and Quick controls on its first focused run:
[40886089024](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886089024/job/123490069932).
The downloaded
[artifact 12901654841](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886089024/artifacts/12901654841)
matches SHA-256
`4e0d18ce7e40be32e7d6406713f315e5e7fdf3e184870982f4ed95e23deb845c`.
Its exact source and all 60 zero exits with no forced cleanup were verified.

The complete pull-request qualification passed all 48 required jobs on the
first attempt for final head `06ea9f8b69d605a8e9b679cee8e51b0c7bfb1a05`.
The checkout used merge commit `6b96b6b79a08be53367f0be109533873a2b86b4a`,
whose tree `0031e3a5f015cbe3f4e0fd2b5e2e4986a1671bbb` was verified identical
to that head. The optional live-model benchmark was not invoked.

| Workflow | Required jobs passed |
| --- | --- |
| [native](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097677) | 9 / 9 |
| [qt-lifecycle](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097518) | 1 / 1 |
| [python](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097516) | 25 / 25 |
| [desktop-contracts](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097733) | 5 / 5 |
| [languages](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097652) | 3 / 3 |
| [spec](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097816) | 3 / 3 |
| [docs](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097743) | 1 / 1 |
| [benchmark](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097564) | 1 / 1 |

The full native Cocoa
[artifact 12904686022](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097677/artifacts/12904686022)
was downloaded and verified against SHA-256
`07a18958bc83f1c17294e45aa3d0c483d9c0067272fb1dff5d0501fec84bdfb6`.
It confirms 60 further clean lifecycle exits, 28 protocol cases in each macOS
modifier mode, and all eight installed static/shared Widgets/Quick positive and
planted-defect cases with complete cleanup. All 25 retained run reports have
one attempt per selected test, no run-level errors and no secondary cleanup errors.

The native Windows
[artifact 12902029797](https://github.com/AhmedAredah/e2e-platform/actions/runs/40886097677/artifacts/12902029797)
was independently downloaded and verified against SHA-256
`ce43e3508a1dc3e8b9a8e0fd1c7713244e15d751e21bec6e5960c969aa3be567`.
All 28 protocol cases and eight installed static/shared reference cases pass
their intended verdicts with complete cleanup. Both Windows display profiles,
both Linux profiles and both macOS profiles passed the full native workflow.

The crash collector's three tests and all 75 maintenance tests passed locally;
local documentation navigation and links passed for 52 pages.

The wider run exposed a separate pre-existing race in the C++ protocol test
client: its RPC reader waited for another `readyRead` signal before consuming
bytes that could already have arrived during `waitForBytesWritten`, or together
with EOF. It could therefore report a missing shutdown reply even when the
application sent one. The reader now drains buffered data before waiting and
after a disconnect, retaining the same complete-frame, response-ID and clean-exit
assertions. Explicit Qt Test XML logs preserve assertion details on Windows.
This test-client correction alone did not resolve Windows: all four shutdown
rows still failed, confirming the need for production acknowledgement draining.
No production failure verdict is relaxed.

## Applying the correction

Rebuild the C++ Qt helper from the corrected source using the application's Qt
kit. Reinstall an exported helper with the commands in
[`native/qt/README.md`](../../native/qt/README.md), then rebuild and relink the
application's test executable. Existing statically linked executables retain
the old code until rebuilt. An npm or Python client update alone does not
replace a previously compiled native helper.

## Scope

This correction changes the C++ Qt helper's teardown, not the Python Qt/AX
backend, browser engines or mobile engines. Successful named profiles do not
qualify every Qt version, graphics backend, custom control or desktop toolkit.
The project remains a source-installable prerelease; no registry publication or
stable release is declared by this fix.
