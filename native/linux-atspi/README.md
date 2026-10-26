# Linux AT-SPI driver (Python)

This optional MIT-licensed driver implements the existing authenticated native
bridge protocol using GNOME AT-SPI. The runner remains TypeScript; the tested
application can use Python, C#, C++, Rust, or another language **if its toolkit
exposes the required accessible controls**. Language alone does not establish
GUI support. This is an experimental backend pending a successful live desktop
qualification run; protocol/provider unit tests are not a GTK certification.

## Install and run

On an Ubuntu/Debian desktop, install the operating-system components:

```sh
sudo apt-get install python3 python3-gi gir1.2-atspi-2.0 at-spi2-core
```

Use the distribution Python interpreter that can import `gi` and `Atspi`.
Python 3.10+ syntax is supported; the unit suite was exercised with Python 3.12.
The source distribution needs no pip installation:

```sh
/usr/bin/python3 native/linux-atspi/driver.py -- /absolute/path/to/application argument
```

The framework supplies a fresh `E2E_NATIVE_TOKEN` automatically. For source
configuration, use `desktop({ backend: 'linux-atspi', executable:
'/usr/bin/python3', args: ['/absolute/path/to/driver.py'] })` from
`@e2e-platform/native`. The wrapper appends `--`, the application path and its
launch arguments. Run the framework from the intended desktop session with `DISPLAY` or
`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS` and any other
variables required by your app. The engine passes the runner-supplied environment
to the driver; the driver removes its authentication variables before target launch. A working graphical session and session/accessibility D-Bus buses
are required. Do not run the GUI app as root in a different user's session.

`pyproject.toml` also allows an optional Python package installation and creates
an `e2e-platform-atspi` console command. GI and AT-SPI remain system dependencies;
a pip installation does not install a Linux desktop, bus or toolkit.

## Controls and boundaries

| Operation | Real backend operation | Boundary |
| --- | --- | --- |
| Observe | AT-SPI names, roles, states, text, accessible ID and geometry | Only the launched PID; bounded tree with explicit truncation |
| Tap | Recognized Action click/press/activate/toggle/jump/select | Requires that semantic action; no coordinate click fallback |
| Fill / clear | EditableText `set_text_contents` | Requires editable state; this is semantic replacement, not physical key events |
| Focus | Component `grab_focus` | Requires focus support from the toolkit/session |
| Check / uncheck | Checked-state read plus at most one semantic action | Idempotent; rejects controls that fail to reach the requested state |
| Select option | Selection `select_child` | One direct child by unique accessible label or zero-based index; HTML `value` and multi-select unsupported |
| Global keyboard / screenshots | Unavailable | Never advertised, captured or fabricated |

Password controls and `e2e-secure:true` accessible attributes suppress contents,
attributes and descendants at source. Initially secure controls use the fixed
name `Secure control` and omit accessible IDs; provider-derived names can contain
contents. A sensitive fill retains only its label/ID observed before the fill and
additionally marks that
object secure for the rest of its lifetime. Providers must expose custom secret
controls correctly; this does not infer unknown secrets from arbitrary UI text.
No pixel capture is available, so unsupported screenshot masking cannot leak
unmasked pixels. The synthetic root is stable; object IDs are monotonic and
retained for live proxies, and stale/defunct objects cannot receive new actions.
A 900,000-byte aggregate metadata budget counts escaped Unicode before retaining
nodes, in addition to depth, node and per-field limits. Exhaustion marks the
snapshot truncated; it cannot establish a control's absence.

The sidecar waits for the owned application to expose an accessible tree before
announcing protocol readiness. The application is launched with an argv list and no shell. Its environment
excludes the bridge token and port. Output is not forwarded to the protocol.
The sidecar owns its child process group and terminates it on EOF, shutdown,
protocol failure or termination signal. Linux parent-death handling covers the
direct child if the driver is killed abruptly. This is **not** cgroup containment:
processes that deliberately daemonize or escape the owned process group require
external isolation. Forked GUI worker PIDs and unrelated apps are not enumerated.

The driver uses GNOME semantic accessibility calls. It does not claim native
pointer input, IME/keyboard fidelity, WebView DOM access, every GUI toolkit,
virtualized item realization, nested compositor surfaces, or Wayland screenshot
and input portal integration. A driver-wide capability still requires a matching
interface on the specific control; unsupported combinations raise explicit errors.

## Extension structure

- `contracts.py`: abstract `AccessibilityProvider` and safe typed errors.
- `provider.py`: concrete `AtspiProvider`, identity/state/security mapping.
- `protocol.py`: closed request validation, framing and authentication.
- `application.py`: overridable provider factory and owned process lifecycle.
- `driver.py`: source entrypoint.
- `tests/`: protocol/provider contracts plus a separate real GTK acceptance test.

## Verification

```sh
python3 -m unittest discover -s native/linux-atspi/tests -v
sudo apt-get install gir1.2-gtk-3.0 xvfb xauth
# Run from the repository root on a host that permits D-Bus and X11 sockets:
dbus-run-session -- xvfb-run -a /usr/bin/python3 native/linux-atspi/tests/live_smoke.py
```

The live suite launches the real Python GTK3 fixture, reads accessible controls,
redacts a password, fills/clears text, focuses, checks/unchecks idempotently,
selects a list item, invokes a button and checks its resulting label. It then
repeats against deliberately wrong application output and verifies rejection.
Missing GI/display/bus support fails the live command; it is never reported as
a passed or silently skipped desktop test. This development host denies AF_UNIX
sockets, and `dbus-run-session -- /bin/true` fails before any GUI runs. Therefore
live GTK/AT-SPI behavior has **not** been qualified here.

API references: [GNOME AT-SPI](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/index.html),
[Action](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/method.Action.do_action.html),
[EditableText](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/method.EditableText.set_text_contents.html),
[Selection](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/iface.Selection.html).
System libraries retain their own licenses; they are not relicensed by this driver.
