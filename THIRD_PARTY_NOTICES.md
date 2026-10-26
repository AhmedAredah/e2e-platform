# Third-party notices

The MIT license for this project applies to its own covered source code.
Other software used to build, install, or run it retains its original license.
This file records important boundaries and source attributions. It does not
replace the license files supplied by each dependency or provide a complete
inventory of an application's eventual binary bundle.

## Upstream e2e

This fork includes code from
[`tester-army/e2e`](https://github.com/tester-army/e2e), based on MIT revision
`e9c2914c6d8f8d664d820b13a1fa454e9247e94b` of September 20, 2026.

Copyright (c) 2026 TesterArmy, Inc.

The MIT permission and warranty terms are preserved in [LICENSE](LICENSE)
and in the inherited publishable packages. Source origin and the boundary
with later upstream work are described in
[the licensing record](docs/development/LICENSING.md).

## Runtime and optional components

| Component | Relationship to this project | License boundary |
| --- | --- | --- |
| Qt 6 | The optional test helper links to the application's Qt installation. | Qt modules use their own LGPL, GPL, commercial, and third-party terms. Check the modules and linking/distribution arrangement actually used. [Qt licensing](https://doc.qt.io/qt-6/licensing.html). |
| Node.js and npm dependencies | The TypeScript runner uses a separately installed Node.js runtime and package dependencies. | Retain the licenses and notices from the exact packages and runtime distributed. [Node.js license](https://github.com/nodejs/node/blob/main/LICENSE). |
| `@xterm/headless` and `@xterm/addon-unicode11` | The terminal engine uses xterm.js packages for terminal state and Unicode handling. | The project license is MIT. Preserve its license and any package-specific notices. [xterm.js license](https://github.com/xtermjs/xterm.js/blob/master/LICENSE). |
| `node-pty` | Optional native PTY provider for terminal tests. | The main project license is MIT; retain the complete license and bundled notices supplied by the installed package. [node-pty license](https://github.com/microsoft/node-pty/blob/main/LICENSE). |
| Playwright and browser binaries | The retained web engine uses separately installed Playwright packages and browsers. | Playwright uses Apache-2.0; browsers and bundled components have additional licenses. This dependency does not change this fork's own MIT grant. [Playwright license](https://github.com/microsoft/playwright/blob/main/LICENSE). |
| Model providers, device tools, and optional integrations | Selected by configuration or installed as dependencies for the relevant engine. | Their code, services, credentials, and usage terms are separate from this repository's license. |

An npm install or a native package manager normally supplies dependency
license files alongside installed code. If building a standalone executable,
installer, container, or offline dependency bundle, collect the notices and
source/relinking materials required by the exact included components. A link
to this table is not a substitute for required license text or source offers.

## Inherited development material

The MIT base records external developer-skill origins in `skills-lock.json`:

- `unbox-ai` comes from [tester-army/unbox-ai](https://github.com/tester-army/unbox-ai).
  Its MIT license, including `Copyright (c) 2026 Oskar Kwasniewski`, is retained
  beside the [vendored skill](.claude/skills/unbox-ai/LICENSE).
- `unslop` comes from [okwasniewski/dotfiles](https://github.com/okwasniewski/dotfiles).
  This fork inherits the copy that Oskar Kwaśniewski added to the MIT-licensed
  e2e repository in commit
  [`2e5e783d2d3457544470b1533aba47fccb6b2081`](https://github.com/tester-army/e2e/commit/2e5e783d2d3457544470b1533aba47fccb6b2081).
  That is the recorded source basis; the current dotfiles repository does not
  supply a standalone license, so this notice does not label that entire
  external repository as MIT.

Their recorded origin metadata is preserved for attribution. They are
developer guidance, not runtime dependencies. This fork does not claim
ownership of those source projects or their names.

The inherited benchmark documentation identifies scenarios copied from
TesterArmy's benchmark projects. Preserve those source acknowledgments when
moving or modifying the benchmarks. Example application assets and any
future copied material must retain their own applicable notices.


## Desktop accessibility sidecars (0.2.0-rc.1)

The newly written driver and fixture source in `native/linux-atspi`,
`native/windows-uia`, `native/macos-ax` and `examples/with-desktop` is MIT.
Python uses separately installed GNOME AT-SPI/PyGObject/GTK system components;
C# uses separately installed .NET/Windows UI Automation; Rust calls macOS system
frameworks and uses the locked serde/serde_json dependency graph. See each
backend's README, license and dependency notice. System/runtime libraries and
SDKs are not relicensed by the root MIT notice and are not bundled in the source
archive. Selected Cargo dependencies use their MIT or Boost Software License 1.0 options;
see the driver's dependency table and preserve their notices when distributing binaries. This statement does not
assert that every optional repository dependency has an MIT-only license.
