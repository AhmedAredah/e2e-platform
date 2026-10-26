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

## Pi context-overflow detection

The inherited `packages/e2e/src/agent/model/overflow.ts` adapts provider-error
patterns from [Pi](https://github.com/earendil-works/pi), formerly
`badlogic/pi-mono`. Pi is MIT-licensed, copyright (c) 2025 Mario Zechner.
The full copyright and permission notice is retained in
[the core package's NOTICE](packages/e2e/NOTICE) and included in that package's
distribution. The comparison source and license are pinned there to revision
`32850ef7c5edff7a6eee0214516fbb7382bf292d`, which predates the upstream e2e
contribution. This records inherited attribution; it does not import current Pi code.

## Code of Conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) adapts Contributor Covenant 2.1,
licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Its attribution, source link, license link, and note of the fork's reporting
changes are retained in that document. This documentation has separate terms
from the MIT source code.

## Runtime and optional components

| Component | Relationship to this project | License boundary |
| --- | --- | --- |
| Qt 6 | The optional test helper links to the application's Qt installation. | Qt modules use their own LGPL, GPL, commercial, and third-party terms. Check the modules and linking/distribution arrangement actually used. [Qt licensing](https://doc.qt.io/qt-6/licensing.html). |
| Node.js and npm dependencies | The TypeScript runner uses a separately installed Node.js runtime and package dependencies. | Retain the licenses and notices from the exact packages and runtime distributed. [Node.js license](https://github.com/nodejs/node/blob/main/LICENSE). |
| `@xterm/headless` and `@xterm/addon-unicode11` | The terminal engine uses xterm.js packages for terminal state and Unicode handling. | The project license is MIT. Preserve its license and any package-specific notices. [xterm.js license](https://github.com/xtermjs/xterm.js/blob/master/LICENSE). |
| `node-pty` | Optional native PTY provider for terminal tests. | The main project license is MIT; retain the complete license and bundled notices supplied by the installed package. [node-pty license](https://github.com/microsoft/node-pty/blob/main/LICENSE). |
| Playwright and browser binaries | The retained web engine uses separately installed Playwright packages and browsers. | Playwright uses Apache-2.0; browsers and bundled components have additional licenses. This dependency does not change this fork's own MIT grant. [Playwright license](https://github.com/microsoft/playwright/blob/main/LICENSE). |
| Documentation and image-processing tools | Development/preview tools and optional engines can install additional third-party packages and native image libraries. | The development dependency graph is not MIT-only. Mintlify tooling, sharp/libvips, fonts, and their transitive components retain their package-specific terms. They are not vendored into this source archive. Inspect the exact installed versions before redistributing any toolchain or binary bundle. |
| Model providers, device tools, and optional integrations | Selected by configuration or installed as dependencies for the relevant engine. | Their code, services, credentials, and usage terms are separate from this repository's license. |

An npm install or a native package manager normally supplies dependency
license files alongside installed code. If building a standalone executable,
installer, container, or offline dependency bundle, collect the notices and
source/relinking materials required by the exact included components. A link
to this table is not a substitute for required license text or source offers.

## Inherited development material

The MIT base included external developer skills. The current tree retains
the licensed `unbox-ai` skill and its origin in `skills-lock.json`:

- `unbox-ai` comes from [tester-army/unbox-ai](https://github.com/tester-army/unbox-ai).
  Its MIT license, including `Copyright (c) 2026 Oskar Kwasniewski`, is retained
  beside the [vendored skill](.claude/skills/unbox-ai/LICENSE).

The nonessential `unslop` skill from
[okwasniewski/dotfiles](https://github.com/okwasniewski/dotfiles) was removed
from the current tree during release review. The external source has no
standalone license. Its earlier inclusion by Oskar Kwaśniewski in the MIT e2e
history, commit `2e5e783d2d3457544470b1533aba47fccb6b2081`, remains documented
in the historical audit, but the release does not rely on that inference for
its current development files. Removal does not erase the inherited Git history.

These skills are developer guidance, not runtime dependencies. This fork does
not claim ownership of their source projects or names.

The inherited benchmark documentation identifies scenarios copied from
TesterArmy's benchmark projects. The mobile benchmark images retain the same
bytes as the corresponding files in the MIT base, under their former
`packages/mobile-benchmark/assets` paths. Preserve those source acknowledgments
when moving or modifying the benchmarks. The documentation logo and favicon
were replaced with original neutral SVGs for this fork; the upstream mascot
is not used as the fork's identity. No font files are vendored. Documentation
hosting may fetch fonts separately, whose own terms apply. Future copied
assets must retain their applicable notices.


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
