# macOS driver dependencies

The new driver source is MIT. System Apple ApplicationServices/CoreFoundation
and the example's AppKit/Objective-C runtime are dynamically linked OS components;
they are not redistributed in the source archive.

The dependency versions are fixed by `Cargo.lock`. The following crates are
compiled by the driver's current default feature set. Their license files are
included under `licenses/` for binary redistribution preparation. Preserve these
notices when distributing a compiled driver. Dependency source is downloaded by
Cargo and is not vendored in this repository.

| Crate | Version | Upstream license choice | Included notice |
| --- | --- | --- | --- |
| serde | 1.0.229 | MIT OR Apache-2.0 | MIT |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | MIT |
| serde_json | 1.0.145 | MIT OR Apache-2.0 | MIT |
| itoa | 1.0.18 | MIT OR Apache-2.0 | MIT |
| memchr | 2.8.3 | Unlicense OR MIT | COPYING (both alternatives) |
| ryu | 1.0.23 | Apache-2.0 OR BSL-1.0 | Boost Software License 1.0 |

`BSL-1.0` here is the permissive **Boost Software License 1.0**, not the
unrelated Business Source License. Selecting a permitted dependency license does
not change the license of this project's own source. The lockfile may also list
optional derive dependencies not compiled by this feature set; if features or
dependencies change, rerun the dependency/license review for the actual binary.

Licenses above were read from the downloaded package archives corresponding to
the lockfile, rather than inferred from repository names.
